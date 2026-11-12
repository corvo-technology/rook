import {
  ACTIVE_RUN_STATUSES,
  customMascotBody,
  MASCOT_COLORS,
  MASCOT_LOOKS,
  ROOK_ASLEEP_COLOR,
  ROOK_EYE_COLOR,
} from "@corvo/core";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  BOT_AVATAR_COLORS,
  BotAvatar,
  botAccent,
  DEFAULT_BOT_AVATAR_COLOR,
  defaultBotAvatarValue,
  parseBotAvatar,
  resolvePersonaColorDef,
} from "./bot-avatar.js";

const mascotOf = (html: string) => html.match(/data-mascot="([a-z]+)"/)?.[1];

describe("BotAvatar", () => {
  it("shows a flat tile in the bot's color with two eyes and no picture", () => {
    const html = renderToString(<BotAvatar color="#8B5CF6" size={40} />);
    expect(mascotOf(html)).toBe("violet");
    expect(html).toContain("<svg");
    expect(html).toMatch(/style="[^"]*width:40px;height:40px/);
    expect(html).not.toContain("<img");
  });

  it("gives every palette color a tile with eyes", () => {
    for (const color of BOT_AVATAR_COLORS) {
      const html = renderToString(<BotAvatar color={color} />);
      expect(html, color).toContain("<svg");
    }
  });

  it("wears the same mascot for an older shape-suffixed value", () => {
    const shaped = renderToString(<BotAvatar color="#8B5CF6::shape_3" />);
    expect(mascotOf(shaped)).toBe("violet");
    expect(shaped).not.toContain("::shape");
  });

  it("uses the nearest mascot for a custom color", () => {
    expect(mascotOf(renderToString(<BotAvatar color="#9ACD32" />))).toBe("lime");
    expect(mascotOf(renderToString(<BotAvatar color="#8A8D8C" />))).toBe("neutral");
  });

  it("paints a color of one's own as the body, and keeps the drawn look of a swatch", () => {
    const own = renderToString(<BotAvatar color="#14B8A6" size={40} />);
    const body = customMascotBody("#14B8A6");
    expect(body).toBeDefined();
    expect(own).toContain(`fill="${body}"`);
    expect(own).not.toContain(MASCOT_LOOKS.cyan.color);

    // The swatches, and the lime that has a mascot but no palette entry, keep the shade they were
    // drawn with.
    for (const { id, hex } of MASCOT_COLORS) {
      const html = renderToString(<BotAvatar color={hex} size={40} />);
      expect(html, id).toContain(`fill="${MASCOT_LOOKS[id].color}"`);
    }
  });

  it("draws the rook with the engine: one outline in its shade and two eyes, no chick details", () => {
    const html = renderToString(<BotAvatar color="#3B82F6" size={40} />);
    expect(html).toContain("<svg");
    expect(html).toContain(MASCOT_LOOKS.blue.color);
    expect(html).toContain(ROOK_EYE_COLOR);
    expect(html).not.toContain("corvo-mascot-battlement");
    for (const gone of [
      "polygon",
      "#f9b64f",
      "#c5256d",
      "#1c1c1e",
      "#ff82a0",
      "corvo-mascot-crest",
    ])
      expect(html).not.toContain(gone);
  });

  it("is gray and keeps the state it is in when it sleeps, in the shade of its color otherwise", () => {
    const moodOf = (status: string) =>
      renderToString(<BotAvatar color="#3B82F6" status={status} />).match(
        /data-mood="([a-z]+)"/,
      )?.[1];
    expect(moodOf("waiting_input")).toBe("alert");
    expect(moodOf("running")).toBe("thinking");
    expect(moodOf("failed")).toBe("failed");
    const asleep = renderToString(<BotAvatar color="#3B82F6" status="asleep" />);
    expect(asleep).toContain(ROOK_ASLEEP_COLOR);
    expect(asleep).not.toContain(MASCOT_LOOKS.blue.color);
    const waiting = renderToString(<BotAvatar color="#3B82F6" status="waiting_input" />);
    expect(waiting).toContain(MASCOT_LOOKS.blue.color);
  });

  it.each([...ACTIVE_RUN_STATUSES])(
    "marks active run status %s as working, with a ring",
    (status) => {
      const html = renderToString(<BotAvatar color="#3B82F6" status={status} />);
      expect(html).toContain('data-working="true"');
      expect(html).toContain("corvo-bot-avatar-ring-working");
      // Eight dots in the rook's own shade.
      expect(html.match(/<circle/g)).toHaveLength(8);
      expect(html).toContain(`fill="${MASCOT_LOOKS.blue.color}"`);
    },
  );

  it("shows a brand dot only while it waits for the person", () => {
    const waiting = renderToString(<BotAvatar color="#3B82F6" status="waiting_input" />);
    expect(waiting).toContain("data-needs-you");
    expect(waiting).toContain("bg-brand");
    expect(renderToString(<BotAvatar color="#3B82F6" status="running" />)).not.toContain(
      "data-needs-you",
    );
    expect(
      renderToString(<BotAvatar color="data:image/png;base64,abc" status="waiting_takeover" />),
    ).toContain("data-needs-you");
  });

  it("is ring-free when idle", () => {
    const html = renderToString(<BotAvatar color="#F59E0B" status="idle" />);
    expect(html).toContain('data-working="false"');
    expect(html).not.toContain("corvo-bot-avatar-ring");
  });

  it("never draws the old shapes or eyes", () => {
    const html = renderToString(<BotAvatar color="#8B5CF6" identity="maya" status="running" />);
    expect(html).not.toContain("corvo-mascot-eyes");
    expect(html).not.toContain("corvo-organic-avatar");
    expect(html).not.toContain("bot-character-eyes");
  });

  it("renders uploaded images as a round photo, not a mascot", () => {
    const html = renderToString(
      <BotAvatar color="data:image/png;base64,abc" identity="maya" size={32} />,
    );
    expect(html).toContain("corvo-bot-avatar-picture");
    expect(html).toContain('src="data:image/png;base64,abc"');
    expect(html).not.toContain("data-mascot");
  });

  it("keeps a working photo ring outside the clipped image and uses the status token", () => {
    const html = renderToString(
      <BotAvatar color="data:image/png;base64,abc" identity="maya" size={32} status="running" />,
    );
    expect(html).toContain('class="corvo-bot-avatar relative shrink-0 select-none"');
    expect(html).toContain("corvo-bot-avatar-ring-working");
    expect(html).toContain("fill-status-working");
    expect(html.indexOf("corvo-bot-avatar-picture")).toBeLessThan(
      html.indexOf("corvo-bot-avatar-ring"),
    );
  });

  it("keeps idle photo avatars ring-free", () => {
    const html = renderToString(
      <BotAvatar color="data:image/png;base64,abc" identity="maya" size={32} status="idle" />,
    );
    expect(html).toContain('data-working="false"');
    expect(html).not.toContain("corvo-bot-avatar-ring");
  });

  it("does not treat arbitrary http(s) color values as remote images", () => {
    const parsed = parseBotAvatar("https://evil.example/track.png");
    expect(parsed.isImage).toBe(false);
    expect(parsed.imageUrl).toBeUndefined();
    const html = renderToString(
      <BotAvatar color="https://evil.example/track.png" identity="maya" size={32} />,
    );
    expect(html).not.toContain("evil.example");
    expect(html).toContain("data-mascot");
  });
});

describe("parseBotAvatar", () => {
  it("drops a shape suffix and keeps the color", () => {
    expect(parseBotAvatar(`${DEFAULT_BOT_AVATAR_COLOR}::shape_3`)).toEqual({
      color: DEFAULT_BOT_AVATAR_COLOR,
      isImage: false,
    });
    expect(parseBotAvatar("#10B981::shape_oops").color).toBe("#10B981");
  });

  it("falls back to orange for an empty value", () => {
    expect(parseBotAvatar("").color).toBe("#F97316");
  });
});

describe("defaultBotAvatarValue", () => {
  it("keeps a valid hex and drops the suffix", () => {
    expect(defaultBotAvatarValue("#10B981::shape_2")).toBe("#10B981");
  });

  it("falls back to the default color for an image or an invalid value", () => {
    expect(defaultBotAvatarValue("data:image/png;base64,abc")).toBe(DEFAULT_BOT_AVATAR_COLOR);
    expect(defaultBotAvatarValue("not-a-color")).toBe(DEFAULT_BOT_AVATAR_COLOR);
  });
});

describe("resolvePersonaColorDef", () => {
  it("falls back to the identity palette for invalid custom hex", () => {
    expect(resolvePersonaColorDef("bot", "#zzzzzz")).toEqual(resolvePersonaColorDef("bot"));
    expect(resolvePersonaColorDef("bot", "#ggg")).toEqual(resolvePersonaColorDef("bot"));
  });
});

describe("the mascot's mood", () => {
  const moodOf = (html: string) => html.match(/data-mood="([a-z]+)"/)?.[1];

  it.each([
    [undefined, "idle"],
    ["running", "thinking"],
    ["queued", "thinking"],
    ["waiting_input", "alert"],
    ["waiting_takeover", "alert"],
    ["failed", "failed"],
    ["idle", "idle"],
  ])("shows status %s as %s", (status, mood) => {
    expect(moodOf(renderToString(<BotAvatar color="#3B82F6" status={status} />))).toBe(mood);
  });

  it("fills the rook with the shade the bot's color gives it", () => {
    expect(renderToString(<BotAvatar color="#8B5CF6" />)).toContain("#b797ef");
    expect(renderToString(<BotAvatar color="#10B981" />)).toContain("#54c398");
  });
});

describe("botAccent", () => {
  it("is the shade the bot's rook is drawn in, and nothing for a picture", () => {
    expect(botAccent("#3B82F6")).toBe(MASCOT_LOOKS.blue.color);
    expect(botAccent("#8B5CF6::char_cat")).toBe(MASCOT_LOOKS.violet.color);
    expect(botAccent("#14B8A6")).toBe(customMascotBody("#14B8A6"));
    expect(botAccent("data:image/png;base64,abc")).toBeUndefined();
  });
});
