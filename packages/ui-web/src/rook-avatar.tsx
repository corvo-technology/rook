import type { MascotMood } from "@corvo/core";
import { ROOK_ASLEEP_COLOR, ROOK_AVATAR, ROOK_EYE_COLOR } from "@corvo/core";
import type { AvatarMotion } from "open-bot-avatar";
import { renderAvatarSvg } from "open-bot-avatar";
import type { Gaze } from "./character-avatar.js";
import { CharacterAvatar, characterMood, LIVELY_FROM } from "./character-avatar.js";

// The rook's drawing lives in @corvo/core with the rest of the set, so the website draws the same one.
export { ROOK_AVATAR };

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
