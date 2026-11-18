# The documentation site (docs.rook.team): a static Astro Starlight build served by nginx.
# Build from the repository root: docker build -f apps/docs/Dockerfile .
# Like apps/www it avoids BuildKit-only syntax, so any Docker builder can build it.
FROM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN corepack install
# Manifests of the site and the workspace package it depends on, and nothing else, so only a
# change to those re-runs the install. When the site gains a workspace dependency, add its
# manifest here; the install then fails by name.
COPY patches patches
COPY apps/docs/package.json apps/docs/
COPY packages/ui-tokens/package.json packages/ui-tokens/
RUN pnpm install --frozen-lockfile --ignore-scripts --store-dir /tmp/pnpm-store \
    --filter "@corvo/docs..." \
  && rm -rf /tmp/pnpm-store

COPY packages/ui-tokens packages/ui-tokens
COPY apps/docs apps/docs
# The cap keeps the build inside a small host's memory.
RUN NODE_OPTIONS=--max-old-space-size=1536 pnpm --filter @corvo/docs build

FROM nginx:1.27-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10
COPY apps/docs/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/docs/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
