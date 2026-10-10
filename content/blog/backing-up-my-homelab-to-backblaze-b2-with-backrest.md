+++
author = "Gabriel Aleksandravicius"
title = "Backing Up my Homelab to Backblaze B2 with Backrest"
date = "2026-10-10T08:00:00Z"
summary = "Setting up nightly encrypted off-site backups for the storage on my Raspberry Pi: what a recycle bin, a NAS and an off-site backup each protect against, why I chose Backblaze B2 and how I back up and restore with restic and Backrest."
tags = [
  "docker",
  "homelab",
  "self-hosting",
  "raspberry-pi",
  "storage",
  "backup",
  "restic",
  "backrest",
  "backblaze",
]
categories = [
  "homelab"
]
+++

In the [previous post](https://gabrielaleks.com/blog/building-network-storage-on-a-raspberry-pi-before-getting-a-nas/), I added a 4 TB hard drive to my Raspberry Pi and shared it over Samba. My 50 GB of photos and videos are now on it, but they're also still on my Mac. As soon as I delete them from the Mac to free up space, the disk on the Pi becomes the >only copy<, and if the disk dies then I would lose everything. So, I need a backup >before< I clean up my Mac.

## What protects against what

I already have a few safety nets: the Samba recycle bin, the copy that's still on my Mac and, some day, a NAS with two mirrored drives. But each of them only covers some of what can go wrong:

| What goes wrong | Recycle bin | Copy on the Mac | Future NAS mirror | Off-site backup |
|---|---|---|---|---|
| Accidental delete | ✔ for 30 days | ✔ | ✘ mirrored instantly | ✔ |
| File overwritten or corrupted | ✘ only deletes are caught | ✔ | ✘ | ✔ old versions kept |
| HDD dies | ✘ | ✔ | ✔ | ✔ |
| Ransomware on a device with the share mounted | ✘ | ✘ | ✘ | ✔ |
| Fire, flood, theft, power surge | ✘ | ✘ | ✘ | ✔ |
| Mistake noticed after 30 days | ✘ | depends | ✘ | ✔ |

I am not really expecting most of this to ever happen to me (hopefully!). But it's cheap to protect against, so I want to follow good practices anyway.

The column that surprised me most was the NAS. A NAS with mirrored drives keeps working when one drive dies, so it gives me >uptime<. But it's not a backup: if I delete or overwrite a file, the mirror copies that mistake to both drives instantly.

Regarding ransomware: if one of the devices that has the share mounted gets infected, it can encrypt every file on the disk. Since nothing gets deleted, nothing ends up in the recycle bin...

### The 3-2-1 rule

The usual rule of thumb for backups is 3-2-1:

- 3 copies of your data
- on 2 different kinds of storage
- with 1 of them off-site

While the photos are still on my Mac, I have the Mac, the HDD and the off-site backup. Once I delete them from the Mac I'm down to two copies: the HDD and the off-site backup. They're still on two kinds of storage (a local disk and the cloud) and one is off-site. For now, that's good enough for me. A NAS, or a second USB disk, would bring the third copy back later. This also means the off-site backup isn't something temporary until the NAS arrives.

### The architecture

Putting it all together, the diagram below shows how the files move. The solid arrows are what happens in normal operation and the dashed ones are for restoring:

{{< figure src="/images/backing-up-my-homelab-to-backblaze-b2-with-backrest/architecture.png" alt="architecture">}}

In normal operation:

1. My devices read and write files over SMB, by talking to Samba on the homeserver
2. Samba reads and writes those files on the HDD at `/mnt/storage`. When a file gets deleted, Samba moves it to `.recycle/`, where it stays for 30 days
3. Every night at 03:00, Backrest reads the personal folders from the HDD. It can only read them, since the disk is mounted read-only for Backrest
4. Backrest encrypts what it read and uploads only what changed to Backblaze B2, where it's kept as encrypted snapshots

To get files back, there are two ways. The first one goes through Backrest:

5. Backrest downloads the files I ask for from B2 and decrypts them
6. It writes them into `restores/` on the HDD, the only folder it's allowed to write to. From there, I reach them through Samba like any other file (arrows 2 and 1)

The second one is for when the homeserver itself is gone:

7. restic on my Mac downloads and decrypts the files straight from B2, without the Pi being involved at all

## Choosing where to send it

I considered four options for the off-site copy:

- Backblaze B2: cloud storage, pay for what you store
- Hetzner Storage Box: cloud storage at a flat monthly price per size
- A USB disk kept somewhere else, like at a friend's or family member's place, updated by hand
- A second Raspberry Pi at a family member's place, reachable over Tailscale

The last two cost nothing per month, but they depend on me remembering to update a disk or on someone else's power and internet. So it came down to the two cloud options. This is what each would cost me per month:

| Backed up | Backblaze B2 | Hetzner Storage Box |
|---|---|---|
| 50 GB | $0.28 | €3.20 (1 TB box) |
| 250 GB | $1.67 | €3.20 |
| 500 GB | $3.41 | €3.20 |
| 1 TB | $6.88 | €3.20 |
| 2 TB | $13.83 | €10.90 (5 TB box) |
| 4 TB | $27.73 | €10.90 |

B2 charges [$6.95 per TB per month](https://www.backblaze.com/cloud-storage/pricing), and the first 10 GB are free. Hetzner charges a fixed price per box size (prices without VAT). Below about 500 GB, B2 is cheaper because I only pay for what I actually store. Above that, Hetzner wins, and by a lot at the larger sizes.

I'm an amateur photographer who goes out to shoot every now and then. Today I have 50 GB, and even in the long run I'm looking at a few hundred GB, not terabytes. So I decided to go with B2 for about $0.28 a month. If I ever get close to 500 GB, I'll move to a Hetzner box.

Not everything on the disk gets backed up. Only the personal folders (`gabriel/` and `ayumi/`) contain things I can't replace. The shared `media/` folder with movies, music and TV shows is replaceable, and it would quickly become the biggest part of the bill.

## Tools: restic and Backrest

[restic](https://restic.net) is the backup program that does the actual work. A few things make it a good fit:

- Encrypted on the Pi: data is encrypted before it leaves the Pi, so Backblaze only ever sees random-looking chunks
- Deduplicated: files are split into chunks, and a chunk that's already in the backup is never uploaded again, even if the file was renamed or moved
- Incremental: after the first run, only what changed gets uploaded
- Snapshots: every run creates a snapshot that I can go back to

[Backrest](https://github.com/garethgeorge/backrest) is a web UI and scheduler built on top of restic. It runs the backups on a schedule, shows whether they succeeded, and lets me browse old snapshots and restore files from a browser. It's actively maintained and has Docker images for the Pi's ARM processor.

## Setting up B2

Setting up Backblaze took a few steps:

1. Account: The region is picked at sign-up (and **can't be changed later!**). I chose EU Central.
2. Bucket: A private bucket, with the lifecycle setting "Keep only the last version of the file", as [restic recommends](https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html).
3. Application key: Restricted to that one bucket, with read and write access.
4. Caps: I had a problem with this at the beginning. My first full backup stopped after about 10 minutes with:

```
Fatal: unable to save snapshot: client.PutObject: Cannot upload files, storage cap exceeded. See the Caps & Alerts page to increase your cap.
```

A new B2 account can only store the free 10 GB. At first I thought this was a daily upload limit and that I'd just have to wait a few days, but it isn't. The cap counts what's stored in the bucket, so waiting doesn't help. I added a payment method and raised the storage cap on the Caps & Alerts page to $0.10 per day. That allows 442 GB, so at most about $3 a month, and it also protects me from a surprise bill if something ever uploads far more than it should.

{{< figure
    src="/images/backing-up-my-homelab-to-backblaze-b2-with-backrest/b2-caps.png"
    alt="b2 caps"
    caption="My B2 Caps & Alerts page with the raised storage gap"
>}}

### What goes in the password manager

None of the secrets live in git and, if the Pi's SSD dies, they're the only way to get the data back. So before the first backup, I added these to my password manager:

| Item | What it is |
|---|---|
| Repository password | Encrypts the backup. Without it, nobody can read the data, including me |
| B2 key ID | Identifies the application key, like a username |
| B2 application key | The secret part of the key. B2 shows it only once, when it's created |
| Bucket name | Where the backup lives |
| S3 endpoint | The address of the B2 region, e.g. `s3.eu-central-003.backblazeb2.com` |

I generated the repository password with `openssl rand -base64 32`. The Backrest login isn't on this list on purpose: if I lose it, I can set Backrest up again from scratch. If I lose the repository password, the backup is gone for good.

## Backrest in Docker

Backrest, like everything else in my homelab, runs in Docker behind Traefik. It runs at `backrest.kaoshome.dev`, using the same [pattern as my other services](https://gabrielaleks.com/blog/adding-new-services-behind-traefik/). This is the compose file:

```yaml
services:
  backrest:
    image: ghcr.io/garethgeorge/backrest:v1.14.1
    container_name: backrest
    restart: unless-stopped
    # Runs as alekspi, so restored files get the same owner as the rest of /mnt/storage
    user: '1000:1000'
    environment:
      BACKREST_DATA: /data
      BACKREST_CONFIG: /config/config.json
      BACKREST_PORT: 0.0.0.0:9898
      XDG_CACHE_HOME: /cache
      TZ: Europe/Zurich
    volumes:
      # config.json holds the repository password and B2 keys: gitignored
      - ./data:/data
      - ./config:/config
      - ./cache:/cache
      # Read-only: Backrest can never change the originals
      - /mnt/storage:/userdata:ro
      # Restores land here, visible in the Samba share as restores/
      - /mnt/storage/restores:/restores
    networks:
      - traefik

networks:
  traefik:
    external: true
```

A few decisions in there:

- It runs as my user (UID 1000). Every file on the disk belongs to `alekspi`, and restored files should too. Otherwise Samba couldn't move or delete them later.
- The disk is mounted read-only. Backrest only needs to read the files to back them up, so a bug or a wrong click can never change the originals.
- Restores go to their own folder. `/mnt/storage/restores` is the only place Backrest can write to on the disk.
- The secrets stay out of git. Backrest saves its settings, including the repository password and the B2 keys, in `config/config.json`. That folder is in `.gitignore`.

Because the container doesn't run as root, the folders it writes to have to exist before the first start. Otherwise Docker creates them as root and Backrest can't write to them:

```bash
mkdir -p data config cache /mnt/storage/restores
docker compose up -d
```

Before deploying it on the Pi, I ran the same image on my Mac as UID 1000 and did a small backup and restore round trip. The restored files came back owned by UID 1000, which is exactly what I wanted to see.

## Repository and plan

Backrest separates the *repository* (where backups go) from the *plan* (what to back up and when). Both are set up in the web UI.

The repository:

| Field | Value |
|---|---|
| Repository URI | `s3:https://s3.eu-central-003.backblazeb2.com/<bucket>/kaos` |
| Password | the repository password |
| Env vars | `AWS_ACCESS_KEY_ID=<key ID>` and `AWS_SECRET_ACCESS_KEY=<application key>` |
| Prune policy | monthly. Removes data that no snapshot needs anymore |
| Check policy | monthly. Verifies that the repository is intact |

The `s3:` prefix tells restic to use the S3 API, and the key ID and application key go into the variables that S3 clients expect.

{{< figure
    src="/images/backing-up-my-homelab-to-backblaze-b2-with-backrest/backrest-repository.png"
    alt="backrest repository"
    caption="Repository"
>}}

The plan:

| Field | Value |
|---|---|
| Paths | `/userdata/gabriel`, `/userdata/ayumi` |
| Excludes | `.DS_Store`, `._*` (macOS metadata files) |
| Schedule | every night at 03:00 (`0 3 * * *`) |
| Retention | 7 daily, 4 weekly, 12 monthly |

The retention means I can go back to any night of the last week, any week of the last month and any month of the last year. Older snapshots get removed automatically.

{{< figure
    src="/images/backing-up-my-homelab-to-backblaze-b2-with-backrest/backrest-plan.png"
    alt="backrest plan"
    caption="Plan"
>}}

## The first backup

With the cap raised, I clicked "Backup Now" on the plan. The first run has to go through everything, 49.62 GiB in my case, and it took 43 minutes. From now on, the nightly runs only upload what changed, so they'll be much shorter.

{{< figure
    src="/images/backing-up-my-homelab-to-backblaze-b2-with-backrest/backrest-backup.png"
    alt="backrest backup"
    caption="Snapshot from my first backup"
>}}

## Restoring

A backup only counts once I've restored something from it. The first thing to know is that the Backblaze web console is useless for this. The bucket only contains encrypted chunks with random names, in folders like `data/`, `index/` and `snapshots/`. That's the point of encrypting on the Pi: Backblaze can't see my photos. Files only come back through restic and the repository password.

{{< figure
    src="/images/backing-up-my-homelab-to-backblaze-b2-with-backrest/b2-bucket.png"
    alt="b2 bucket"
    caption="B2 Bucket in Backblaze"
>}}

### Through Backrest

In Backrest, I open a snapshot, pick the files or folders I want and choose "Restore to path", with a path inside `/restores`. Backrest downloads and decrypts them, and they show up in the Samba share under `restores/`. From there, I move them back to where they belong. I tested this mechanism without problems.

{{< figure
    src="/images/backing-up-my-homelab-to-backblaze-b2-with-backrest/backrest-restore-1.png"
    alt="backrest restore 1"
    caption="First: going to a specific snapshot, selecting a folder and clicking to 'restore to path'"
>}}

{{< figure
    src="/images/backing-up-my-homelab-to-backblaze-b2-with-backrest/backrest-restore-2.png"
    alt="backrest restore 2"
    caption="Second: Writing the >restore to< path"
>}}

{{< figure
    src="/images/backing-up-my-homelab-to-backblaze-b2-with-backrest/backrest-restore-3.png"
    alt="backrest restore 3"
    caption="After restoring, the files appear in `storage/restores/example` and a restore event shows up in Backblaze"
>}}

### Without the Pi

The real test is restoring when the Pi itself is gone. For that, all I need is restic and the items from my password manager. I tried it on my Mac:

```bash
brew install restic

export RESTIC_REPOSITORY="s3:https://s3.eu-central-003.backblazeb2.com/<bucket>/kaos"
read -s "AWS_ACCESS_KEY_ID?Key ID: "; export AWS_ACCESS_KEY_ID
read -s "AWS_SECRET_ACCESS_KEY?Application key: "; export AWS_SECRET_ACCESS_KEY
read -s "RESTIC_PASSWORD?Repository password: "; export RESTIC_PASSWORD

restic snapshots                              # list all snapshots
restic ls latest /userdata/gabriel/documents  # browse a folder in the latest one
```

The paths start with `/userdata/` because that's where Backrest sees the disk inside its container.

Then there are three ways to get files out:

```bash
# A single file
restic dump latest /userdata/gabriel/documents/<file> > ~/Downloads/<file>

# A small folder, as one zip file
restic dump --archive zip latest /userdata/gabriel/documents > ~/Downloads/documents.zip

# A big folder, restored file by file
restic restore latest --target ~/Restore --include /userdata/gabriel/photos/raw
```

`dump` is handy for a file or a small folder. For anything big, `restore` is better: it writes the files directly, and if it's interrupted, running it again continues where it stopped.

## Where we are

- My photos and videos are on the HDD and the personal folders are backed up to Backblaze B2 every night
- The backup is encrypted on the Pi, keeps a year of history and costs about $0.28 a month
- Only the Pi has the B2 key, so ransomware on one of my devices can't touch the backups
- I can restore from the Backrest UI or from any computer with restic if the Pi is gone
- The "Storage" column on my dashboard now has a Backrest card next to the two Samba ones

Now, after setting this up, I can finally delete the photos and videos from my computer!

There are a few things I might do next. Backrest can send alerts when a backup fails, for example through [Healthchecks.io](https://healthchecks.io), which also notices when a backup doesn't run at all. Once my photos get close to 500 GB, I'll switch from B2 to a Hetzner Storage Box. And some day, the drive will move into a NAS. When that happens, the off-site backup stays exactly where it is.

## References
- Backblaze - B2 Cloud Storage pricing: https://www.backblaze.com/cloud-storage/pricing
- Backblaze - Data caps and alerts: https://www.backblaze.com/docs/cloud-storage-data-caps-and-alerts
- Backblaze - The 3-2-1 backup strategy: https://www.backblaze.com/blog/the-3-2-1-backup-strategy/
- restic - Preparing a new repository (Backblaze B2): https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html
- Backrest - GitHub repository: https://github.com/garethgeorge/backrest
- Hetzner - Storage Box: https://www.hetzner.com/storage/storage-box/
