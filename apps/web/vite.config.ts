import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { DesktopStackProbeResponse } from "@corvo/contracts";
import { buildIdAt } from "@corvo/contracts/client-build";
import {
  appContentSecurityPolicy,
  CSP_REPORTING_ENDPOINTS,
  contentSecurityPolicyFor,
  parseContentSecuritySources,
  parseCrispWebsiteId,
} from "@corvo/contracts/content-security-policy";
import { createNovncProxy } from "@corvo/core/node/novnc-proxy";
import type { PluginOption, PreviewServer, ProxyOptions, ViteDevServer } from "vite";
import { defineConfig, loadEnv } from "vite";
import { resolveScreenProxySecret } from "../../packages/core/src/secrets-guard.ts";
import { createServiceLogger } from "../../packages/logging/src/env.ts";
import { ASSET_ARCHIVE_DIR, archiveAssets } from "./src/asset-archive.js";
import { appendForwardedFor } from "./src/forwarded-for.js";
import { missingAssetMiddleware } from "./src/missing-asset.js";

const webPort = Number(process.env.WEB_PORT ?? 5173);
const DESKTOP_STACK_PROBE_PATH = "/.well-known/corvo-desktop-stack";
const DESKTOP_STACK_TOKEN_HEADER = "x-corvo-desktop-stack-token";
const screenLog = createServiceLogger({ service: "corvo-web" });

function equalStackToken(expected: string, supplied: string | string[] | undefined) {
  if (expected === "" || typeof supplied !== "string") return false;
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return (
    expectedBytes.byteLength === suppliedBytes.byteLength &&
    timingSafeEqual(expectedBytes, suppliedBytes)
  );
}

function attachDesktopStackProbe(
  server: ViteDevServer | PreviewServer,
  token: string,
  imageTag: string,
) {
  server.middlewares.use((req, res, next) => {
    if (req.url?.split("?", 1)[0] !== DESKTOP_STACK_PROBE_PATH) {
      next();
      return;
    }
    if (!equalStackToken(token, req.headers[DESKTOP_STACK_TOKEN_HEADER])) {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }
    const body: DesktopStackProbeResponse = { ok: true, imageTag };
    res.statusCode = 200;
    res.setHeader("cache-control", "no-store");
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify(body));
  });
}

function attachNovncProxy(server: ViteDevServer | PreviewServer, secret: string, api: string) {
  const proxy = createNovncProxy({ secret, api, log: screenLog });
  server.middlewares.use((req, res, next) => {
    void proxy.request(req, res).then((handled) => {
      if (!handled) next();
    });
  });
  server.httpServer?.on("upgrade", (req, socket, head) => void proxy.upgrade(req, socket, head));
}

/**
 * The compile-time plugins. `vite preview` only serves a finished build, so it skips them and the
 * production image (infra/guara/Dockerfile.web) carries Vite alone, without React, Babel, Lingui
 * or Tailwind. They load on demand for `vite build` and the dev server.
 */
async function buildPlugins(buildId: string): Promise<PluginOption[]> {
  const [{ lingui }, { default: babel }, { default: tailwindcss }, { default: react }, pwa] =
    await Promise.all([
      import("@lingui/vite-plugin"),
      import("@rolldown/plugin-babel"),
      import("@tailwindcss/vite"),
      import("@vitejs/plugin-react"),
      import("./src/pwa/plugin.js"),
    ]);
  return [
    react(),
    babel({ plugins: ["@lingui/babel-plugin-lingui-macro"] }),
    lingui(),
    tailwindcss(),
    pwa.corvoPwa(buildId),
  ];
}

export default defineConfig(async ({ command, mode, isPreview }) => {
  // Names this build in every API request; the dev server has none, so the handshake stays off.
  const buildId = command === "build" ? buildIdAt(new Date()) : "";
  const rootEnv = loadEnv(mode, path.resolve(import.meta.dirname, "../.."), "");
  const api = process.env.API_PROXY_TARGET ?? rootEnv.API_PROXY_TARGET ?? "http://127.0.0.1:3100";
  const apiProxy = Object.fromEntries(
    [
      "/api",
      "/rpc",
      // Native app domain association, served by the API from deployment settings.
      "/.well-known/apple-app-site-association",
      "/.well-known/assetlinks.json",
    ].map((path) => [
      path,
      {
        target: api,
        changeOrigin: true,
        // Append the hop this proxy saw, so the API never mistakes a caller's own header for its
        // address. The API reads past this hop only when it is listed in TRUSTED_PROXIES.
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq, req) => {
            proxyReq.setHeader("x-forwarded-for", appendForwardedFor(req));
          });
        },
      } satisfies ProxyOptions,
    ]),
  );
  const previewHost = process.env.CORVO_HOST ?? rootEnv.CORVO_HOST ?? "localhost";
  const allowedHosts = [
    previewHost,
    ...(process.env.CORVO_ALLOWED_HOSTS ?? rootEnv.CORVO_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  ];
  const screenProxySecret = () =>
    resolveScreenProxySecret({
      ...process.env,
      SCREEN_PROXY_SECRET: process.env.SCREEN_PROXY_SECRET ?? rootEnv.SCREEN_PROXY_SECRET,
      SANDBOX_SUPERVISOR_TOKEN:
        process.env.SANDBOX_SUPERVISOR_TOKEN ?? rootEnv.SANDBOX_SUPERVISOR_TOKEN,
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? rootEnv.BETTER_AUTH_SECRET,
    });
  const performanceAssetDelayMs = Number(process.env.CORVO_PERFORMANCE_ASSET_DELAY_MS ?? 0);
  const desktopStackToken =
    process.env.CORVO_DESKTOP_STACK_TOKEN ?? rootEnv.CORVO_DESKTOP_STACK_TOKEN ?? "";
  const imageTag = process.env.CORVO_IMAGE_TAG ?? rootEnv.CORVO_IMAGE_TAG ?? "edge";
  // Invalid origins throw here, so the server refuses to start rather than serve a wider policy.
  const appPolicy = appContentSecurityPolicy({
    scriptSrc: parseContentSecuritySources(
      "CORVO_CSP_SCRIPT_SRC",
      process.env.CORVO_CSP_SCRIPT_SRC ?? rootEnv.CORVO_CSP_SCRIPT_SRC,
    ),
    connectSrc: parseContentSecuritySources(
      "CORVO_CSP_CONNECT_SRC",
      process.env.CORVO_CSP_CONNECT_SRC ?? rootEnv.CORVO_CSP_CONNECT_SRC,
    ),
    crisp: parseCrispWebsiteId(process.env.CRISP_WEBSITE_ID ?? rootEnv.CRISP_WEBSITE_ID) !== null,
  });
  return {
    build: { sourcemap: true },
    define: { "import.meta.env.CORVO_BUILD": JSON.stringify(buildId) },
    plugins: [
      {
        // The API reads this to name the deployed build, and a tab fetches it to confirm the
        // server already serves a newer build before it reloads.
        name: "corvo-build-id",
        apply: "build",
        generateBundle() {
          this.emitFile({ type: "asset", fileName: "build-id", source: `${buildId}\n` });
        },
      },
      ...(isPreview ? [] : await buildPlugins(buildId)),
      {
        // Production only: the dev server injects inline scripts for React Refresh.
        name: "corvo-content-security-policy",
        configurePreviewServer(server) {
          server.middlewares.use((req, res, next) => {
            const policy = contentSecurityPolicyFor(req.url?.split("?", 1)[0] ?? "/", appPolicy);
            if (policy) {
              res.setHeader("content-security-policy", policy);
              res.setHeader("reporting-endpoints", CSP_REPORTING_ENDPOINTS);
            }
            next();
          });
        },
      },
      {
        name: "corvo-missing-asset-404",
        configurePreviewServer({ config, middlewares }) {
          const outDir = path.resolve(config.root, config.build.outDir);
          const assetsDir = path.join(outDir, config.build.assetsDir);
          let archive: string | null = null;
          try {
            archive = archiveAssets({
              assetsDir,
              archiveDir: path.resolve(config.root, ASSET_ARCHIVE_DIR),
              buildId: readFileSync(path.join(outDir, "build-id"), "utf8").trim(),
              now: Date.now(),
            });
          } catch (error) {
            screenLog.warn("web.asset_archive_failed", { "error.code": socketErrorCode(error) });
          }
          middlewares.use(
            missingAssetMiddleware(assetsDir, `${config.base}${config.build.assetsDir}/`, archive),
          );
        },
      },
      {
        name: "corvo-desktop-stack-probe",
        configureServer: (server) => attachDesktopStackProbe(server, desktopStackToken, imageTag),
        configurePreviewServer: (server) =>
          attachDesktopStackProbe(server, desktopStackToken, imageTag),
      },
      {
        name: "corvo-performance-asset-delay",
        configurePreviewServer(server) {
          if (!Number.isFinite(performanceAssetDelayMs) || performanceAssetDelayMs <= 0) return;
          server.middlewares.use((req, _res, next) => {
            const pathname = req.url?.split("?", 1)[0] ?? "/";
            if (["/api", "/rpc", "/novnc"].some((prefix) => pathname.startsWith(prefix))) {
              next();
              return;
            }
            setTimeout(next, performanceAssetDelayMs);
          });
        },
      },
      {
        name: "corvo-novnc-proxy",
        configureServer: (server) => attachNovncProxy(server, screenProxySecret(), api),
        configurePreviewServer: (server) => attachNovncProxy(server, screenProxySecret(), api),
      },
    ],
    server: {
      host: process.env.CORVO_DEV_HOST ?? rootEnv.CORVO_DEV_HOST ?? "127.0.0.1",
      port: webPort,
      strictPort: true,
      allowedHosts,
      proxy: apiProxy,
    },
    preview: {
      host: "0.0.0.0",
      port: Number(process.env.WEB_PORT ?? 5173),
      allowedHosts,
      proxy: apiProxy,
    },
  };
});
