# One image for every Rook process on Guará Cloud, chosen at start by CORVO_ROLE
# (api or worker). It avoids BuildKit-only syntax (cache mounts, COPY --chmod) so any Docker
# builder can build it. The web app is not in it: infra/guara/Dockerfile.web builds that.
#
# Three stages keep the final image small: `build` has every dependency and compiles the
# servers, `prod-deps` installs only the production dependencies the two servers run, and
# the last stage copies the compiled output over them onto a slim base. The servers are
# bundled by scripts/build-server.mjs, which rewrites each package import to a relative
# path into node_modules/.pnpm, so node_modules must keep the layout pnpm made; the
# production install reads the same lockfile and so produces the same directory names.
FROM node:22-bookworm@sha256:0557ac14e0d45d02ed563067b82856ca5e7aa3437fa28d98d4350ea9c3d9494a AS base
ENV COREPACK_HOME=/usr/local/share/corepack
RUN corepack enable
WORKDIR /app
# Manifests first so a source edit does not re-run the install. Only the manifests of the
# packages the two servers depend on are copied (pnpm still checks the lockfile against them),
# so a change to the web, desktop or mobile manifests does not re-run it either. When the API
# or worker gains a workspace dependency, add its manifest here; the install then fails by name.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN corepack install && chmod -R a+rX "${COREPACK_HOME}"
COPY patches patches
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY packages/adapter-kit/package.json packages/adapter-kit/
COPY packages/adapters/package.json packages/adapters/
COPY packages/auth/package.json packages/auth/
COPY packages/contracts/package.json packages/contracts/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/logging/package.json packages/logging/
COPY packages/memory/package.json packages/memory/
COPY packages/ui-tokens/package.json packages/ui-tokens/

FROM base AS prod-deps
RUN pnpm install --frozen-lockfile --prod --store-dir /tmp/pnpm-store \
    --filter "@corvo/api..." --filter "@corvo/worker..." \
  && rm -rf /tmp/pnpm-store
# Peer and optional dependencies of production packages still bring in tooling the servers
# never load (the Expo and React Native client toolchain, Vite, TypeScript, the Prisma CLI
# and its studio) and native binaries for other platforms. Removing them leaves dangling
# links inside node_modules/.pnpm, which nothing follows.
RUN cd node_modules/.pnpm \
  && rm -rf react-native@* react-native-* @react-native+* expo@* expo-* @expo+* \
    hermes-compiler@* react-devtools-core@* fb-dotslash@* typescript@* @typescript+* \
    prettier@* vite@* vitest@* rolldown@* @rolldown+* lightningcss* \
    prisma@* @prisma+studio-core@* @prisma+engines@* \
  && other=$([ "$(uname -m)" = x86_64 ] && echo arm64 || echo x64) \
  && find . -maxdepth 1 \( -name '*linuxmusl*' -o -name '*-musl*' -o -name "*linux-$other*" \
    -o -name '*[-+]darwin-*' -o -name '*[-+]win32-*' -o -name '*[-+]android-*' -o -name '*[-+]freebsd-*' \) \
    -exec rm -rf {} +

FROM base AS build
# The desktop and mobile apps, the web app and the marketing site are left out: they would add
# gigabytes. The web app has its own image (Dockerfile.web).
RUN pnpm install --frozen-lockfile --store-dir /tmp/pnpm-store \
    --filter "@corvo/api..." --filter "@corvo/worker..." \
  && rm -rf /tmp/pnpm-store
# Only what the two builds read, so an edit to the web app or the docs does not rebuild them.
COPY tsconfig.base.json ./
COPY scripts/build-server.mjs scripts/
COPY packages/adapter-kit packages/adapter-kit
COPY packages/adapters packages/adapters
COPY packages/auth packages/auth
COPY packages/contracts packages/contracts
COPY packages/core packages/core
COPY packages/db packages/db
COPY packages/logging packages/logging
COPY packages/memory packages/memory
COPY packages/ui-tokens packages/ui-tokens
COPY infra/guara/relax-runtime-role.sh infra/guara/
# Opt in (build variable RELAX_RUNTIME_ROLE=1) when the database owner cannot create roles.
ARG RELAX_RUNTIME_ROLE
RUN if [ -n "$RELAX_RUNTIME_ROLE" ]; then bash infra/guara/relax-runtime-role.sh; fi
# The cap keeps the builds inside a small host's memory.
ENV NODE_OPTIONS=--max-old-space-size=1536
RUN pnpm --filter @corvo/db generate
COPY apps/api apps/api
COPY apps/worker apps/worker
RUN pnpm --filter @corvo/api --filter @corvo/worker build
# The API reports the web build deployed beside it (apps/api/src/client-build.ts reads this file).
# The id is the UTC build time, the format the web build writes, so it needs no web build here.
RUN mkdir -p apps/web/dist && date -u +%Y%m%d%H%M%S > apps/web/dist/build-id

FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=prod-deps /app/ ./
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/worker/dist apps/worker/dist
COPY --from=build /app/apps/web/dist/build-id apps/web/dist/build-id
COPY --from=build /app/packages/db/prisma/migrations packages/db/prisma/migrations
COPY infra/guara/start.sh infra/guara/start.sh
# The migration step applies these files itself instead of starting pnpm and the Prisma CLI.
ENV NODE_ENV=production MIGRATIONS_DIR=/app/packages/db/prisma/migrations
RUN install -d -o node -g node /data
EXPOSE 3100
USER node
CMD ["bash", "/app/infra/guara/start.sh"]
