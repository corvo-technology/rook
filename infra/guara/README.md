# Rook on Guará Cloud

One image (`infra/guara/Dockerfile`) runs the Rook servers. `CORVO_ROLE` picks the process:
`api` (migrations, owner bootstrap, then the API) or `worker` (Graphile worker, no port). The
web UI is a static build and is hosted separately; this image no longer carries it.

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
| `OWNER_EMAIL`, `OWNER_PASSWORD` | yes | no | Bootstrap the first account. Unset the password afterwards. |
| `SIGNUPS_ENABLED` | `false` | no | |
| `OBJECT_STORAGE_*` | yes | yes | Required when API and worker are separate services; create the bucket first. Use `OBJECT_STORAGE_PATH_STYLE=true` for MinIO. |
| `SANDBOX_PROVIDER`, `E2B_API_KEY`, `E2B_DOMAIN` | yes | yes | |
| `RELAX_RUNTIME_ROLE` | build | build | Set to `1` as a build variable (`guara env set -b`) only when the database owner cannot create roles. A few migrations grant to `corvo_app` unconditionally; this makes those statements no-ops while the role is missing. Rook then runs as the owner without row-level security. |

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

