/**
 * Renders the profile pictures and banners for X, LinkedIn and Instagram from the dev-only
 * /og-preview/social route into public/brand/social/. Run the dev server first
 * (`pnpm --filter @corvo/www dev`), then:
 *   node apps/www/scripts/generate-social.mjs [baseUrl]
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
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

// Every image is drawn at 3x and averaged down in a canvas, so curves and corners come out smooth
// at each target size.
const SUPER = 3;
async function downscale(page, buffer, width, height) {
  const base64 = await page.evaluate(
    async ({ data, width, height }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      let source = image;
      let w = image.width;
      let h = image.height;
      // Halve in steps so the average stays even.
      while (w / 2 >= width * 1.5) {
        const step = document.createElement("canvas");
        step.width = Math.round(w / 2);
        step.height = Math.round(h / 2);
        const c = step.getContext("2d");
        c.imageSmoothingQuality = "high";
        c.drawImage(source, 0, 0, step.width, step.height);
        source = step;
        w = step.width;
        h = step.height;
      }
      const out = document.createElement("canvas");
      out.width = width;
      out.height = height;
      const c = out.getContext("2d");
      c.imageSmoothingQuality = "high";
      c.drawImage(source, 0, 0, width, height);
      return out.toDataURL("image/png").split(",")[1];
    },
    { data: buffer.toString("base64"), width, height },
  );
  return Buffer.from(base64, "base64");
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1080 }, deviceScaleFactor: SUPER });
  for (const job of JOBS) {
    await page.goto(`${baseUrl}/og-preview/social/${job.kind}/`, { waitUntil: "networkidle" });
    await page.addStyleTag({ content: "astro-dev-toolbar { display: none !important; }" });
    await page.evaluate(() => document.fonts.ready);
    const big = await page.locator("#art").screenshot();
    const sizes = job.small ? [[job.width, "-1080"], [job.small, `-${job.small}`]] : [[job.width, ""]];
    for (const [width, suffix] of sizes) {
      const height = Math.round((job.height * width) / job.width);
      writeFileSync(`${outDir}${job.name}${suffix}.png`, await downscale(page, big, width, height));
      console.log(`wrote public/brand/social/${job.name}${suffix}.png`);
    }
  }
} finally {
  await browser.close();
}
