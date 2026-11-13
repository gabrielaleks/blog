+++
author = "Gabriel Aleksandravicius"
title = "ubus: a guide to OpenWrt's micro bus"
date = "2026-11-12"
summary = "This tutorial walks you through ubus: what it is, how it works and how to use it in C."
tags = [
  "openwrt",
  "ubus",
  "linux",
  "embedded",
  "ipc",
  "c",
  "cross-compilation",
  "docker",
  "networking",
  "banana-pi"
]
categories = [
  "guide"
]
+++

Most of the embedded software I write at work runs on OpenWrt, a Linux distribution for routers. Recently, two services we're developing needed to talk to each other. While looking for ways to do that, I ran into ubus, OpenWrt's inter-process communication system. I ended up doing a deep dive into it and this article is the result: it covers what ubus is, what it's used for and how it works. Finally, I'll show how to build C programs for OpenWrt and use ubus from them: calling methods, broadcasting events and subscribing to notifications.

My repository with the examples used in this article: [gabrielaleks/ubus-examples](https://github.com/gabrielaleks/ubus-examples).

## Table of Contents
- [Quick note on OpenWrt](#quick-note-on-openwrt)
- [What is ubus](#what-is-ubus)
- [When to use ubus and when not to](#when-to-use-ubus-and-when-not-to)
- [How ubus works](#how-ubus-works)
  - [Request/Response pattern](#requestresponse-pattern)
  - [Event pattern](#event-pattern)
  - [Subscription pattern](#subscription-pattern)
- [My setup](#my-setup)
- [A tour with the ubus CLI](#a-tour-with-the-ubus-cli)
- [Talking to ubus from code: which languages](#talking-to-ubus-from-code-which-languages)
- [Building C programs for OpenWrt](#building-c-programs-for-openwrt)
- [Request/Response](#requestresponse)
  - [The server: exposing an object](#the-server-exposing-an-object)
  - [The client: calling a method](#the-client-calling-a-method)
- [Publish/subscribe](#publishsubscribe)
  - [Events: broadcast by name](#events-broadcast-by-name)
    - [Sender](#sender)
    - [Listener](#listener)
  - [Subscriptions: notifications from one object](#subscriptions-notifications-from-one-object)
    - [Publisher](#publisher)
    - [Subscriber](#subscriber)
  - [Events or subscriptions?](#events-or-subscriptions)
- [Wrap-up](#wrap-up)
- [References](#references)

## Quick note on OpenWrt

ubus is part of OpenWrt, so a quick word about OpenWrt first.

[OpenWrt](https://openwrt.org) is an open-source, Linux-based OS for embedded devices. It is primarily used on networking devices - "Wrt" comes from the Linksys WRT54G, the wireless router it was first built for. Its main advantage is that it is highly customizable, so you can adapt it to your hardware and software requirements fairly easily.

Let's say that you want to develop a new Wi-Fi router. You need lots of things before you can even start implementing your actual product features:
- Ethernet and Wi-Fi drivers
- Network interfaces and bridges
- DHCP
- DNS
- NAT and firewall
- Traffic classification and QoS
- Configuration management

Building all of this from scratch is a huge task. OpenWrt gives you a mature foundation that already provides most of it: you pick an existing OpenWrt image supported by your hardware, install it and the packages you need and then focus on your product's own features.

Important note: OpenWrt is not just Ubuntu running on a router. It is specifically designed around embedded constraints, such as limited RAM and storage, different CPU architectures, hardware-specific drivers and cross-compilation. You can develop software on your computer, cross-compile it for the target architecture, package it and deploy it to the router - without compiling on the device itself (more on this in [Building C programs for OpenWrt](#building-c-programs-for-openwrt)).

Some components you'll find in a typical OpenWrt image:

<div class="table-widths" style="--c1: 20%">

| Component | Functionality |
|---|---|
| ubus | Communication between processes |
| procd | Init system and service supervisor (it also starts ubusd) |
| netifd | Network interface management |
| UCI | Unified configuration system (the files in `/etc/config`) |
| rpcd | Adds system methods to ubus and exposes ubus over HTTP |
| fw4 | Firewall |
| odhcpd | DHCPv6 and IPv6 router advertisements |
| hostapd | Wi-Fi access point management |
| LuCI | Web interface |
| libubox | Utility C library behind most of the above |
| apk | Package management (since 25.12; older releases use opkg) |

</div>

Suppose you're developing a service that monitors network connectivity and automatically switches between available WAN interfaces when a connection fails. You could:
1. Develop your connectivity monitoring logic as a standalone app
2. Expose its functionality through ubus, allowing other components to check the connection status or trigger a failover
3. Use procd to manage its lifecycle and restart it if necessary
4. Use UCI to configure monitoring intervals, health check targets and failover behavior
5. Ask netifd, over ubus, to bring WAN interfaces up or down

Steps 2 and 5 are where ubus comes in. Now, let's put it under the microscope.

## What is ubus

[ubus (micro bus)](https://openwrt.org/docs/techref/ubus) is OpenWrt's message bus for local [inter-process communication](https://en.wikipedia.org/wiki/Inter-process_communication). It's the standard way for programs on the same OpenWrt device to talk to each other. It was written by Felix Fietkau in 2011.

Without a bus, every pair of programs needs its own channel (a socket, a file, a FIFO, signals), its own message format and its own way to find each other. With ubus, there's one broker, one format, one naming scheme and one permission system, all over a single Unix socket.

Its core idea is that a program registers *named objects* (like `network.interface.lan`) that have *methods* (like `status`, `up`, `down`). Any other program can find the object by name and call its methods with JSON-like arguments, getting a JSON-like reply. There's also two ways to publish messages to whoever is interested.

It is composed of three parts:
- ubusd: The broker. It runs all the time, started by procd at boot. Every message goes through it.
- libubus: The C client library. Programs link it to connect to `ubusd`.
- ubus: The command-line client (`ubus list`, `ubus call`, …). It's just a program built on `libubus`, the same lib our programs will use.

Many OpenWrt programs use ubus. For example, hostapd sends notifications when Wi-Fi clients join or leave a network. netifd sends an event whenever an interface goes up or down and netifd's objects have methods to read an interface's status and to switch it on and off.

## When to use ubus and when not to

Use it when:
- Two programs on the same OpenWrt device need to talk
- You want to expose a daemon's status or controls, such as "give me your status", "reload", "set X" so that other tools can use them.
- You want to react to what the system does, such as interfaces going up or down, Wi-Fi clients joining etc. OpenWrt's own services already publish these on ubus.
- The messages are small and structured.

Don't use it when:
- The data is bulk - ubusd's code limits a message to 1 MB. For large transfers, write the data to a file and send its path over ubus. You can also use a socket or a pipe.
- The other side is on another machine. ubus is a local Unix socket. If the other device is in the cloud, use HTTP, MQTT etc.
- Messages must not be lost. ubus has no queue or storage. An event that nobody listens to is lost.
- The software must also run on platforms without ubus. ubus builds on any Linux but only OpenWrt / OpenWrt-based systems (like prplOS) have it. RDK-B, for example, uses rbus instead.
- You need high message rates. Each message goes program -> broker -> program, with encoding at each end. A few messages per second is fine, but if you need thousands per second, measure first, or use a direct socket.

## How ubus works

ubusd is the broker. It is started at boot (by procd) and listens on the Unix socket `/var/run/ubus/ubus.sock`. Every program that uses ubus connects to that socket. No data flows through the listening socket itself, though: it only accepts new connections. For each one, the kernel creates a separate connection between that program and ubusd. So, if netifd, hostapd and the ubus command are all running, ubusd holds three separate connections. Each has its own data and its own buffers:

```
                         ubusd's sockets
netifd   [s]──conn 1──[s]─┐
hostapd  [s]──conn 2──[s]─┼── ubusd
ubus CLI [s]──conn 3──[s]─┘
                        + 1 listening socket (/var/run/ubus/ubus.sock)
```

A program registers an object with a list of methods. Each method has a policy: the names and types of its arguments. In the example below, `network.interface.wwan` is an object; `up`, `down`, `renew`, `status` and `add_device` are methods and the fields after `add_device` are its policy (methods with `{}` take no arguments). The number after `@` is the object's id, given by ubusd. The policy is only advertised to callers: ubusd doesn't enforce it, so each program has to check its own arguments.

```sh
root@OpenWrt:~# ubus -v list network.interface.wwan
'network.interface.wwan' @2c4a7d10
	"up":{}
	"down":{}
	"renew":{}
	"status":{}
	…
	"add_device":{"name":"String","link-ext":"Boolean","vlan":"Array"}
	…
```

Messages travel as blobmsg, a compact binary TLV (type-length-value) format from libubox. The `ubus` CLI converts it to and from JSON, so you see JSON there. C programs, on the other hand, build and read blobmsg directly, as we'll see. For example, this JSON:

```json
{"interface": "wwan"}
```

travels as one blobmsg field:

| type | total length | name length | name | value | padding |
|---|---|---|---|---|---|
| STRING | 21 | 9 | `interface\0` | `wwan\0` | 3 bytes (to 24) |

The 21 bytes are 4 (header) + 2 (name length) + 10 (`interface\0`) + 5 (`wwan\0`). The field is padded to 24 so the next one starts on a 4-byte boundary.

The ACLs (Access Control Lists) are defined as JSON files in `/usr/share/acl.d`. They decide what a user may do: which objects and methods it may call and which names it may send, listen for, publish or subscribe to (they don't apply to root). For example, `/usr/share/acl.d/my-listener.json`:

```json
{
  "user": "gabriel",
  "access": {
    "network.interface.*": { "methods": [ "status" ] }
  },
  "listen": [ "network.*" ]
}
```

The diagrams below illustrate the three different ubus patterns that can be used for communication between processes. `my-app`, `my-listener` and `wifi-watcher` are example programs. The rest is real but names may vary.

### Request/Response pattern

{{< figure src="/images/ubus-a-guide-to-openwrts-micro-bus/diagram-request-response.png" alt="Diagram - Request/Response" caption="Request/Response pattern diagram">}}

The request/response pattern works by calling a method on an object and getting a reply.

Following the blue arrows:
1. `my-app` asks ubusd to call `status` on the object `network.interface.wwan`.
2. ubusd knows that netifd registered that object. It checks the ACLs and forwards the call.
3. netifd's handler runs and replies with the interface's state.
4. ubusd passes the reply back to `my-app`.

To try it from the CLI:

```sh
ubus call network.interface.wwan status
```

### Event pattern

{{< figure src="/images/ubus-a-guide-to-openwrts-micro-bus/diagram-event.png" alt="Event pattern" caption="Event pattern diagram">}}

The event pattern works by broadcasting a message under a name. The sender doesn't know who listens.

Following the yellow arrows:
1. When an interface goes down, netifd sends an event named `network.interface` with `{"action": "ifdown", "interface": "wwan"}`.
2. ubusd gives a copy to every program whose pattern matches the name (an exact name, or a prefix ending in `*`). If nobody listens, the event is dropped.

To try it from the CLI:

```sh
ubus listen 'network.*'
```

Then run `ifdown wwan` in another window (and `ifup wwan` to bring it back). Pick an interface your ssh session doesn't use, or you'll lose your connection.

### Subscription pattern

{{< figure src="/images/ubus-a-guide-to-openwrts-micro-bus/diagram-subscription.png" alt="Diagram - Subscription" caption="Subscription pattern diagram">}}

The subscription pattern works by following an object's notifications.

Following the green arrows:
1. `wifi-watcher` subscribes once to the object `hostapd.phy1-ap0`.
2. When a phone joins that access point, hostapd sends an `assoc` notification on its object.
3. ubusd delivers it only to that object's subscribers. Unlike with events, hostapd can tell whether anyone is subscribed.

To try it from the CLI:

```sh
ubus subscribe hostapd.phy1-ap0
```

`hostapd.<interface>` objects only exist for Wi-Fi interfaces in access point mode and the name depends on your device. Run `ubus list 'hostapd.*'` to find yours.

## My setup

The device I'll use in the rest of this article is a [Banana Pi BPI-R4](https://docs.banana-pi.org/en/BPI-R4/BananaPi_BPI-R4) with a [Wi-Fi 7 card](https://docs.banana-pi.org/en/BPI-R4/BananaPi_BPI-R4-NIC-BE14). I am using the OpenWrt 25.12.6 image for the BPI-R4 (`openwrt-25.12.6-mediatek-filogic-bananapi_bpi-r4-sdcard.img.gz`), which you can find here: [`https://downloads.openwrt.org/releases/25.12.6/targets/mediatek/filogic/`](https://downloads.openwrt.org/releases/25.12.6/targets/mediatek/filogic/).

If you want to follow along and run the tests yourself, you can use any OpenWrt router you have or run [OpenWrt as a Docker container](https://openwrt.org/docs/guide-user/virtualization/docker_host). Keep in mind that the container is x86_64, while my examples are built for the BPI-R4's aarch64 CPU: you'd need the x86_64 SDK (target `x86/64`) instead and the hostapd example won't work there.

On the router, we'll need ubus, ubusd and libubus - they come in every image. For the C examples, we'll need libubus, libubox and libblobmsg-json, which are also already installed, since the `ubus` CLI uses them. On your computer, you'll need Docker (see [Building C programs for OpenWrt](#building-c-programs-for-openwrt)).

## A tour with the ubus CLI

The ubus CLI uses the same library calls as your program would, so it's a nice way to start.

| Command | What it does |
|---|---|
| **ubus list** | List all objects. |
| **ubus -v list system** | List one object's methods + policies. |
| **ubus call system board**| Call a method with no arguments |
| **ubus call network.interface.wan status** | Interface status from netifd: the Wi-Fi uplink's address, route and DNS. |
| **ubus call network.interface.wan down** | Take down the uplink |
| **ubus call network.interface.wan up** | Bring the uplink back |
| **ubus listen** | Print every event. ubus listen 'network.*' prints only matching ones. |
| **ubus send demo.hello '{"x": 1}'** | Send an event (watch it appear in another window with ubus listen). |
| **ubus subscribe hostapd.phy1-ap0** | Subscribe and print one object's notifications |
| **ubus wait_for demo.counter** | Wait until an object appears. |
| **ubus monitor** | Print **every** message going through ubusd. |

A nice way to test these commands and visualize what's happening is with three SSH windows on your router:
1. Window 1: `ping 1.1.1.1` -> goes out over wan
2. Window 2: `ubus listen network.*`
3. Window 3: `ubus call network.interface.wan down` -> The ping in window 1 will fail and window 2 prints a network.interface event with `"action": "ifdown"` and `"interface": "wwan"`.
4. Window 3: `ubus call network.interface.wwan up`. A few seconds later, window 2 prints `"action": "ifup"` and the ping works again.

```sh
root@OpenWrt:~# ubus list
container
dhcp
dnsmasq
dnsmasq.dns
file
hostapd
...
```

## Talking to ubus from code: which languages

After doing some research, I came up with the following table containing the current ubus support offered by some languages:

<div class="table-widths" style="--c1: 15%; --c3: 20%">

| Language | How | Package | Notes |
|---|---|---|---|
| C | libubus + libubox | libubus, libubox | Every other binding wraps it. |
| Shell | ubus CLI + jshn.sh (to build and parse JSON) | ubus, jshn | Fine for scripts; one process per call. |
| Lua | ubus Lua module | libubus-lua | The classic LuCI binding. |
| Python | ubus module (a C extension over libubus) | python3-ubus | - |
| Go, Rust | no official binding - run the CLI / wrap libubus (cgo / FFI) / speak the protocol directly | community libraries | Each option has trade-offs: process cost, cross-compiling C, depending on an undocumented protocol. |

</div>

## Building C programs for OpenWrt

To demonstrate how ubus can be used programmatically, I will give examples in C for each pattern (request/response, events and subscriptions). They contain code for both sides: the process that offers something and the process that uses it.

The repository containing the code can be found here: [`https://github.com/gabrielaleks/ubus-examples`](https://github.com/gabrielaleks/ubus-examples)

A standard OpenWrt image has no C compiler, as it would take hundreds of MBs to store it plus its headers and libraries. OpenWrt images are kept to a few MB of flash and RAM, so the usual approach is for the router to only run programs and the build happens on another machine. You can find gcc in its feeds by running `apk search gcc`, however in practice nobody installs this since it's slow and heavy.

So, the solution is to cross-compile: you compile the code on one computer, generating an executable program and run it on the router. We have to guarantee that the cross-compilation toolchain we'll use is configured to generate a binary compatible with our target environment. To do this, three things must match.

1. CPU and target (`aarch64_cortex-a53`, `mediatek/filogic`). The CPU architecture decides which instructions the binary uses: a binary built for another CPU won't start at all! The target is the chip's family and it tells you which SDK to download (more on that below). You can extract both like this:

```sh
root@OpenWrt:~# cat /etc/openwrt_release
DISTRIB_ID='OpenWrt'
DISTRIB_RELEASE='25.12.6'
DISTRIB_REVISION='r33311-981c978eff'
DISTRIB_TARGET='mediatek/filogic' # Target
DISTRIB_ARCH='aarch64_cortex-a53' # CPU
DISTRIB_DESCRIPTION='OpenWrt 25.12.6 r33311-981c978eff'
```

2. The C library (in this case, musl). Ideally, you're using the musl from the same OpenWrt release. A binary built against glibc or a different musl fails to start or crashes. Running musl's loader directly prints its version:

```sh
root@OpenWrt:~# /lib/libc.so
musl libc (aarch64)
Version 1.2.5
Dynamic Program Loader
Usage: /lib/libc.so [options] [--] pathname [args]
```

3. libubus and libubox (must be the same build). The ubus program we'll write calls their functions, so the standard practice is to use the same version in order to prevent errors. Check the versions like this:

```sh
root@OpenWrt:~# apk info libubus libubox
libubus20251202-2026.06.28~24864e78-r2 description:
OpenWrt RPC client library

libubox20260213-2026.11.02~ff13b89e-r1 description:
Basic utility library
```

The number in each package name (`20251202`, `20260213`) is the library's ABI version. The files on the router are `/lib/libubus.so.20251202` and `/lib/libubox.so.20260213` and those are the exact names your binary will ask for when it starts.

There are a few ways to cross-compile. I'll use the official SDK (Software Development Kit) published by OpenWrt, which takes care of all three points above. There's one per release and per target, next to the images on downloads.openwrt.org: pick the one whose release and target match your `/etc/openwrt_release`. It contains the same compiler, musl and library build setup that made the image on your router and it can build libubox and ubus so your programs can be compiled and linked against them. The SDK only runs on x86_64 Linux, so on a Mac I run it inside Docker (it's slower on Apple Silicon, since Docker emulates x86_64).

The SDK's usual workflow is to write an OpenWrt package recipe and let it produce an `.apk` package. For these examples I keep it simpler: a `Makefile` runs the SDK's compiler inside the container and produces plain binaries, which I copy to the router with `scp`. Building isn't the focus of this article, so I won't go through it line by line. If you want the details of how I'm doing it, check the [`Makefile`](https://github.com/gabrielaleks/ubus-examples/blob/master/Makefile) in the repository. The two commands you need are `make` (build) and `make deploy` (build and copy to `/tmp` on the router).

We can use the SDK via a Dockerfile. This way, we don't have to download anything by hand. My Dockerfile looks like this:

```Dockerfile
FROM debian:bookworm

# Tools the SDK needs on the build machine
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential ca-certificates file gawk gettext git libncurses-dev \
    python3 python3-distutils rsync unzip wget zstd \
&& rm -rf /var/lib/apt/lists/*

# The OpenWrt build refuses to run as root, so use a normal user
RUN useradd -m builder
USER builder
WORKDIR /home/builder

# The SDK for the router's image: release 25.12.6, target mediatek/filogic.
# Change these three values for another router (see /etc/openwrt_release).
ARG SDK_BASE=https://downloads.openwrt.org/releases/25.12.6/targets/mediatek/filogic
ARG SDK_FILE=openwrt-sdk-25.12.6-mediatek-filogic_gcc-14.3.0_musl.Linux-x86_64.tar.zst
ARG SDK_SHA256=1c04ac47bdfc361d6aab299eb520d570e368013dedcb8d29cf39dc7168ae642e

# Download, check that the file is the one OpenWrt published, unpack
RUN wget -q "$SDK_BASE/$SDK_FILE" \
 && echo "$SDK_SHA256  $SDK_FILE" | sha256sum -c - \
 && mkdir sdk && tar --zstd -xf "$SDK_FILE" -C sdk --strip-components=1 \
 && rm "$SDK_FILE"

WORKDIR /home/builder/sdk

# Get the recipes for libubox and ubus and create the build config
RUN ./scripts/feeds update base \
&& ./scripts/feeds install libubox ubus \
&& make defconfig \
&& make package/libubox/compile package/ubus/compile
```

It uses a Debian (x86_64) system for the SDK to run in. We install the tools the SDK expects on the build machine and create the user that will run the build. Then, we define three values: the SDK base URL, the SDK file name (as written on the download page) and the SDK SHA256 (listed in the `sha256sums` file on the same page). In case we decide to use a different SDK, these values are the only things to change in the Dockerfile. We then download the file, check its validity and unpack it. Finally, we fetch the recipes for libubox and ubus, create the build config and compile both libraries once, so they're saved in the image.

After creating the file we build the image with this command:

```sh
docker build --platform linux/amd64 -t ubus-sdk .
```

It takes a while to run but, once it's done, every build afterwards only compiles your code, since libubox and ubus are already built. The headers of those libraries are also stored in the image, under `staging_dir/target-aarch64_cortex-a53_musl/usr/include`. Run this from the repository folder to copy them from the image to your local development environment:

```sh
docker run --rm --platform linux/amd64 -v "$PWD":/work ubus-sdk \
  sh -c 'cp -r staging_dir/target-*/usr/include /work/.sdk-include'
```

You can now point your editor to them in order for `#include <libubus.h>` to resolve (and add `.sdk-include` to your `.gitignore`)! In my case, since I use VSCode's "C/C++" extension, I just have to create `.vscode/c_cpp_properties.json` and put this in it:

```json
{
  "configurations": [{
    "name": "OpenWrt",
    "includePath": ["${workspaceFolder}/**", "${workspaceFolder}/.sdk-include"],
    "cStandard": "c11"
  }],
  "version": 4
}
```

## Request/Response

Our objective in this example is to code a simple counter application. It must have 2 methods:
- `get`: returns the current value
- `add`: adds to the current value

This is the "server" process. We will validate it using the CLI. We will also write some client code that shows how to call it programmatically using libubus.

### The server: exposing an object

```c
#include <libubus.h>
#include <stdint.h>

static struct blob_buf b;
static uint32_t counter;

enum {
    ADD_N,
    __ADD_MAX
};

static const struct blobmsg_policy add_policy[__ADD_MAX] = {
    [ADD_N] = {.name = "n", .type = BLOBMSG_TYPE_INT32},
};

static int counter_get(
    struct ubus_context* ctx,
    struct ubus_object* obj,
    struct ubus_request_data* req,
    const char* method,
    struct blob_attr* msg
) {
    blob_buf_init(&b, 0);
    blobmsg_add_u32(&b, "value", counter);
    ubus_send_reply(ctx, req, b.head);
    return UBUS_STATUS_OK;
}

static int counter_add(
    struct ubus_context* ctx,
    struct ubus_object* obj,
    struct ubus_request_data* req,
    const char* method,
    struct blob_attr* msg
) {
    struct blob_attr* tb[__ADD_MAX];

    blobmsg_parse(
      add_policy, 
      __ADD_MAX, 
      tb, 
      blob_data(msg), 
      blob_len(msg)
    );

    if (!tb[ADD_N]) {
        return UBUS_STATUS_INVALID_ARGUMENT;
    }

    counter += blobmsg_get_u32(tb[ADD_N]);
    return counter_get(ctx, obj, req, method, msg);
}

static const struct ubus_method counter_methods[] = {
    UBUS_METHOD_NOARG("get", counter_get),
    UBUS_METHOD("add", counter_add, add_policy),
};

static struct ubus_object_type counter_type = UBUS_OBJECT_TYPE(
  "demo.counter", 
  counter_methods
);

static struct ubus_object counter_obj = {
    .name = "demo.counter",
    .type = &counter_type,
    .methods = counter_methods,
    .n_methods = ARRAY_SIZE(counter_methods),
};

int main(void) {
    uloop_init();
    struct ubus_context* ctx = ubus_connect(NULL);

    if (!ctx) {
        return 1;
    }

    ubus_add_uloop(ctx);

    if (ubus_add_object(ctx, &counter_obj)) {
        return 1;
    }

    uloop_run();
    ubus_free(ctx);
    uloop_done();
    return 0;
}
```

Let's analyse the code from the bottom to the top. Inside `main` we:
1. Start uloop, libubox's event loop. uloop waits and calls our code when a call arrives.
2. Open a socket to ubusd (`NULL` means the socket's path is the default value of `/var/run/ubus/ubus.sock`).
3. Pass the socket to the event loop. Without this, messages arrive but nothing reads them.
4. Register the object in ubusd. After this, `ubus list` shows it.
5. Run the loop and process incoming calls. Our handlers are never called by us directly: libubus calls them from inside `uloop_run()`.
6. Clean up when the loop ends. `uloop_run()` catches Ctrl-C (SIGINT) and SIGTERM itself and returns, so these last lines do run.

`counter_obj` is our object: it's defined by its name, its methods, the number of methods and its type. The type describes the object: when you run `ubus -v list demo.counter`, you see what got defined in `.type`. This description is only advertised to callers; ubusd doesn't enforce it.

The method table `counter_methods` links each method name to a function (`get` and `add`). In `add`'s case we also pass the policy, which describes this method's arguments. The policy says that `add` expects one field, named `n`, of type int32.

Each method has the same signature. The important parameters are `req`, which identifies the call you're answering and `msg`, which holds the arguments the caller sent as a `blobmsg`.

`counter_get` empties the buffer, creates the field `"value": <counter>`, sends it and returns successfully. The buffer `b` is `static`, so it keeps its contents between calls: without `blob_buf_init`, each reply would also carry the previous reply's fields.

In `counter_add`, `blobmsg_parse` goes through the arguments and fills `tb` (table). `tb[ADD_N]` points at the `n` field, so it stays `NULL` if `n` is missing or if it has the wrong type. We have to add a `NULL` check, since ubusd and libubus don't do that for us. We then use `blobmsg_get_u32` to read the input value and add it to the current counter. Finally, we call `counter_get` so the reply becomes the new value.

Build it and deploy it to the router (`make deploy`). Then, run `/tmp/server` in one terminal window and test it from another:

```sh
root@OpenWrt:~# ubus -v list demo.counter
'demo.counter' @683ea497
	"get":{}
	"add":{"n":"Integer"}

root@OpenWrt:~# ubus call demo.counter get
{
	"value": 0
}

root@OpenWrt:~# ubus call demo.counter add '{"n": 7}'
{
	"value": 7
}
```

### The client: calling a method

```c
#include <libubus.h>
#include <stdio.h>
#include <stdlib.h>

static struct blob_buf b;

enum {
    VALUE,
    __VALUE_MAX
};

static const struct blobmsg_policy value_policy[__VALUE_MAX] = {
    [VALUE] = {.name = "value", .type = BLOBMSG_TYPE_INT32},
};

// Runs once for the data part of the reply
static void reply_cb(
    struct ubus_request* req,
    int type,
    struct blob_attr* msg
) {
    uint32_t* out = req->priv;
    struct blob_attr* tb[__VALUE_MAX];

    blobmsg_parse(
        value_policy,
        __VALUE_MAX,
        tb,
        blob_data(msg),
        blob_len(msg)
    );

    if (tb[VALUE]) {
        *out = blobmsg_get_u32(tb[VALUE]);
    }
}

int main(int argc, char** argv) {
    struct ubus_context* ctx;
    uint32_t id;
    int ret;

    ctx = ubus_connect(NULL);

    if (!ctx) {
        fprintf(stderr, "cannot connect to ubusd\n");
        return 1;
    }

    if (ubus_lookup_id(ctx, "demo.counter", &id)) {
        fprintf(stderr, "demo.counter not found\n");
        ubus_free(ctx);
        return 1;
    }

    blob_buf_init(&b, 0);

    uint32_t value = 0;
    if (argc > 1) {  // client 5  -> add {"n": 5}
        blobmsg_add_u32(&b, "n", atoi(argv[1]));
        ret = ubus_invoke(ctx, id, "add", b.head, reply_cb, &value, 3000);
    } else {  // client -> get
        ret = ubus_invoke(ctx, id, "get", b.head, reply_cb, &value, 3000);
    }

    if (ret) {
        fprintf(stderr, "call failed: %s\n", ubus_strerror(ret));
    } else {
      printf("counter = %u\n", value);
    }

    ubus_free(ctx);
    return ret;
}
```

The client code shows how the ubus server can be used programmatically. Notice that here we don't start an event loop, since `ubus_invoke` waits for the answer itself, but we still open a socket to ubusd. We use this socket to look up the `demo.counter` object, grabbing its id in case it exists.

There are two use cases for the client app, based on how it gets called:
- `./client` returns the counter's current value
- `./client n` adds `n` to the counter and returns its new value

The appropriate method (`add` or `get`) gets invoked based on `argc`.

Now, notice the relationship between `ubus_invoke` and `reply_cb`:

```php
main                          ubus_invoke (libubus)               server
 |                                 |                                |
 | value = 0                       |                                |
 |-- ubus_invoke(..., "add",       |                                |
 |     reply_cb, &value) --------->|                                |
 |   (main is paused here)         |-- add {"n":5} ---------------->|
 |                                 |                                | counter_add runs
 |                                 |<-- data {"value":5} -----------|  ubus_send_reply
 |                                 |-- calls reply_cb(req, msg) ─┐  |
 |                                 |   req->priv is &value       │  |
 |                                 |   *out = 5  (value is now 5)│  |
 |                                 |<────────────────────────────┘  |
 |                                 |<-- status 0 -------------------|  return UBUS_STATUS_OK
 |<-- returns 0 (ret) -------------|                                |
 | main continues                  |                                |
 | printf("counter = %u", value)   |                                |
 |   → counter = 5                 |                                |
```

`ubus_invoke` sends the call (through ubusd) and waits for up to 3000 ms. When the server's reply data arrives, `ubus_invoke` passes it to `reply_cb`, which does whatever the client needs with it. When the server's status arrives, `ubus_invoke` returns it as `ret`, so the caller can tell whether the call succeeded.

Build it and deploy it to the router (`make deploy`). Then, run `/tmp/server` in one terminal window and test the client from another:

```sh
root@OpenWrt:~# /tmp/client
counter = 0

root@OpenWrt:~# /tmp/client 26
counter = 26
```

## Publish/subscribe

### Events: broadcast by name

The events pattern is made of a sender and a listener. The sender is our counter server with one extra call. Sending an event doesn't need an object at all: any program connected to ubusd can send one, as `ubus send` shows.

#### Sender

Add this at the end of `counter_add`, right before the return:

```c
blob_buf_init(&b, 0);
blobmsg_add_u32(&b, "value", counter);
ubus_send_event(ctx, "demo.counter.changed", b.head);
```

Now `counter_add` not only adds to the counter, it also sends an event named `demo.counter.changed`.

#### Listener

```c
#include <libubox/blobmsg_json.h>
#include <libubus.h>
#include <stdio.h>
#include <stdlib.h>

static void on_event(
    struct ubus_context* ctx,
    struct ubus_event_handler* ev,
    const char* type,
    struct blob_attr* msg
) {
    char* json = blobmsg_format_json(msg, true);
    printf("event %s: %s\n", type, json);
    free(json);
}

static struct ubus_event_handler listener = {.cb = on_event};

int main(void) {
    struct ubus_context* ctx;
    int ret;

    uloop_init();
    ctx = ubus_connect(NULL);

    if (!ctx) {
        fprintf(stderr, "cannot connect to ubusd\n");
        return 1;
    }

    ubus_add_uloop(ctx);

    ret = ubus_register_event_handler(ctx, &listener, "demo.*");
    if (ret) {
        fprintf(stderr, "cannot listen: %s\n", ubus_strerror(ret));
        ubus_free(ctx);
        return 1;
    }

    uloop_run();

    ubus_free(ctx);
    uloop_done();
    return 0;
}
```

First, notice that we need to include `libubox/blobmsg_json.h`, since the `blobmsg_format_json` function isn't part of libubus or the core of libubox.

`on_event` receives the event's name in `type` and its data in `msg`. The name matters because one handler can match many events: `"demo.*"` is the pattern we register for. A pattern is either an exact name or a prefix ending in `*`.

The listener's `main` registers an event handler instead of an object. It has no lookup, methods or policy table. It doesn't call anyone and nobody calls it. As previously said, senders and listeners don't know about each other.

Build it and deploy it to the router (`make deploy`). A nice test is to run 3 terminal windows:
- window 1: the sender
- window 2: the client from the request/response section
- window 3: the listener

That shows both patterns side by side. The client asks and gets an answer: pure **request and response**. The listener never asks for anything but hears about every change: it keeps an eye out for **events**. And neither the client nor the sender knows the listener exists.

```sh
# window 1
root@OpenWrt:~# /tmp/sender

# window 2
root@OpenWrt:~# /tmp/client 3
counter = 3
root@OpenWrt:~# /tmp/client 7
counter = 10

# window 3
root@OpenWrt:~# /tmp/listener
event demo.counter.changed: {"value":3}
event demo.counter.changed: {"value":10}
```

Now try the CLI with `ubus listen`. It adds a listener too and `ubus send` lets anyone send an event:

```sh
# window 4: the CLI listening for the same events
root@OpenWrt:~# ubus listen 'demo.*'

# window 2: send a fake event
root@OpenWrt:~# ubus send demo.counter.changed '{"value": 999}'

# window 3: our listener can't tell it apart from a real one
event demo.counter.changed: {"value":999}
```

This shows two properties of events. First, they aren't authenticated: any program can send an event with any name and listeners can't tell who sent it. Second, nothing is stored: a listener started late never sees the events sent before it. Subscriptions, the next pattern, behave differently: only the object itself can send its notifications.

### Subscriptions: notifications from one object

The subscriptions pattern is made of a publisher and a subscriber. Unlike an event sender, the publisher **must** be an object, because subscribers attach to a specific object. So here the publisher is, once again, our counter server: its `demo.counter` object is what subscribers follow.

#### Publisher

We need to make three additions to the counter server:

1. Notify the subscribers in `counter_add` right after the counter changes:

```c
counter += blobmsg_get_u32(tb[ADD_N]);

if (obj->has_subscribers) {
    blob_buf_init(&b, 0);
    blobmsg_add_u32(&b, "value", counter);
    ubus_notify(ctx, obj, "changed", b.head, -1);
}

return counter_get(ctx, obj, req, method, msg);
```

`ubus_notify` takes the object instead of a name like `ubus_send_event` did, because a notification always comes *from* an object. `"changed"` is the notification's name and `-1` means "don't wait for the subscribers to answer" (a positive timeout would make the publisher wait for their replies, something events can't do). `obj->has_subscribers` is kept up to date by libubus, so the publisher can skip building the message when nobody is listening. An event sender has no way of knowing that.

1. Create a callback for subscribers. It runs when the object gets its first subscriber or loses its last one, not once per subscriber (and since it uses `printf`, the publisher now also needs `#include <stdio.h>`):

```c
// Runs when the object gets its first subscriber or loses its last one
static void on_subscribe(struct ubus_context* ctx, struct ubus_object* obj) {
    printf("subscribers: %s\n", obj->has_subscribers ? "yes" : "no");
}
```

3. Hook the callback into the object:

```c
static struct ubus_object counter_obj = {
    .name = "demo.counter",
    .type = &counter_type,
    .methods = counter_methods,
    .n_methods = ARRAY_SIZE(counter_methods),
    .subscribe_cb = on_subscribe,
};
```

#### Subscriber

```c
#include <libubus.h>
#include <stdio.h>

enum {
    VALUE,
    __VALUE_MAX
};

static const struct blobmsg_policy value_policy[__VALUE_MAX] = {
    [VALUE] = {.name = "value", .type = BLOBMSG_TYPE_INT32},
};

// Runs for each notification the object sends
static int on_notify(
    struct ubus_context* ctx,
    struct ubus_object* obj,
    struct ubus_request_data* req,
    const char* method,
    struct blob_attr* msg
) {
    struct blob_attr* tb[__VALUE_MAX];

    blobmsg_parse(
        value_policy,
        __VALUE_MAX,
        tb,
        blob_data(msg),
        blob_len(msg)
    );

    if (tb[VALUE]) {
        printf("%s: value = %u\n", method, blobmsg_get_u32(tb[VALUE]));
    }

    return UBUS_STATUS_OK;
}

// Runs when the object we follow goes away
static void on_remove(
    struct ubus_context* ctx,
    struct ubus_subscriber* sub,
    uint32_t id
) {
    printf("demo.counter is gone\n");
    uloop_end();
}

static struct ubus_subscriber subscriber = {
    .cb = on_notify,
    .remove_cb = on_remove,
};

int main(void) {
    struct ubus_context* ctx;
    uint32_t id;
    int ret;

    uloop_init();
    ctx = ubus_connect(NULL);

    if (!ctx) {
        fprintf(stderr, "cannot connect to ubusd\n");
        return 1;
    }

    ubus_add_uloop(ctx);

    ret = ubus_register_subscriber(ctx, &subscriber);
    if (ret) {
        fprintf(stderr, "cannot register subscriber: %s\n", ubus_strerror(ret));
        ubus_free(ctx);
        return 1;
    }

    if (ubus_lookup_id(ctx, "demo.counter", &id)) {
        fprintf(stderr, "demo.counter not found\n");
        ubus_free(ctx);
        return 1;
    }

    ret = ubus_subscribe(ctx, &subscriber, id);
    if (ret) {
        fprintf(stderr, "cannot subscribe: %s\n", ubus_strerror(ret));
        ubus_free(ctx);
        return 1;
    }

    uloop_run();

    ubus_free(ctx);
    uloop_done();
    return 0;
}
```

Most of this code we've already discussed: the event loop comes from the listener and the lookup and the policy come from the client. Like the client, the subscriber knows what `demo.counter` sends, so it reads `value` with a policy.

What's new happens in two steps. `ubus_register_subscriber` creates the subscriber; `ubus_subscribe` attaches it to a specific object (`demo.counter`) using its id. That means the object must already exist. This is the opposite of the listener, which could start before the sender!

Notice that `on_notify` has the same signature as a server's method handler. That's because a subscriber is itself a small, unnamed ubus object and a notification is delivered to it much like a method call. `method` holds the notification's name, `"changed"`.

Finally, `remove_cb` runs when the object we follow goes away: ubusd tells the subscriber, we print a message and stop the loop. A listener doesn't get anythings like that.

We can test this nicely with 3 terminal windows:
- window 1: the publisher
- window 2: the subscriber
- window 3: calls with the client and `ubus send`

```sh
# window 1
root@OpenWrt:~# /tmp/publisher
subscribers: yes    # appears after window 2 connects
subscribers: no     # appears after window 2 disconnects

# window 2
root@OpenWrt:~# /tmp/subscriber
changed: value = 6  # appears after window 3 uses the client

# window 3
root@OpenWrt:~# /tmp/client 6
counter = 6
root@OpenWrt:~# ubus send demo.counter.changed '{"value": 999}'
# window 2 prints nothing: an event isn't a notification
```

Only `demo.counter` itself can notify its subscribers, so the fake event that fooled our listener has no effect here.

Now start the subscriber again and stop the publisher with Ctrl-C:

```sh
# window 2
root@OpenWrt:~# /tmp/subscriber
demo.counter is gone  # appears after the publisher stops
```

And if you start the subscriber while the publisher isn't running, it fails right away, because there's nothing to subscribe to:

```sh
root@OpenWrt:~# /tmp/subscriber
demo.counter not found
```

The CLI has a subscriber too: `ubus subscribe demo.counter` prints the same notifications.

### Events or subscriptions?

Both patterns tell the receiver "something changed", but they behave differently:

| | Events | Subscriptions |
|---|---|---|
| Sender needs an object | no | yes |
| Must exist before the receiver starts | no | yes |
| Sender knows if anyone is listening | no | yes (`has_subscribers`) |
| Others can send the same message | yes (`ubus send`) | no |
| Receiver told when the sender goes away | no | yes (`remove_cb`) |

In short: use events for >something happened, whoever cares< and subscriptions for >I follow this one service<.

## Wrap-up

ubus gives every program on an OpenWrt device the same way to talk to the others: one broker (`ubusd`), one message format (blobmsg), one naming scheme and one permission system. Once you know that, a lot of OpenWrt becomes easier to explore: `ubus list` shows you what every service offers and `ubus call` lets you try it before writing any code.

We built the same small counter service three times, one for each pattern:
- Request/response: the server registers an object with methods, a client calls them and waits for the answer. Use it when a program needs to ask something or tell another program to do something.
- Events: the sender broadcasts a named message and any listener whose pattern matches receives it. Nobody needs to know anybody else. Use it for >something happened, whoever cares<.
- Subscriptions: the publisher's object notifies the subscribers attached to it. The publisher knows when someone is listening and the subscribers know when it goes away. Use it for >I follow this one service<.

Along the way, we cross-compiled C programs for the router with the OpenWrt SDK, running in Docker on a Mac and used the `ubus` CLI to test each side before writing the other.

If you want to go further, some good next steps are:
- ACLs: all the examples here ran as `root`, which ubusd never checks, so we didn't need any. A daemon running as its own user needs an ACL file in `/usr/share/acl.d` before it can call, listen to or subscribe to anything
- `ubus_auto_connect`, so your program survives a `ubusd` restart
- deferred replies, for methods that take a while to answer
- [rpcd](https://openwrt.org/docs/techref/rpcd), which exposes ubus over HTTP (that's how LuCI talks to the router)

All the code from this article, with the Dockerfile and the Makefiles, is in [gabrielaleks/ubus-examples](https://github.com/gabrielaleks/ubus-examples). Clone it, change the three SDK values in the Dockerfile to match your router and run `make deploy`.

## References
- OpenWrt: https://openwrt.org
- ubus (OpenWrt's tech reference page): https://openwrt.org/docs/techref/ubus
- ubus official repository: https://git.openwrt.org/project/ubus/
- Banana Pi BPI-R4: https://docs.banana-pi.org/en/BPI-R4/BananaPi_BPI-R4
- Banana Pi BPI-R4-NIC-BE14 (Wi-Fi 7 card): https://docs.banana-pi.org/en/BPI-R4/BananaPi_BPI-R4-NIC-BE14