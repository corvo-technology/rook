// Bundles the local engine the desktop app runs on this computer: the API, the worker and the
// database migrations, so an installed app needs neither Docker nor a checkout. The output goes
// into dist/, which is packed into the app. Packages with native code or data files stay external
// and resolve from the app's own dependencies (`koffi`, `jsdom` and `sherpa-onnx-node` are declared in
// its package.json).
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..", "..");
const out = path.resolve(here, "..", "dist", "engine");

/**
 * koffi and sherpa-onnx-node (the speech engine) load native modules and jsdom reads data files next to
 * itself; none survives bundling. sherpa-onnx-espeak is the 1.x speech engine, which still has the
 * espeak-ng phonemizer (GPL-3.0) for Piper voices; it only ever runs in a process of its own.
 */
const EXTERNAL_PACKAGES = [
  "koffi",
  "jsdom",
  "sherpa-onnx-node",
  "sherpa-onnx-espeak",
  "@whiskeysockets/baileys",
];

// `punycode/` (with the slash) is the npm package, not the deprecated builtin.
const builtins = builtinModules.filter((name) => name !== "punycode");
const entryPoints = {
  api: path.join(root, "apps/api/src/index.ts"),
  worker: path.join(root, "apps/worker/src/index.ts"),
  migrate: path.join(root, "apps/api/src/cli/migrate-database.ts"),
  "desktop-control-mcp": path.join(root, "packages/adapters/src/desktop-control-mcp-main.ts"),
  supervisor: path.join(root, "infra/sandboxes/supervisor/src/index.ts"),
};

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// One build with code splitting, so what the three programs share is bundled once.
await build({
  entryPoints,
  outdir: out,
  outExtension: { ".js": ".mjs" },
  chunkNames: "chunks/[name]-[hash]",
  splitting: true,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  conditions: ["node", "module"],
  // Prefer a package's ES module build: a dynamic import of its CommonJS build loses the named exports.
  mainFields: ["module", "main"],
  logLevel: "warning",
  banner: {
    // Bundled CommonJS packages (ssh2, through dockerode) still read __dirname and __filename.
    js: 'import { createRequire as __createRequire } from "node:module"; import { fileURLToPath as __fileURLToPath } from "node:url"; import { dirname as __dirnameOf } from "node:path"; const require = __createRequire(import.meta.url); const __filename = __fileURLToPath(import.meta.url); const __dirname = __dirnameOf(__filename);',
  },
  // pi-ai loads its sign-in flows with variable imports that esbuild cannot follow.
  inject: [path.join(root, "packages/adapters/src/pi-bundled-oauth.ts")],
  // ssh2, which dockerode loads for ssh connections, tries optional native add-ons and falls back to
  // plain JavaScript without them. The supervisor reaches Docker over a socket and needs neither.
  external: [
    ...EXTERNAL_PACKAGES,
    "*.node",
    "cpu-features",
    ...builtins,
    ...builtins.map((name) => `node:${name}`),
  ],
});

cpSync(path.join(root, "packages/db/prisma/migrations"), path.join(out, "migrations"), {
  recursive: true,
});
