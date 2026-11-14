#!/usr/bin/env bash
set -euo pipefail

# One entrypoint for the Guará image. CORVO_ROLE picks the process.
#
# Writable footprint: the image is read-only data. Temp files and tool caches go under
# /data/scratch when a volume is mounted there (a volume does not count against the pod's
# ephemeral disk), otherwise under /tmp/rook.
if [[ -w /data ]]; then scratch=/data/scratch; else scratch=/tmp/rook; fi
mkdir -p "$scratch/tmp" "$scratch/cache" "$scratch/home"
find "$scratch/tmp" -mindepth 1 -delete 2>/dev/null || true
export TMPDIR="$scratch/tmp" HOME="$scratch/home" XDG_CACHE_HOME="$scratch/cache"

case "${CORVO_ROLE:?set CORVO_ROLE to api or worker}" in
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
  *)
    echo "unknown CORVO_ROLE: ${CORVO_ROLE}" >&2
    exit 64
    ;;
esac
