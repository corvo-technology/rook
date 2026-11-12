import { parseBotAvatarValue } from "@corvo/contracts";
import type { BotColorDef } from "./bot-avatar-colors.js";
import { BOT_COLOR_LIST, resolvePersonaColorDef } from "./bot-avatar-colors.js";

/** The Rook mascot's colors, in the order the avatar picker shows them. `hex` is what a bot saves. */
export const MASCOT_COLORS = [
  { id: "mint", hex: "#10B981" },
  { id: "blue", hex: "#3B82F6" },
  { id: "violet", hex: "#8B5CF6" },
  { id: "pink", hex: "#EC4899" },
  { id: "red", hex: "#EF4444" },
  { id: "orange", hex: "#F97316" },
  { id: "yellow", hex: "#EAB308" },
  { id: "lime", hex: "#84CC16" },
  { id: "cyan", hex: "#06B6D4" },
  { id: "neutral", hex: "#FFFFFF" },
] as const;

export type MascotId = (typeof MASCOT_COLORS)[number]["id"];

/** Where each palette color's mascot comes from; brown has no mascot of its own. */
const MASCOT_BY_PALETTE_ID: Record<string, MascotId> = {
  white: "neutral",
  gray: "neutral",
  violet: "violet",
  green: "mint",
  orange: "orange",
  cyan: "cyan",
  blue: "blue",
  yellow: "yellow",
  brown: "orange",
  red: "red",
  magenta: "pink",
};

/** Hue angle (degrees, HSL) each colored mascot stands for. */
const MASCOT_HUES: ReadonlyArray<readonly [MascotId, number]> = [
  ["red", 0],
  ["orange", 28],
  ["yellow", 48],
  ["lime", 84],
  ["mint", 155],
  ["cyan", 190],
  ["blue", 217],
  ["violet", 262],
  ["pink", 330],
];

const NEUTRAL_SATURATION = 0.14;

function hueAndSaturation(hex: string): { hue: number; saturation: number } {
  const clean = hex.replace("#", "");
  const full =
    clean.length === 3
      ? [...clean].map((channel) => channel + channel).join("")
      : clean.padEnd(6, "0");
  const [r = 0, g = 0, b = 0] = [0, 2, 4].map(
    (at) => Number.parseInt(full.slice(at, at + 2), 16) / 255,
  );
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const lightness = (max + min) / 2;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  if (delta === 0) return { hue: 0, saturation };
  const sector =
    max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return { hue: (sector * 60 + 360) % 360, saturation };
}

/** The mascot a bot of this color wears: its palette mascot, else the nearest hue (grays are uncolored). */
export function mascotForColorDef(def: Pick<BotColorDef, "id" | "hex">): MascotId {
  const fromPalette = MASCOT_BY_PALETTE_ID[def.id];
  if (fromPalette) return fromPalette;
  const { hue, saturation } = hueAndSaturation(def.hex);
  if (saturation < NEUTRAL_SATURATION) return "neutral";
  let best: MascotId = "red";
  let bestDistance = 361;
  for (const [id, angle] of MASCOT_HUES) {
    const gap = Math.abs(hue - angle);
    const distance = Math.min(gap, 360 - gap);
    if (distance < bestDistance) {
      best = id;
      bestDistance = distance;
    }
  }
  return best;
}

/** The color a mascot stands for, as a hex value. */
export function mascotHex(id: MascotId): string {
  return MASCOT_COLORS.find((color) => color.id === id)?.hex ?? "#FFFFFF";
}

/**
 * The color a new bot gets when nobody chose one: the first rook hue, in picker order, that the
 * other active bots wear least, so each bot is told apart at a glance and the hues cycle once all
 * are taken. Gray is left out because a gray rook reads as one that is asleep. Pictures and values
 * that are not a color take no hue.
 */
export function nextBotColor(existing: readonly string[]): string {
  const hues = MASCOT_COLORS.filter((color) => color.id !== "neutral");
  const counts = new Map<MascotId, number>();
  for (const value of existing) {
    const avatar = parseBotAvatarValue(value);
    if (avatar.kind === "image" || avatar.kind === "other") continue;
    const mascot = mascotForColorDef(resolvePersonaColorDef("", avatar.color));
    counts.set(mascot, (counts.get(mascot) ?? 0) + 1);
  }
  const fewest = Math.min(...hues.map((hue) => counts.get(hue.id) ?? 0));
  return (hues.find((hue) => (counts.get(hue.id) ?? 0) === fewest) ?? hues[0]!).hex;
}

/** Each color's rook: its own shade, soft enough for dark eyes and a dark page. */
export const MASCOT_LOOKS: Record<MascotId, { color: string }> = {
  mint: { color: "#54c398" },
  blue: { color: "#75aef5" },
  violet: { color: "#b797ef" },
  pink: { color: "#e788b6" },
  red: { color: "#f48877" },
  orange: { color: "#e59651" },
  lime: { color: "#9bc43a" },
  yellow: { color: "#cda448" },
  cyan: { color: "#4bbdcf" },
  neutral: { color: "#55555c" },
};

/** The rook on a 100-unit tile: one rounded block under three rounded battlements. */
export const ROOK = {
  viewBox: "0 0 100 100",
  body: { x: 18, y: 28, width: 64, height: 60, rx: 18 },
  battlements: [18, 42, 66].map((x) => ({ x, y: 12, width: 16, height: 26, rx: 5 })),
} as const;

/** The rook of an agent that is asleep: gray, whatever its color. */
export const ROOK_ASLEEP_COLOR = "#4a4a52";

/** The ink of a rook's eyes: dark, because every shade it wears is soft enough for it. */
export const ROOK_EYE_COLOR = "#0f0f0f";

const FULL_HEX = /^#[0-9a-f]{6}$/i;
const SHORT_HEX = /^#[0-9a-f]{3}$/i;

const PRESET_HEXES = new Set(
  [...MASCOT_COLORS, ...BOT_COLOR_LIST].map((color) => color.hex.toLowerCase()),
);

/** Whether a color is one of the swatches the avatar picker offers, which have looks of their own. */
export function isPresetAvatarColor(hex: string): boolean {
  return PRESET_HEXES.has(hex.toLowerCase());
}

function toRgb(hex: string): [number, number, number] | undefined {
  const full = SHORT_HEX.test(hex)
    ? `#${[...hex.slice(1)].map((channel) => channel + channel).join("")}`
    : hex;
  if (!FULL_HEX.test(full)) return undefined;
  return [1, 3, 5].map((at) => Number.parseInt(full.slice(at, at + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const part = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const base = lightness - chroma / 2;
  const [r, g, b] =
    hue < 60
      ? [chroma, part, 0]
      : hue < 120
        ? [part, chroma, 0]
        : hue < 180
          ? [0, chroma, part]
          : hue < 240
            ? [0, part, chroma]
            : hue < 300
              ? [part, 0, chroma]
              : [chroma, 0, part];
  return `#${[r, g, b]
    .map((channel) =>
      Math.round((channel + base) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

const BODY_LIGHTNESS = { min: 0.42, max: 0.78 } as const;
const BODY_MAX_SATURATION = 0.75;

/**
 * The body a rook wears in a color of one's own: the hue that was chosen, softened like the
 * drawn ones, and kept light enough for its dark eyes and dark enough for a white page. Nothing
 * for a swatch, which already has a look, or for what is not a color.
 */
export function customMascotBody(hex: string): string | undefined {
  const rgb = toRgb(hex);
  if (!rgb || isPresetAvatarColor(hex)) return undefined;
  const [r, g, b] = rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  const hue =
    delta === 0
      ? 0
      : ((max === r
          ? ((g - b) / delta) % 6
          : max === g
            ? (b - r) / delta + 2
            : (r - g) / delta + 4) *
          60 +
          360) %
        360;
  return hslToHex(
    hue,
    Math.min(saturation * 0.9, BODY_MAX_SATURATION),
    Math.min(BODY_LIGHTNESS.max, Math.max(BODY_LIGHTNESS.min, lightness + 0.06)),
  );
}
