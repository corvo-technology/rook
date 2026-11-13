#!/usr/bin/env bash
set -euo pipefail

# One entrypoint for the Guará image. CORVO_ROLE picks the process.
#
# Writable footprint: the image is read-only data. Temp files and tool caches go under
# /data/scratch when a volume is mounted there (a Guará volume does not count against the
# pod's ephemeral disk), otherwise under /tmp/rook.
if [[ -w /data ]]; then scratch=/data/scratch; else scratch=/tmp/rook; fi
mkdir -p "$scratch/tmp" "$scratch/cache" "$scratch/home"
find "$scratch/tmp" -mindepth 1 -delete 2>/dev/null || true
export TMPDIR="$scratch/tmp" HOME="$scratch/home" XDG_CACHE_HOME="$scratch/cache" \
  npm_config_cache="$scratch/cache/npm" COREPACK_ENABLE_AUTO_PIN=0 COREPACK_ENABLE_DOWNLOAD_PROMPT=0

case "${CORVO_ROLE:?set CORVO_ROLE to api, worker or web}" in
  api)
    cd /app/apps/api
    # Owner-only database (no CREATEROLE): FORCE_OWNER_RLS=1 keeps row-level security
    # enforced for the owner login. Migrations run with it relaxed.
    if [[ "${FORCE_OWNER_RLS:-}" == "1" ]]; then node /app/infra/guara/owner-rls.mjs relax; fi
    # DATABASE_MIGRATION_URL is the database owner; DATABASE_URL is the runtime login
    # that the migration step provisions. The owner URL is dropped once it has run.
    node --enable-source-maps dist/cli/migrate-database.js
    if [[ "${FORCE_OWNER_RLS:-}" == "1" ]]; then node /app/infra/guara/owner-rls.mjs force; fi
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
