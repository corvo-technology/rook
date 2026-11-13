# One image for every Rook process on Guará Cloud, chosen at start by CORVO_ROLE
# (api, worker or web). It avoids BuildKit-only syntax (cache mounts, COPY --chmod)
# so any Docker builder can build it.
FROM node:22-bookworm@sha256:0557ac14e0d45d02ed563067b82856ca5e7aa3437fa28d98d4350ea9c3d9494a
ENV COREPACK_HOME=/usr/local/share/corepack
RUN corepack enable
WORKDIR /app
# Manifests first so a source edit does not re-run the install. Every package in
# pnpm-workspace.yaml needs its manifest here or --frozen-lockfile fails.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN corepack install && chmod -R a+rX "${COREPACK_HOME}"
COPY patches patches
COPY apps/api/package.json apps/api/
COPY apps/desktop/package.json apps/desktop/
COPY apps/mobile/package.json apps/mobile/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY apps/www/package.json apps/www/
COPY packages/adapter-kit/package.json packages/adapter-kit/
COPY packages/adapters/package.json packages/adapters/
COPY packages/auth/package.json packages/auth/
COPY packages/chat-ui/package.json packages/chat-ui/
COPY packages/contracts/package.json packages/contracts/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/logging/package.json packages/logging/
COPY packages/memory/package.json packages/memory/
COPY packages/testkit/package.json packages/testkit/
COPY packages/ui-tokens/package.json packages/ui-tokens/
COPY packages/ui-web/package.json packages/ui-web/
COPY infra/sandboxes/supervisor/package.json infra/sandboxes/supervisor/
COPY infra/updater/package.json infra/updater/
RUN pnpm install --frozen-lockfile
COPY . .
RUN chmod -R a+rX /app
RUN pnpm --filter @corvo/db generate
RUN pnpm --filter @corvo/api --filter @corvo/worker build
RUN CORVO_ALLOW_DEV_SECRETS=1 pnpm --filter @corvo/web build
RUN install -d -m 750 -o node -g node /data /app/apps/web/node_modules/.vite-temp /app/apps/web/asset-archive
ENV NODE_ENV=production
EXPOSE 3100 5173
USER node
CMD ["bash", "/app/infra/guara/start.sh"]
