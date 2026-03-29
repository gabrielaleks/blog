+++
author = "Gabriel Aleksandravicius"
title = "Automated deployments to a private server using Tailscale GitHub Action"
date = "2026-03-12"
summary = "Part 5 of the homelab series: building a CI/CD pipeline for a multi-container app on the Raspberry Pi using cross-platform Docker builds, GitHub Container Registry and using the Tailscale GitHub Action to reach a server that's never publicly exposed."
tags = [
  "github-actions",
  "tailscale",
  "docker",
  "ci/cd",
  "traefik",
  "deploy",
  "homelab",
  "self-hosting",
  "raspberry-pi"
]
categories = [
  "homelab"
]
+++

So far we've talked about running third-party apps on the homelab, such as Home Assistant and Portainer. Using them is straightforward: a Docker Compose file pointing to an existing image. But what about apps we develop ourselves? This post tackles that scenario: I walk through a small app I wrote for personal use, explain how it's built for the Pi's architecture, and then cover the main challenge — automating deployment to a server that's never publicly exposed.

## What Lista is

My girlfriend and I use WhatsApp to coordinate groceries. We have a group chat to keep track of what we need before every supermarket visit. Lista replaces that: it's a shared grocery list accessible through the homelab.

The stack is straightforward:

- **React** frontend served by Nginx
- **Node.js** backend handling the API
- **PostgreSQL** for persistence
- **dbmate** for schema migrations

All four run as separate containers on the Pi (with dbmate being a one-shot service). [The source lives in a monorepo on GitHub](https://github.com/gabrielaleks/lista), with separate directories for `frontend/` and `backend/` and a shared `db/` directory for migration files.

## Running on the Pi

I don't want source code / build artifacts living on the Pi - philosophically, its purpose is to host every app in the Homelab without needing to know anything about how they run. That's why the apps I develop should be dockerized - the full plan is to build the Docker images and use them on the Pi, having all of the necessary configuration on Docker compose files.

Lista is no different and the app follows the same pattern as in post 4: a `docker-compose.yaml` on the Pi and a YAML file in `traefik/dynamic/` for routing. The compose file defines four services — database, db-migrations, backend and frontend. The database and migrations only join an internal `lista-network`; the database never touches the `traefik` network. The backend and frontend join both, so Traefik can reach them while they can still talk to the database internally. Traefik routes both services under the same hostname using a path prefix: `lista.kaoshome.dev/api` goes to the backend, everything else to the frontend.

### The deployment challenge: cross-platform builds

GitHub Actions runners are `x86_64` (amd64). The Raspberry Pi is `arm64`. If you run `docker build` on the GitHub runner and push the result, the image will be built for amd64. When the Pi tries to pull and run it, Docker will refuse as the architecture doesn't match.

The solution is cross-platform builds with **QEMU** and **Docker Buildx**.

QEMU is a machine emulator. In the context of Docker builds, it allows an amd64 machine to run and execute code compiled for a different architecture, in this case, arm64. Docker Buildx uses QEMU under the hood to emulate the target platform during the build.

The problem: QEMU emulation is slow. Running the entire build under emulation — package installation, compilation, everything — can multiply build times significantly (in my tests it was about 4× slower than a native build). For a production image with a `node_modules` install step, that becomes painful quickly.

#### Keeping builds fast: `FROM --platform=$BUILDPLATFORM`

A multi-stage Dockerfile typically looks like this:

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS production
WORKDIR /app
COPY --from=builder /app/dist ./dist
CMD ["node", "dist/index.js"]
```

Without any platform flags, every stage runs under QEMU when building for arm64 on an amd64 runner. That includes the `builder` stage with its `npm ci` and compilation — the slowest parts.

Add `--platform=$BUILDPLATFORM` to only the build stages:

```dockerfile
FROM --platform=$BUILDPLATFORM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS production
WORKDIR /app
COPY --from=builder /app/dist ./dist
CMD ["node", "dist/index.js"]
```

`$BUILDPLATFORM` is a Docker Buildx built-in variable that resolves to the platform of the machine running the build — `linux/amd64` on a GitHub Actions runner. With this flag, the `builder` stage runs natively on the runner without any emulation. Only the final `production` stage runs under QEMU and all it does is copy files and set a start command.

The general rule is: use `--platform=$BUILDPLATFORM` on any stage that compiles, installs dependencies, or does heavy processing. Leave it off the final stage — that's the image the Pi will actually run and it needs to be arm64.

## The build-and-push job

With QEMU and the `--platform=$BUILDPLATFORM` trick in place, the workflow step that builds and pushes the image is straightforward. It sets up QEMU and Docker Buildx, authenticates to GitHub Container Registry (GHCR), and runs the build targeting `linux/arm64`:

```yaml
# .github/workflows/deploy-backend.yml
jobs:
  build-and-push:
    runs-on: ubuntu-latest

    permissions:
      contents: read
      packages: write
      id-token: write

    steps:
      - name: Checkout repository
        uses: actions/checkout@v3

      - name: Set up QEMU
        uses: docker/setup-qemu-action@v2

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v2

      - name: Log in to GitHub Container Registry
        uses: docker/login-action@v2
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GHCR_PAT }}

      - name: Build and push backend image
        run: |
          docker buildx build \
            --platform linux/arm64 \
            -t ghcr.io/gabrielaleks/lista-backend:latest \
            -f backend/Dockerfile \
            --target production \
            --cache-from type=gha \
            --cache-to type=gha,mode=max \
            --push .
```

## Connecting the runner to the tailnet

At this point the pipeline is only half-automated: pushing code triggers a build and pushes the image to the registry, but getting it onto the Pi still requires manually SSHing in, pulling the new image and restarting the containers.

To complete the automation, the deploy job needs to SSH into the Pi — but a GitHub Actions runner is an ephemeral cloud VM with no knowledge of the tailnet. Remember: the Pi is not publicly reachable. It has no open ports. The only way to reach it is via Tailscale.

The [Tailscale GitHub Action](https://github.com/tailscale/github-action) solves this perfectly by temporarily joining the runner to the tailnet for the duration of the workflow. The runner gets a Tailscale IP, can resolve `100.x.x.x` addresses and can reach the Pi directly over the encrypted WireGuard tunnel — just like any other tailnet device! When the workflow finishes, the runner leaves the tailnet.

### Setting up Tailscale for CI

The action needs a credential to authenticate the runner to the tailnet. There are two options: OAuth and OIDC. **Use OIDC.**

With OAuth, you generate a long-lived client secret and store it as a GitHub secret. That secret can authenticate any device to your tailnet indefinitely. If it leaks — through a compromised repo, an accidental log, a copied workflow file — you have an unlimited credential.

OIDC (OpenID Connect) works differently. Instead of a static secret, GitHub issues the runner a short-lived JWT at the start of each workflow run. This token is cryptographically bound to the specific repository, branch and workflow that's running. Tailscale verifies the token directly with GitHub's OIDC provider — no static secret is ever stored anywhere. When the run ends, the token expires and is worthless.

This is the model suggested by Tailscale and the one I chose for my CI/CD pipeline: the credential is ephemeral, scoped to the exact workflow and can't be reused outside it.

#### Step 1: Create a tag in Tailscale Access Controls

In the Tailscale admin console, define a tag for CI devices under **Access Controls**. Tags in Tailscale are how you apply ACL rules to a class of devices rather than individual users:

{{< figure src="/images/automated-deployments-to-a-private-server-using-tailscale-github-action/tag-creation.png" alt="Tailscale Access Controls page showing the tag:ci definition" caption="Defining the `tag:ci` tag under Access Controls." >}}

Then add an access rule that allows devices with `tag:ci` to reach the Pi on port 22:

{{< figure src="/images/automated-deployments-to-a-private-server-using-tailscale-github-action/acl-rule.png" alt="Tailscale ACL rule allowing tag:ci to reach the Pi" caption="The ACL rule limits CI runners to SSH access on the Pi only." >}}

#### Step 2: Create an OIDC credential

In the Tailscale admin console, go to **Settings → Trust credentials** and click **+ Credential**. Select OpenID Connect and add a description (like "GitHub CI/CD runner").

Select GitHub as the issuer and choose the appropriate subject. In my case I used `repo:gabrielaleks/lista:ref:refs/heads/master` — see [GitHub's documentation on subject claims](https://docs.github.com/en/actions/security-for-github-actions/security-hardening-your-deployments/about-security-hardening-with-openid-connect#example-subject-claims) for the full format options.

Click Continue and pick the scope. The **only** scope needed to authenticate with Tailscale is **Keys → Auth Keys**. Choose Write and select `tag:ci` as the tag.

Save and copy the **client ID** and **audience** values that Tailscale provides.

#### Step 3: Add GitHub secrets

In your repository settings under **Secrets and variables → Actions**, add:

- `TS_OAUTH_CLIENT_ID`: the client ID from the OIDC credential
- `TS_AUDIENCE`: the audience value from the OIDC credential

With all of this in place, you should already be able to authenticate to Tailscale via GitHub actions.

The next step is to configure the SSH connection. First, generate a dedicated key pair:

```bash
ssh-keygen -t ed25519 -C "homelab-github-actions-deploy" -f ~/.ssh/homelab_github_actions_deploy
```

This creates two files: `~/.ssh/homelab_github_actions_deploy` (private key) and `~/.ssh/homelab_github_actions_deploy.pub` (public key). Copy the public key to the Pi:

```bash
ssh-copy-id -i ~/.ssh/homelab_github_actions_deploy.pub youruser@yourpi
```

Then add the private key as a GitHub secret:

- `RPI_SSH_KEY`: contents of `~/.ssh/homelab_github_actions_deploy`

Finally, add the remaining deploy secrets:

- `RPI_TAILSCALE_IP`: the Pi's `100.x.x.x` address (run `tailscale ip -4` on the Pi to get it)
- `RPI_USER`: your Pi username
- `RPI_DEPLOY_PATH`: absolute path to the folder where you keep the project to-be-pulled on the Pi

#### Step 4: The deploy job

```yaml
# Rest of the file
...

# Add this as a second job
  deploy:
    runs-on: ubuntu-latest
    needs: build-and-push

    permissions:
      id-token: write

    steps:
      - name: Authenticate with Tailscale
        uses: tailscale/github-action@v4
        with:
          oauth-client-id: ${{ secrets.TS_OAUTH_CLIENT_ID }}
          audience: ${{ secrets.TS_AUDIENCE }}
          tags: tag:ci
          use-cache: 'true'

      - name: Deploy to Raspberry Pi
        uses: appleboy/ssh-action@v1.0.3
        with:
          host: ${{ secrets.RPI_TAILSCALE_IP }}
          username: ${{ secrets.RPI_USER }}
          key: ${{ secrets.RPI_SSH_KEY }}
          script: |
            cd ${{ secrets.RPI_DEPLOY_PATH }}
            docker compose pull
            docker compose up -d --force-recreate
```

**`permissions: id-token: write`** is required for OIDC. Without it, the runner can't request the JWT from GitHub's token endpoint. The Tailscale action will fail to authenticate if this permission is missing.

**`use-cache: 'true'`** caches the Tailscale binary between runs to avoid re-downloading it every time.

After the Tailscale step completes, the runner is on the tailnet. The next step uses [`appleboy/ssh-action`](https://github.com/appleboy/ssh-action): a GitHub Action that SSHes into a remote machine and runs a script. It takes the host address, username and private key, establishes the SSH connection and executes whatever is in `script`. Here it connects to the Pi using the Tailscale IP (now reachable since the runner joined the tailnet) and runs two commands: `docker compose pull` to fetch the new image that was just pushed by the build job and `docker compose up -d --force-recreate` to restart the containers with it. `--force-recreate` is necessary because `latest` is a mutable tag and Docker won't recreate a running container just because the underlying image was updated, so we have to force it.

While the workflow is running, if you check the Tailscale admin console you'll see an extra machine joined to your tailnet: the GitHub Actions runner! It disappears the moment the job finishes.

{{< figure src="/images/automated-deployments-to-a-private-server-using-tailscale-github-action/ephemeral-runner.png" alt="Tailscale admin console showing the ephemeral GitHub Actions runner joined to the tailnet" caption="The GitHub Actions runner appears as a device on the tailnet while the workflow runs, then disappears automatically." >}}

## The full flow

When a push lands on `master`:

```
GitHub Actions runner starts
  → build-and-push job
    → builds linux/arm64 image using QEMU (final stage only)
    → pushes to ghcr.io/gabrielaleks/lista-backend:latest

  → deploy job (waits for build-and-push)
    → runner requests OIDC token from GitHub
    → Tailscale action joins runner to tailnet as tag:ci
    → runner can now reach 100.x.x.x:22

    → SSH into Pi
      → docker compose pull (fetches the new arm64 image)
      → docker compose up -d --force-recreate (restarts with new image)

    → runner disconnects from tailnet
```

{{< figure src="/images/automated-deployments-to-a-private-server-using-tailscale-github-action/github-actions-workflow-run.png" alt="GitHub Actions workflow showing build-and-push and deploy jobs completing successfully" caption="Both jobs completing successfully. The deploy job waits for build-and-push to finish before running." >}}

The Pi never has a public port open at any point in this flow! To ensure that the Pi is reachable from GitHub Actions, an ephemeral CI runner is created during the execution of the pipeline, is temporarily authorized to reach port 22 on the Pi and is used to run the deployment commands. When the deployment is finished, this runner is destroyed.

## Where we are

{{< figure src="/images/automated-deployments-to-a-private-server-using-tailscale-github-action/lista-page.png" alt="Lista app running at https://lista.kaoshome.dev" >}}

Lista is now live at `https://lista.kaoshome.dev` with a fully automated deployment pipeline. Pushing to `master` is all it takes to get new code running on the Pi.

The same pipeline pattern works for the frontend and migrations with minor adjustments. Different `paths` filter, different image name, same structure. Each service gets its own workflow file triggered only when its own code changes.

## References
Tailscale's documentation on this topic is thorough. Here are the pages I found most useful:
- [Tailscale GitHub Action](https://tailscale.com/docs/integrations/github/github-action)
- [Connect GitHub CI/CD workflows to private infrastructure](https://tailscale.com/docs/solutions/connect-github-CICD-workflows-to-private-infrastructure-without-public-exposure)
- [Ephemeral nodes](https://tailscale.com/docs/features/ephemeral-nodes)