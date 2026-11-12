import type { MascotMood } from "@corvo/core";
import { ROOK_ASLEEP_COLOR, ROOK_EYE_COLOR } from "@corvo/core";
import type { AvatarDefinition, AvatarMotion } from "open-bot-avatar";
import { renderAvatarSvg } from "open-bot-avatar";
import type { Gaze } from "./character-avatar.js";
import { CharacterAvatar, characterMood, LIVELY_FROM } from "./character-avatar.js";

/**
 * The rook as an Open Bot Avatar: one block under three battlements, drawn as a single outline so
 * the engine turns it as one rounded slab. It is a little wider than the small glyph so the eyes
 * have the room the engine's strict check asks for (see rook-avatar.test.tsx).
 */
export const ROOK_AVATAR: AvatarDefinition = {
  version: 1,
  id: "rook",
  name: "Rook",
  body: {
    path: "M19 12H29A5 5 0 0 1 34 17V28H42V17A5 5 0 0 1 47 12H53A5 5 0 0 1 58 17V28H66V17A5 5 0 0 1 71 12H81A5 5 0 0 1 86 17V70A18 18 0 0 1 68 88H32A18 18 0 0 1 14 70V17A5 5 0 0 1 19 12Z",
  },
  eyes: { x: 50, y: 57, spacing: 26, scale: 1.2 },
};

/** Where the rook looks (each axis -1..1, y down): up at the person when it waits, down when it failed. */
export function rookGaze(mood: MascotMood): { x: number; y: number } | undefined {
  if (mood === "alert") return { x: 0, y: -1 };
  if (mood === "failed") return { x: 0, y: 0.8 };
  if (mood === "asleep") return { x: 0, y: 0.5 };
  return undefined;
}

const stills = new Map<string, string>();

/** The still rook: engine SVG built without a DOM, and kept, so a long list pays for each look once. */
function rookStill(color: string, mood: AvatarMotion, gaze: { x: number; y: number } | undefined) {
  const key = `${color}|${mood}|${gaze?.y ?? ""}`;
  let svg = stills.get(key);
  if (svg === undefined) {
    svg = renderAvatarSvg(ROOK_AVATAR, {
      color,
      eyeColor: ROOK_EYE_COLOR,
      motion: mood,
      gaze,
      reducedMotion: true,
      // The agent's name is shown beside it, so the picture is decoration without a title.
    })
      .replace(/ role="img" aria-label="[^"]*"/, ' aria-hidden="true"')
      .replace(/<title>[^<]*<\/title>/, "");
    stills.set(key, svg);
  }
  return svg;
}

/**
 * The default look of a bot. From `LIVELY_FROM` it is alive like the characters (it turns to the
 * pointer and blinks); smaller, in lists, it is one still SVG, which costs no observer or script
 * per avatar and also renders on the server. A sleeping rook is gray and still at any size.
 */
export function RookAvatar({
  color,
  mood,
  size,
  live = size >= LIVELY_FROM,
  lookAt,
}: {
  /** The shade of its body. */
  color: string;
  mood: MascotMood;
  size: number;
  /** Alive below `LIVELY_FROM` too, where its place asks for it (a message in the conversation). */
  live?: boolean;
  /** Where its place asks it to look; otherwise its mood decides. */
  lookAt?: Gaze;
}) {
  const asleep = mood === "asleep";
  const shade = asleep ? ROOK_ASLEEP_COLOR : color;
  const gaze = rookGaze(mood);
  if (live && !asleep) {
    return (
      <CharacterAvatar
        definition={ROOK_AVATAR}
        color={shade}
        eyeColor={ROOK_EYE_COLOR}
        mood={mood}
        size={size}
        live
        lookAt={lookAt ?? gaze}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="corvo-character block"
      style={{ width: size, height: size }}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: markup from the engine's own renderer for our fixed definition and a validated color
      dangerouslySetInnerHTML={{ __html: rookStill(shade, characterMood(mood), gaze) }}
    />
  );
}
