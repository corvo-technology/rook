import { describe, expect, it } from "vitest";
import { BOT_COLOR_LIST, resolvePersonaColorDef } from "./bot-avatar-colors.js";
import {
  customMascotBody,
  isPresetAvatarColor,
  MASCOT_COLORS,
  MASCOT_LOOKS,
  mascotForColorDef,
  mascotHex,
  nextBotColor,
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

describe("nextBotColor", () => {
  const hex = (id: string) => MASCOT_COLORS.find((color) => color.id === id)!.hex;

  it("starts with the first hue in picker order", () => {
    expect(nextBotColor([])).toBe(hex("mint"));
  });

  it("gives the first hue no other bot wears", () => {
    expect(nextBotColor([hex("mint"), hex("violet")])).toBe(hex("blue"));
  });

  it("counts characters and old shapes by their color, and skips pictures", () => {
    expect(
      nextBotColor([
        `${hex("mint")}::char_cat`,
        `${hex("blue")}::shape_2`,
        "data:image/png;base64,x",
      ]),
    ).toBe(hex("violet"));
  });

  it("matches a color of one's own to the nearest hue", () => {
    expect(nextBotColor(["#3EC5A8"])).toBe(hex("blue"));
  });

  it("cycles through the hues once every one is taken, never to gray", () => {
    const colored = MASCOT_COLORS.filter((color) => color.id !== "neutral").map((c) => c.hex);
    expect(nextBotColor(colored)).toBe(hex("mint"));
    expect(nextBotColor([...colored, hex("mint")])).toBe(hex("blue"));
    expect(nextBotColor(colored)).not.toBe(hex("neutral"));
  });
});

describe("the greens of the rook palette", () => {
  // CIE76 distance: around 30 is a difference anyone sees at a glance.
  const lab = (hex: string): [number, number, number] => {
    const [r, g, b] = [1, 3, 5].map((at) => {
      const channel = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    const f = (v: number) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
    const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
    const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
    const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  };
  const distance = (a: string, b: string) => {
    const [l1, a1, b1] = lab(a);
    const [l2, a2, b2] = lab(b);
    return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
  };

  it.each([
    ["mint", "lime"],
    ["mint", "cyan"],
    ["lime", "yellow"],
  ] as const)("tells %s from %s at a glance", (first, second) => {
    expect(distance(MASCOT_LOOKS[first].color, MASCOT_LOOKS[second].color)).toBeGreaterThan(33);
  });

  it("keeps lime's saved color, so bots that chose it keep their rook", () => {
    expect(mascotForColorDef({ id: "custom", hex: "#84CC16" })).toBe("lime");
  });
});
