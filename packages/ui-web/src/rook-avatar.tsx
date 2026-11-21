import type { AvatarLook } from "@corvo/core";
import { ROOK_ASLEEP_COLOR, ROOK_AVATAR, ROOK_EYE_COLOR } from "@corvo/core";
import { renderAvatarSvg } from "open-bot-avatar";
import type { Gaze } from "./character-avatar.js";
import { CharacterAvatar, LIVELY_FROM } from "./character-avatar.js";

// The rook's drawing lives in @corvo/core with the rest of the set, so the website draws the same one.
export { ROOK_AVATAR };

/** Where the rook looks (each axis -1..1, y down): up at the person when it waits, down when it sleeps. */
export function rookGaze(look: AvatarLook): { x: number; y: number } | undefined {
  if (look.state === "waiting") return { x: 0, y: -1 };
  if (look.asleep) return { x: 0, y: 0.5 };
  return undefined;
}

const stills = new Map<string, string>();

/** The still rook: engine SVG built without a DOM, and kept, so a long list pays for each look once. */
function rookStill(
  color: string,
  look: Pick<AvatarLook, "state" | "mood">,
  gaze: { x: number; y: number } | undefined,
) {
  const key = `${color}|${look.state}|${look.mood}|${gaze?.y ?? ""}`;
  let svg = stills.get(key);
  if (svg === undefined) {
    svg = renderAvatarSvg(ROOK_AVATAR, {
      color,
      eyeColor: ROOK_EYE_COLOR,
      state: look.state,
      mood: look.mood,
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
  look,
  size,
  live = size >= LIVELY_FROM,
  lookAt,
}: {
  /** The shade of its body. */
  color: string;
  look: AvatarLook;
  size: number;
  /** Alive below `LIVELY_FROM` too, where its place asks for it (a message in the conversation). */
  live?: boolean;
  /** Where its place asks it to look; otherwise its state decides. */
  lookAt?: Gaze;
}) {
  const asleep = look.asleep;
  const shade = asleep ? ROOK_ASLEEP_COLOR : color;
  const gaze = rookGaze(look);
  if (live && !asleep) {
    return (
      <CharacterAvatar
        definition={ROOK_AVATAR}
        color={shade}
        eyeColor={ROOK_EYE_COLOR}
        look={look}
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
      dangerouslySetInnerHTML={{ __html: rookStill(shade, look, gaze) }}
    />
  );
}
