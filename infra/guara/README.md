# Rook on Guará Cloud

One image (`infra/guara/Dockerfile`) runs every Rook process. `CORVO_ROLE` picks it:
`api` (migrations, owner bootstrap, then the API), `worker` (Graphile worker, no port) or
`web` (`vite preview`, with the `/api`, `/rpc` and noVNC proxies).

Create the services with a Dockerfile build, root directory `.` and Dockerfile path
`infra/guara/Dockerfile`. The worker has no HTTP port and no health endpoint.

## Environment

| Variable | API | Worker | Web | Notes |
| --- | --- | --- | --- | --- |
| `CORVO_ROLE` | `api` | `worker` | `web` | |
| `DATABASE_URL` | yes | yes | no | Direct Postgres connection, not a transaction pooler. |
| `DATABASE_MIGRATION_URL` | optional | no | no | Owner login. Set it with a separate runtime `DATABASE_URL` to enforce row-level security; see `docs/self-host.md`. |
| `ENCRYPTION_KEY`, `CONTENT_ENCRYPTION` | yes | yes | no | Identical on API and worker. Back the key up. |
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `WEB_ORIGIN` | yes | no | no | URLs are the public web origin. |
| `SCREEN_PROXY_SECRET` | yes | no | yes | 32+ characters, identical on API and web. |
| `API_HOST`, `API_PORT` | `0.0.0.0`, `3100` | no | no | `PORT` and `NODE_ENV` are reserved on Guará. |
| `API_URL` | yes | yes | no | |
| `OWNER_EMAIL`, `OWNER_PASSWORD` | yes | no | no | Bootstrap the first account. Unset the password afterwards. |
| `SIGNUPS_ENABLED` | `false` | no | no | |
| `OBJECT_STORAGE_*` | yes | yes | no | Required when API and worker are separate services; create the bucket first. Use `OBJECT_STORAGE_PATH_STYLE=true` for MinIO. |
| `SANDBOX_PROVIDER`, `E2B_API_KEY`, `E2B_DOMAIN` | yes | yes | no | |
| `FORCE_OWNER_RLS` | `1` | no | no | For a database whose only login is the table owner (no CREATEROLE, so no `corvo_app` runtime login). `owner-rls.mjs` runs `FORCE ROW LEVEL SECURITY` on every table that has it enabled, after the migrations (relaxed while they run), so the tenant policies apply to the owner login too. |
| `RELAX_RUNTIME_ROLE` | build | build | no | Build variable (`guara env set -b`), fallback only, not for production. A few migrations `GRANT ... TO corvo_app` unconditionally and fail when the role cannot be created; this makes those statements no-ops while the role is missing. Prefer a database login that can create the role. |
| `API_PROXY_TARGET`, `CORVO_HOST`, `WEB_PORT` | no | no | yes | Proxy target is the API URL; `CORVO_HOST` is the public host. |

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

## Row-level security

Rook enforces tenant isolation with policies that name no role. With a separate runtime login
(`DATABASE_URL`) and an owner login (`DATABASE_MIGRATION_URL`), nothing else is needed. When the
database gives only an owner login, set `FORCE_OWNER_RLS=1` on the API (see the table): the
policies then apply to that login, so a query without a tenant context sees no rows and a
query under one tenant sees only its rows. The role split remains stronger, because the owner can
also change the schema.

## What is written where

| Path | Written by | Notes |
| --- | --- | --- |
| `/data/scratch/{tmp,cache,home}` | all roles | `TMPDIR`, `HOME`, `XDG_CACHE_HOME`. Falls back to `/tmp/rook` when `/data` is not writable. Mount a Guará volume on `/data` so this does not use the pod's ephemeral disk. |
| `DATA_DIR` (`/data`) | API, worker | Cache for bot homes and artifacts when `OBJECT_STORAGE_*` is set; the only copy when it is not. |
| `apps/web/node_modules/.vite-temp` | web | Vite's config bundle, small. |
| stdout | all roles | Logs; `LOG_LEVEL=info`. Nothing is written to log files. |

The image itself is built from only the packages the three roles run, and no step at start
installs or compiles anything.

## Pooler

A Guará catalog Postgres is reached through a connection pooler that defaults to transaction
mode. Graphile Worker and the realtime feed use `LISTEN/NOTIFY`, which needs session mode: set
**Settings > Connection pool > Session** on the database in the dashboard.
