#!/usr/bin/env bash
# Managed Postgres whose owner login lacks CREATEROLE cannot create the corvo_app
# runtime role, and a few migrations GRANT to it unconditionally. Make those
# statements a no-op while the role does not exist. Build-time only, opt in with
# RELAX_RUNTIME_ROLE=1; the images then run as the owner (no row-level security).
set -euo pipefail
cd "$(dirname "$0")/../../packages/db/prisma/migrations"
perl -0pi -e 's{^((?:GRANT|REVOKE)[^;\x27]*\b(?:TO|FROM) corvo_app;)[ \t]*$}{DO \$relax\$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = \x27corvo_app\x27) THEN EXECUTE \x27$1\x27; END IF; END \$relax\$;}mg' */migration.sql
