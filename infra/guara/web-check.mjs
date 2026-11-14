// Starts the staged web server the way the image does and fails the build when it cannot serve
// the app, so a missing file in the runtime shows up at build time, not at deploy time.
//
//   node infra/guara/web-check.mjs <runtime-dir>
//
// The server runs with throwaway settings on a local port and is stopped again.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const runtime = path.resolve(process.argv[2] ?? "");
if (!process.argv[2]) {
  console.error("usage: node infra/guara/web-check.mjs <runtime-dir>");
  process.exit(2);
}
const port = 5199;
const server = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "preview",
    "--configLoader",
    "runner",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort",
  ],
  {
    cwd: path.join(runtime, "apps/web"),
    env: {
      PATH: process.env.PATH,
      NODE_ENV: "production",
      SCREEN_PROXY_SECRET: randomBytes(24).toString("hex"),
      API_PROXY_TARGET: "http://127.0.0.1:9",
      WEB_PORT: String(port),
    },
    stdio: ["ignore", "inherit", "inherit"],
  },
);
let exited = false;
server.once("exit", () => {
  exited = true;
});

const fetchText = async (file) => {
  const response = await fetch(`http://127.0.0.1:${port}${file}`);
  return { status: response.status, body: await response.text(), headers: response.headers };
};

let failure = "the server did not answer within 30 seconds";
for (let attempt = 0; attempt < 60 && !exited; attempt += 1) {
  await sleep(500);
  try {
    const home = await fetchText("/");
    const build = await fetchText("/build-id");
    if (home.status !== 200 || !home.body.includes('<div id="root">')) {
      failure = `GET / answered ${home.status} without the app shell`;
    } else if (!home.headers.get("content-security-policy")) {
      failure = "GET / carried no Content-Security-Policy header";
    } else if (build.status !== 200 || !/^\d{14}\n?$/.test(build.body)) {
      failure = `GET /build-id answered ${build.status} ${JSON.stringify(build.body.slice(0, 40))}`;
    } else {
      failure = "";
      break;
    }
  } catch {
    // Not listening yet.
  }
}
if (!exited) server.kill("SIGTERM");
if (failure) {
  console.error(`web runtime check failed: ${exited ? "the server exited early" : failure}`);
  process.exit(1);
}
console.log("web runtime check passed");
