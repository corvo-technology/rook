import { describe, expect, it } from "vitest";
import { BOT_COLOR_LIST, resolvePersonaColorDef } from "./bot-avatar-colors.js";
import {
  customMascotBody,
  isPresetAvatarColor,
  MASCOT_COLORS,
  MASCOT_LOOKS,
  mascotForColorDef,
  mascotHex,
  ROOK,
} from "./bot-mascot.js";

describe("mascotForColorDef", () => {
  it("gives every palette color a mascot", () => {
    const byId = Object.fromEntries(BOT_COLOR_LIST.map((def) => [def.id, mascotForColorDef(def)]));
    expect(byId).toEqual({
      white: "neutral",
      violet: "violet",
      green: "mint",
      orange: "orange",
      cyan: "cyan",
      blue: "blue",
      yellow: "yellow",
      brown: "orange",
      red: "red",
      magenta: "pink",
      gray: "neutral",
    });
  });

  it("gives each mascot swatch back its own mascot", () => {
    for (const color of MASCOT_COLORS) {
      expect(mascotForColorDef(resolvePersonaColorDef("any", color.hex)), color.id).toBe(color.id);
    }
  });

  it("picks the nearest hue for a custom color", () => {
    const custom = (hex: string) => mascotForColorDef(resolvePersonaColorDef("any", hex));
    expect(custom("#FF0000")).toBe("red");
    expect(custom("#9ACD32")).toBe("lime");
    expect(custom("#1E90FF")).toBe("blue");
    expect(custom("#FF1493")).toBe("pink");
  });

  it("uses the uncolored mascot for grays and near-grays", () => {
    const custom = (hex: string) => mascotForColorDef(resolvePersonaColorDef("any", hex));
    expect(custom("#808080")).toBe("neutral");
    expect(custom("#8A8D8C")).toBe("neutral");
  });
});

describe("the mascot colors", () => {
  it("knows the color each mascot stands for", () => {
    expect(mascotHex("violet")).toBe("#8B5CF6");
    expect(mascotHex("neutral")).toBe("#FFFFFF");
  });
});

describe("the rook of each mascot", () => {
  it("has a look for every color, each in a shade of its own", () => {
    const shades = MASCOT_COLORS.map(({ id }) => MASCOT_LOOKS[id].color);
    expect(new Set(shades).size).toBe(MASCOT_COLORS.length);
    for (const shade of shades) expect(shade).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("keeps the uncolored rook graphite, so a white one is never lost on a white page", () => {
    expect(MASCOT_LOOKS.neutral.color).toBe("#55555c");
  });

  it("is one block under three battlements, with nothing else to tell the colors apart", () => {
    expect(ROOK.body).toEqual({ x: 18, y: 28, width: 64, height: 60, rx: 18 });
    expect(ROOK.battlements.map((battlement) => battlement.x)).toEqual([18, 42, 66]);
    for (const color of Object.values(MASCOT_LOOKS)) expect(Object.keys(color)).toEqual(["color"]);
  });
});

describe("a color of one's own", () => {
  it("knows the swatches of both palettes, whatever the case", () => {
    for (const { hex } of [...MASCOT_COLORS, ...BOT_COLOR_LIST]) {
      expect(isPresetAvatarColor(hex), hex).toBe(true);
      expect(isPresetAvatarColor(hex.toLowerCase()), hex).toBe(true);
    }
    expect(isPresetAvatarColor("#14B8A6")).toBe(false);
    expect(isPresetAvatarColor("#123")).toBe(false);
  });

  it("leaves the swatches the look they were drawn with", () => {
    for (const { hex } of MASCOT_COLORS) expect(customMascotBody(hex), hex).toBeUndefined();
  });

  it("gives any other color its own body, in the hue that was chosen", () => {
    const body = customMascotBody("#14B8A6");
    expect(body).toMatch(/^#[0-9a-f]{6}$/);
    expect(hueOf(body!)).toBeCloseTo(hueOf("#14B8A6"), -1);
  });

  it("keeps the body light enough for the eyes and dark enough for a white page", () => {
    for (const hex of ["#000000", "#0A0A3A", "#FFF0F0", "#FFFF00", "#7F7F7F", "#FF00FF"]) {
      const lightness = lightnessOf(customMascotBody(hex)!);
      expect(lightness, hex).toBeGreaterThanOrEqual(0.4);
      expect(lightness, hex).toBeLessThanOrEqual(0.8);
    }
  });

  it("accepts a short hex and ignores what is not a color", () => {
    expect(customMascotBody("#1b8")).toMatch(/^#[0-9a-f]{6}$/);
    expect(customMascotBody("not a color")).toBeUndefined();
    expect(customMascotBody("")).toBeUndefined();
  });
});

function rgb(hex: string) {
  return [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
}
function hueOf(hex: string) {
  const [r, g, b] = rgb(hex);
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  if (delta === 0) return 0;
  const sector =
    max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return (sector * 60 + 360) % 360;
}
function lightnessOf(hex: string) {
  const [r, g, b] = rgb(hex);
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
}
