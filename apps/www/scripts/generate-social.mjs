/**
 * Renders the profile pictures and banners for X, LinkedIn and Instagram from the dev-only
 * /og-preview/social route into public/brand/social/. Run the dev server first
 * (`pnpm --filter @corvo/www dev`), then:
 *   node apps/www/scripts/generate-social.mjs [baseUrl]
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveWwwPort } from "../www-port.mjs";

const baseUrl = process.argv[2] ?? `http://127.0.0.1:${resolveWwwPort()}`;
const outDir = fileURLToPath(new URL("../public/brand/social/", import.meta.url));
mkdirSync(outDir, { recursive: true });

// kind -> [output name, rendered size, extra square size]
const JOBS = [
  { kind: "avatar-mint", name: "profile-mint", width: 1080, height: 1080, small: 400 },
  { kind: "avatar-paper", name: "profile-paper", width: 1080, height: 1080, small: 400 },
  { kind: "banner-x", name: "banner-x", width: 1500, height: 500 },
  { kind: "banner-linkedin", name: "banner-linkedin", width: 1128, height: 191 },
];

const browser = await chromium.launch();
try {
  for (const job of JOBS) {
    const page = await browser.newPage({ viewport: { width: job.width, height: job.height }, deviceScaleFactor: 1 });
    await page.goto(`${baseUrl}/og-preview/social/${job.kind}/`, { waitUntil: "networkidle" });
    await page.addStyleTag({ content: "astro-dev-toolbar { display: none !important; }" });
    await page.evaluate(() => document.fonts.ready);
    const suffix = job.small ? "-1080" : "";
    await page.locator("#art").screenshot({ path: `${outDir}${job.name}${suffix}.png` });
    console.log(`wrote public/brand/social/${job.name}${suffix}.png`);
    if (job.small) {
      await page.setViewportSize({ width: job.small, height: job.small });
      await page.addStyleTag({ content: `#art { zoom: ${job.small / job.width}; }` });
      await page.locator("#art").screenshot({ path: `${outDir}${job.name}-${job.small}.png` });
      console.log(`wrote public/brand/social/${job.name}-${job.small}.png`);
    }
    await page.close();
  }
} finally {
  await browser.close();
}
