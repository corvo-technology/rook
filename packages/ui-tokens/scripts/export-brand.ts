import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { darkTokens } from "../src/index.ts";

const root = new URL("../../../", import.meta.url);
const path = (name: string) => fileURLToPath(new URL(name, root));
const source = await readFile(path("packages/ui-tokens/assets/Corvo.icon/Assets/ana.svg"), "utf8");

// The logo is the mint rook on a 100-unit square view box.
const VIEW = 100;
async function ana(size: number, svg = source) {
  const sized = svg.replace("<svg ", `<svg width="${size}" height="${size}" `);
  return sharp(Buffer.from(sized)).png().toBuffer();
}

/** The rook centered on a plate of the given color, or on nothing. `share` is how much of the canvas its view box takes. */
async function framed(background: string, share = 0.68, canvas = 1024) {
  const size = Math.round(canvas * share);
  const offset = Math.round((canvas - size) / 2);
  return sharp({ create: { width: canvas, height: canvas, channels: 4, background } })
    .composite([{ input: await ana(size), top: offset, left: offset }])
    .png()
    .toBuffer();
}
const mask = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" rx="200" fill="white"/></svg>',
);
async function roundedCorners(input: Buffer) {
  return sharp(input)
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();
}
const square = await framed(darkTokens.background);
const rounded = await roundedCorners(square);

async function png(input: Buffer, name: string, size: number) {
  await sharp(input).resize(size, size).png().toFile(path(name));
}

// PNG frames in ICO are supported by modern Windows and browser favicon loaders.
async function ico(input: Buffer, name: string, sizes: number[]) {
  const frames = await Promise.all(sizes.map((size) => sharp(input).resize(size).png().toBuffer()));
  const header = Buffer.alloc(6 + frames.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  let offset = header.length;
  frames.forEach((frame, index) => {
    const entry = 6 + index * 16;
    header[entry] = header[entry + 1] = sizes[index] === 256 ? 0 : sizes[index];
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(frame.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += frame.length;
  });
  await writeFile(path(name), Buffer.concat([header, ...frames]));
}

// The marketing site keeps its own set under public/brand, drawn from the same logo.
for (const app of ["web"]) {
  const publicDir = `apps/${app}/public`;
  await png(rounded, `${publicDir}/favicon-16x16.png`, 16);
  await png(rounded, `${publicDir}/favicon-32x32.png`, 32);
  await png(rounded, `${publicDir}/favicon.png`, 128);
  await png(square, `${publicDir}/apple-touch-icon.png`, 180);
  await png(square, `${publicDir}/icon-192.png`, 192);
  await png(square, `${publicDir}/icon-512.png`, 512);
  await ico(rounded, `${publicDir}/favicon.ico`, [16, 32, 48]);
}
await png(rounded, "apps/mobile/assets/favicon.png", 128);
await png(square, "apps/desktop/assets/icon.png", 1024);
await ico(rounded, "apps/desktop/assets/icon.ico", [16, 32, 48, 64, 128, 256]);

// The macOS icon: a rounded plate inside Dock margins, with the system's soft shadow.
const plate = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><defs><filter id="s" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#000" flood-opacity="0.45"/></filter></defs><rect x="100" y="100" width="824" height="824" rx="185" fill="${darkTokens.background}" filter="url(#s)"/></svg>`,
);
await sharp(plate)
  .composite([
    {
      input: await ana(Math.round(1024 * 0.56)),
      top: Math.round((1024 - 1024 * 0.56) / 2),
      left: Math.round((1024 - 1024 * 0.56) / 2),
    },
  ])
  .png()
  .toFile(path("apps/desktop/assets/icon-macos.png"));

// The character alone, for Android: an opaque icon, a transparent foreground inside the launcher's
// safe circle, a flat silhouette with the eyes cut out, and the plain background plate.
await png(square, "apps/mobile/assets/icon.png", 1024);
await sharp(await framed("transparent", 0.5)).toFile(path("apps/mobile/assets/adaptive-icon.png"));
const silhouetteSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW} ${VIEW}"><defs><mask id="m"><rect width="${VIEW}" height="${VIEW}" fill="white"/><ellipse cx="38" cy="56" rx="5" ry="7.5" fill="black"/><ellipse cx="62" cy="56" rx="5" ry="7.5" fill="black"/></mask></defs><g mask="url(#m)" fill="#000"><rect x="18" y="12" width="16" height="26" rx="5"/><rect x="42" y="12" width="16" height="26" rx="5"/><rect x="66" y="12" width="16" height="26" rx="5"/><rect x="18" y="28" width="64" height="60" rx="18"/></g></svg>`;
const mono = await ana(Math.round(1024 * 0.5), silhouetteSvg);
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: "transparent" } })
  .composite([{ input: mono, top: 256, left: 256 }])
  .png()
  .toFile(path("apps/mobile/assets/monochrome-icon.png"));
await sharp({
  create: { width: 1024, height: 1024, channels: 3, background: darkTokens.background },
})
  .png()
  .toFile(path("apps/mobile/assets/icon-background.png"));

// The splash shows the rook alone, with no plate, so it sits on either splash colour.
// Keep the existing transparent padding so its visual size stays stable.
await sharp(await framed("transparent", 1))
  .resize(620, 620)
  .extend({ top: 202, bottom: 202, left: 202, right: 202, background: "transparent" })
  .png()
  .toFile(path("apps/mobile/assets/splash-icon.png"));

// Android notification icons must be white alpha silhouettes, with transparent eyes.
const silhouette = await sharp(path("apps/mobile/assets/monochrome-icon.png"))
  .resize(72, 72)
  .extractChannel("alpha")
  .toBuffer();
await sharp({ create: { width: 72, height: 72, channels: 3, background: "white" } })
  .joinChannel(silhouette)
  .png()
  .toFile(path("apps/mobile/assets/notification-icon.png"));
