import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { APIRoute } from "astro";

// Read from the desktop app's install folder at build time (the build runs from the site folder), so there is one source.
const script = readFileSync(resolve(process.cwd(), "../desktop/install/install.ps1"), "utf8");

export const GET: APIRoute = () =>
  new Response(script, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
