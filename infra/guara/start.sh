#!/usr/bin/env bash
set -euo pipefail

# One entrypoint for the Guará image. CORVO_ROLE picks the process.
case "${CORVO_ROLE:?set CORVO_ROLE to api, worker or web}" in
  api)
    cd /app/apps/api
    # DATABASE_MIGRATION_URL is the database owner; DATABASE_URL is the runtime login
    # that the migration step provisions. The owner URL is dropped once it has run.
    node --enable-source-maps dist/cli/migrate-database.js
    unset DATABASE_MIGRATION_URL
    if [[ -n "${OWNER_EMAIL:-}" && -n "${OWNER_PASSWORD:-}" ]]; then
      node --enable-source-maps dist/cli/bootstrap-owner.js
    fi
    unset OWNER_PASSWORD
    exec node --enable-source-maps dist/index.js
    ;;
  worker)
    cd /app/apps/worker
    exec node --enable-source-maps dist/index.js
    ;;
  web)
    cd /app/apps/web
    exec env -u DATABASE_URL -u ENCRYPTION_KEY -u BETTER_AUTH_SECRET \
      node_modules/.bin/vite preview --host 0.0.0.0 --port "${WEB_PORT:-5173}"
    ;;
  *)
    echo "unknown CORVO_ROLE: ${CORVO_ROLE}" >&2
    exit 64
    ;;
esac
