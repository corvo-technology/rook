// Stages what `vite preview` needs to serve the built web app, and nothing else.
//
//   node infra/guara/web-runtime.mjs <out-dir>     (from the repository root, after the build)
//
// The server is Vite's preview server plus the plugins in apps/web/vite.config.ts (security
// headers, the /api and /rpc proxy, the noVNC proxy, the asset archive). Everything the app is
// built from (React, Sentry, Better Auth, ...) is already inside apps/web/dist, so the runtime
// is Vite, its dependencies, the build output and the workspace sources the config imports.
//
// pnpm keeps each package in node_modules/.pnpm/<name>@<version>/node_modules/<name> with its
// dependencies as sibling symlinks, so Vite's dependency closure is found by following those
// links, and each directory is copied with its links intact.
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "");
if (!process.argv[2]) {
  console.error("usage: node infra/guara/web-runtime.mjs <out-dir>");
  process.exit(2);
}
const root = process.cwd();
const store = path.join(root, "node_modules/.pnpm");
const web = path.join(root, "apps/web");
// Workspace packages the server config imports as source (see the imports in vite.config.ts).
const workspaceSources = ["contracts", "core", "logging"];
// Optional peers of Vite that the production server never loads; the `vite@...` directory name
// lists them, so pnpm links them next to Vite.
const skipped =
  /^(?:esbuild|jiti|terser|tsx|yaml|sass|sass-embedded|less|stylus|sugarss|lightningcss|@types)(?:[@+/]|$)/;

function storeEntry(file) {
  const relative = path.relative(store, realpathSync(file));
  if (relative.startsWith("..")) throw new Error(`${file} is outside ${store}`);
  return relative.split(path.sep)[0];
}

const vite = storeEntry(path.join(web, "node_modules/vite"));
const wanted = new Set();
const pending = [vite];
while (pending.length > 0) {
  const entry = /** @type {string} */ (pending.pop());
  if (wanted.has(entry)) continue;
  wanted.add(entry);
  const modules = path.join(store, entry, "node_modules");
  for (const name of readdirSync(modules)) {
    const names = name.startsWith("@")
      ? readdirSync(path.join(modules, name)).map((scoped) => `${name}/${scoped}`)
      : [name];
    for (const linked of names) {
      const file = path.join(modules, linked);
      if (!lstatSync(file).isSymbolicLink() || skipped.test(linked)) continue;
      pending.push(storeEntry(file));
    }
  }
}

rmSync(out, { recursive: true, force: true });
mkdirSync(path.join(out, "node_modules/.pnpm"), { recursive: true });
for (const entry of wanted) {
  cpSync(path.join(store, entry), path.join(out, "node_modules/.pnpm", entry), {
    recursive: true,
    verbatimSymlinks: true,
  });
}

const link = (target, file) => {
  mkdirSync(path.dirname(file), { recursive: true });
  symlinkSync(target, file);
};
link(
  path.join("../../../node_modules/.pnpm", vite, "node_modules/vite"),
  path.join(out, "apps/web/node_modules/vite"),
);

// The app: the config, the sources it imports and the build output. Vite reads the TypeScript
// settings the config extends, so the shared base file comes along.
cpSync(path.join(root, "tsconfig.base.json"), path.join(out, "tsconfig.base.json"));
for (const name of ["package.json", "vite.config.ts", "tsconfig.json", "src", "dist"]) {
  if (existsSync(path.join(web, name))) {
    cpSync(path.join(web, name), path.join(out, "apps/web", name), { recursive: true });
  }
}
for (const name of workspaceSources) {
  for (const part of ["package.json", "src"]) {
    cpSync(path.join(root, "packages", name, part), path.join(out, "packages", name, part), {
      recursive: true,
    });
  }
  // The config bundler resolves `@corvo/<name>` from the importing package's node_modules; the
  // workspace packages import each other and themselves by name.
  link(`../../../../packages/${name}`, path.join(out, "apps/web/node_modules/@corvo", name));
  for (const other of workspaceSources) {
    link(`../../../${other}`, path.join(out, "packages", name, "node_modules/@corvo", other));
  }
}
console.log(`staged ${wanted.size} packages in ${out}`);
