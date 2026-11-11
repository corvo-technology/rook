import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// tsc only emits the TypeScript sources; the preload bridges and the setup
// window's static assets have to be copied into dist alongside them.
const STATIC_FILES = [
  "preload.cjs",
  "setup-preload.cjs",
  "setup.html",
  "setup.css",
  "setup.js",
  "setup-strings.js",
  "mascot.svg",
];
const FONT_FILES = ["inter-latin.woff2", "inter-tight-latin.woff2"];
const FONTS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../web/public/fonts",
);
const TOKENS_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../packages/ui-tokens/src/tokens.css",
);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

await mkdir(dist, { recursive: true });
await Promise.all([
  ...STATIC_FILES.map((file) => copyFile(path.join(root, "src", file), path.join(dist, file))),
  ...FONT_FILES.map((file) => copyFile(path.join(FONTS_DIR, file), path.join(dist, file))),
  copyFile(TOKENS_FILE, path.join(dist, "tokens.css")),
]);
