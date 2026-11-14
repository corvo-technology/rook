# The marketing site: a static Astro build served by nginx.
# Build from the repository root: docker build -f apps/www/Dockerfile .
#
# Build arguments (all optional, public values baked into the pages): PUBLIC_POSTHOG_KEY,
# PUBLIC_POSTHOG_HOST, PUBLIC_CRISP_WEBSITE_ID. Like infra/guara/Dockerfile it avoids
# BuildKit-only syntax, so any Docker builder can build it.
FROM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN corepack install
# Manifests of the site and the workspace packages it depends on, and nothing else, so only a
# change to those re-runs the install. When the site gains a workspace dependency, add its
# manifest here; the install then fails by name.
COPY patches patches
COPY apps/www/package.json apps/www/
COPY packages/contracts/package.json packages/contracts/
COPY packages/core/package.json packages/core/
COPY packages/ui-tokens/package.json packages/ui-tokens/
COPY packages/ui-web/package.json packages/ui-web/
RUN pnpm install --frozen-lockfile --ignore-scripts --store-dir /tmp/pnpm-store \
    --filter "@corvo/www..." \
  && rm -rf /tmp/pnpm-store

COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY packages/core packages/core
COPY packages/ui-tokens packages/ui-tokens
COPY packages/ui-web packages/ui-web
COPY apps/www apps/www
ARG PUBLIC_POSTHOG_KEY
ARG PUBLIC_POSTHOG_HOST
ARG PUBLIC_CRISP_WEBSITE_ID
# The cap keeps the build inside a small host's memory.
RUN NODE_OPTIONS=--max-old-space-size=1536 pnpm --filter @corvo/www build

FROM nginx:1.27-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10
COPY apps/www/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/www/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
