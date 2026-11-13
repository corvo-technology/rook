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
