# Rook on Guará Cloud

One image (`infra/guara/Dockerfile`) runs the Rook servers. `CORVO_ROLE` picks the process:
`api` (migrations, owner bootstrap, then the API) or `worker` (Graphile worker, no port). The
web UI is not in this image: `infra/guara/Dockerfile.web` builds it (see
[Dockerfiles](#dockerfiles)).

Create the services with a Dockerfile build, root directory `.` and Dockerfile path
`infra/guara/Dockerfile`. The worker has no HTTP port and no health endpoint.

## Environment

| Variable | API | Worker | Notes |
| --- | --- | --- | --- |
| `CORVO_ROLE` | `api` | `worker` | |
| `DATABASE_URL` | yes | yes | Direct Postgres connection, not a transaction pooler. |
| `DATABASE_MIGRATION_URL` | optional | no | Owner login. Set it with a separate runtime `DATABASE_URL` to enforce row-level security; see `docs/self-host.md`. |
| `ENCRYPTION_KEY`, `CONTENT_ENCRYPTION` | yes | yes | Identical on API and worker. Back the key up. |
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `WEB_ORIGIN` | yes | no | URLs are the public web origin. |
| `SCREEN_PROXY_SECRET` | yes | no | 32+ characters, identical on API and the web host. |
| `API_HOST`, `API_PORT` | `0.0.0.0`, `3100` | no | `PORT` and `NODE_ENV` are reserved on Guará. |
| `API_URL` | yes | yes | |
| `BROWSER_EGRESS_PROXY_URL`, `BROWSER_EGRESS_USD_PER_GB`, `BROWSER_EGRESS_GATEWAY_URL` | optional | optional | Residential egress for cloud agent browsers; see `docs/self-host.md`. The URL holds the provider password. Set the first on both; the price on the API. |
| `OWNER_EMAIL`, `OWNER_PASSWORD` | yes | no | Bootstrap the first account. Unset the password afterwards. |
| `SIGNUPS_ENABLED` | `false` | no | |
| `OBJECT_STORAGE_*` | yes | yes | Required when API and worker are separate services; create the bucket first. Use `OBJECT_STORAGE_PATH_STYLE=true` for MinIO. |
| `SANDBOX_PROVIDER`, `E2B_API_KEY`, `E2B_DOMAIN` | yes | yes | |
| `RELAX_RUNTIME_ROLE` | build | build | Set to `1` as a build variable (`guara env set -b`) only when the database owner cannot create roles. A few migrations grant to `corvo_app` unconditionally; this makes those statements no-ops while the role is missing. Rook then runs as the owner without row-level security. |

## Zero-downtime API deploys

The API drains on SIGTERM: `/ready` and `/health` answer 503 at once, it keeps serving for 5 s
while the platform reroutes, stops accepting, lets in-flight requests finish, ends event streams
so clients reconnect, and exits within 25 s. A new API answers `/ready` only after migrations ran,
the routes are mounted and the database answers, because the port opens last (about 25 s after the
container starts on 1 CPU).

The web app's proxy answers 502 while no API accepts connections, and clients retry sends (and a
few idempotent calls) through 502, 503, 504 and network errors for up to 30 s. That covers a short
gap, not a rollout that stops the old pod before the new one is ready.

Settings the owner must apply in the Guará dashboard (the CLI, 0.3.0, exposes none of them):

| Setting | Value |
| --- | --- |
| Readiness probe | HTTP GET `/ready` on port 3100, initial delay 20 s, period 2 s, failure threshold 3 |
| Liveness probe | HTTP GET `/health` on port 3100, period 10 s, failure threshold 6 (tolerates a slow boot) |
| Rollout | Rolling update, max surge 1, max unavailable 0: the new pod is ready before the old one stops |
| Termination grace period | at least 30 s (the API's drain deadline is 25 s) |
| Replicas | 2 if the platform cannot surge past 1 replica |

With one replica and no surge the old pod stops first and users see the gap until the new API is
listening; set 2 replicas (autoscaling min 2, max 2 is the CLI's `guara scale` way to get there).
Two API replicas need `OBJECT_STORAGE_*` set (artifacts must not live on one pod's volume) and
the default Postgres realtime (`REALTIME_DATABASE_URL` or `DATABASE_URL`), so events reach every
replica; see the shared-storage migration in `docs/self-host.md` first. Leave the worker at one.

## Commands

```bash
guara catalog deploy postgres --name my-db --version 18-alpine --storage 10 --config databaseName=rook -y
guara catalog deploy minio --name my-storage --storage 10 -y
guara services create --name my-api --build-method dockerfile --repo <repo-url> --branch main \
  --root-dir . --dockerfile-path infra/guara/Dockerfile --port 3100 --public --no-auto-deploy -y
guara services create --name my-worker --build-method dockerfile --repo <repo-url> --branch main \
  --root-dir . --dockerfile-path infra/guara/Dockerfile --service-type worker --no-auto-deploy -y
guara env set -s <slug> --from-file <file> -y
guara deploy -s <slug> -y
```

## Dockerfiles

Every image is built from the repository root (`docker build -f <Dockerfile> .`), so the
Docker context is always `.`. None needs BuildKit-only syntax. Each copies only the manifests
of the packages it builds before it copies their sources, so an edit to code re-runs the build
but not the install, and a change to another app's manifest re-runs neither. The root
`.dockerignore` keeps `.git`, docs, tests, e2e suites, the desktop and mobile sources and
local files out of the context. Node builds are capped with `--max-old-space-size=1536`.

| Dockerfile | Builds | Final image | Port |
| --- | --- | --- | --- |
| `infra/guara/Dockerfile` | API and worker, chosen at start by `CORVO_ROLE` | `node:22-bookworm-slim`, production dependencies and the compiled servers | 3100 (API) |
| `infra/guara/Dockerfile.web` | The web app and its server | `node:22-bookworm-slim`, Vite, the config, `dist` | 5173 |
| `apps/www/Dockerfile` | The landing page (static Astro build) | `nginx:1.27-alpine` | 80 |
| `infra/compose/Dockerfile` | Everything, for Docker Compose and the self-host stack | `node:22-bookworm`, about 3.7 GB | 3100, 5173, 7091 |

### Web app (`infra/guara/Dockerfile.web`)

The web app is not static. `vite preview` serves `dist`, proxies `/api` and `/rpc` to
`API_PROXY_TARGET`, runs the noVNC screen proxy and sets the security headers. The image
starts it with `node` directly (no pnpm), so a stop signal reaches it, and the default `CMD`
needs no override. At run time it holds Vite, its dependencies for this platform, the config
and the workspace sources the config imports; React, Sentry and the rest are already in `dist`.
The image runs as `node` (uid 1000) and has a `HEALTHCHECK` on `/build-id`.

Dokploy settings (application, Git provider, public repository):

| Setting | Value |
| --- | --- |
| Repository, branch | `corvo-technology/rook`, `main` |
| Build type | Dockerfile |
| Docker File | `infra/guara/Dockerfile.web` |
| Docker Context Path | `.` |
| Docker Build Stage | empty |
| Port (Domains tab) | `5173` |
| Build argument (optional) | `GIT_SHA`, recorded in the image label only |
| Volume (Advanced > Volumes) | named volume `webassets` mounted at `/app/apps/web/asset-archive` |

Environment (runtime):

| Variable | Notes |
| --- | --- |
| `API_PROXY_TARGET` | URL of the API, for example `https://rook-api-b2c2e5-rook.guaracloud.com`. |
| `SCREEN_PROXY_SECRET` | 32+ characters, identical to the API's. |
| `CORVO_HOST` | The public host name of the web app; the server rejects other `Host` headers. |
| `CORVO_ALLOWED_HOSTS` | Optional, comma-separated extra host names. |
| `CORVO_CSP_SCRIPT_SRC`, `CORVO_CSP_CONNECT_SRC` | Optional extra origins for the Content-Security-Policy. |
| `CRISP_WEBSITE_ID` | Optional, enables the Crisp support chat. |
| `WEB_PORT` | Optional, default `5173`. |

The asset archive keeps the hashed files of recent builds so tabs still running the previous
deploy keep loading their chunks. It is on only when `/app/apps/web/asset-archive` exists,
which the image creates, writable by uid 1000; the server prunes it itself. Without the
volume it is lost at every deploy and a tab on the old build can hit a 404 for a chunk. A
bind mount must be `chown 1000:1000`. At run time the server writes nothing else to disk.

```bash
docker build -f infra/guara/Dockerfile.web -t rook-web .
docker run --rm -p 5173:5173 \
  -e API_PROXY_TARGET=https://api.example.com -e SCREEN_PROXY_SECRET=<32+ characters> \
  -e CORVO_HOST=localhost -v rook-webassets:/app/apps/web/asset-archive rook-web
```

### Landing page (`apps/www/Dockerfile`)

| Setting | Value |
| --- | --- |
| Repository, branch | `corvo-technology/rook`, `main` |
| Build type | Dockerfile |
| Docker File | `apps/www/Dockerfile` |
| Docker Context Path | `.` |
| Port (Domains tab) | `80` |
| Build arguments (optional) | `PUBLIC_POSTHOG_KEY`, `PUBLIC_POSTHOG_HOST`, `PUBLIC_CRISP_WEBSITE_ID` |

The build arguments are public values baked into the pages, so changing one needs a rebuild.
In Dokploy set them as build-time variables of the application. The image has no run-time
settings.

```bash
docker build -f apps/www/Dockerfile -t rook-www \
  --build-arg PUBLIC_POSTHOG_KEY=<key> --build-arg PUBLIC_POSTHOG_HOST=<host> \
  --build-arg PUBLIC_CRISP_WEBSITE_ID=<id> .
docker run --rm -p 8080:80 rook-www
```

### API and worker (`infra/guara/Dockerfile`)

```bash
docker build -f infra/guara/Dockerfile -t rook-api .
docker run --rm -e CORVO_ROLE=api -e DATABASE_URL=<url> ... rook-api
```

The API reports the web build deployed beside it from `apps/web/dist/build-id`; this image
writes that file with its own build time instead of building the web app for it.

## Image and start-up

The image has three stages: `build` compiles the servers, `prod-deps` installs only their
production dependencies (and removes the Expo/React Native, Vite, TypeScript and Prisma CLI
tooling that peer and optional dependencies still pull in, plus native binaries for other
platforms), and the last stage copies both onto `node:22-bookworm-slim`. No source tree,
dev dependency, package manager or compiler is in the final image, and nothing in it is
changed with `chmod -R` or `chown -R`, so no layer duplicates another.

The API applies the checked-in migrations itself (`MIGRATIONS_DIR`, the path the desktop app
uses) instead of starting `pnpm` and the Prisma CLI, which cost about ten seconds of CPU
at every start. The records it writes to `_prisma_migrations` are the ones
`prisma migrate deploy` writes, so a database can move between the two.

## What is written where

| Path | Written by | Notes |
| --- | --- | --- |
| `/data/scratch/{tmp,cache,home}` | all roles | `TMPDIR`, `HOME`, `XDG_CACHE_HOME`. Falls back to `/tmp/rook` when `/data` is not writable. Mount a Guará volume on `/data` so this does not use the pod's ephemeral disk. |
| `DATA_DIR` (`/data`) | API, worker | Cache for bot homes and artifacts when `OBJECT_STORAGE_*` is set; the only copy when it is not. |
| stdout | all roles | Logs; nothing is written to log files. |

At start the API wrote about 1 MB (Node's compile cache and the Prisma CLI's update check).

