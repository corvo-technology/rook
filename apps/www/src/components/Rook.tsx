import type { CSSProperties } from "react";
import type { MascotHue } from "../mascot";
import { MASCOT_COLOR, MASCOT_SLEEP_COLOR } from "../mascot";

/**
 * Idle blinks and follows the pointer; working scans; asking looks up and hops once;
 * done smiles; sleeping is gray with dashes.
 */
export type RookMood = "idle" | "working" | "asking" | "sleeping" | "done";

/**
 * The rook chess piece: one rounded block with three battlements and two eyes, in one color.
 * Plain markup, so it renders on the server and needs no script. The eyes sit in a group that
 * `rook-gaze.ts` moves toward the pointer, and each rook blinks on its own beat (from `seed`),
 * so server and browser agree. Give it a `label` when it carries meaning; without one it is
 * decoration.
 */
export function Rook({
  hue,
  size,
  mood = "idle",
  float = false,
  label,
  seed = 0,
  gaze = true,
  react = false,
  ring = false,
  still = false,
}: {
  hue: MascotHue;
  size: number;
  mood?: RookMood;
  float?: boolean;
  label?: string;
  /** Offsets the blink so a row of rooks never blinks together. */
  seed?: number;
  /** Eyes follow the pointer. */
  gaze?: boolean;
  /** Smiles while hovered or tapped. */
  react?: boolean;
  /** A thin ring that pulses while working. */
  ring?: boolean;
  /** Animates only while its parent state is hovered or focused. */
  still?: boolean;
}) {
  const color = mood === "sleeping" ? MASCOT_SLEEP_COLOR : MASCOT_COLOR[hue];
  const style = {
    "--rook": color,
    "--blink-every": `${(4.6 + ((seed * 0.7) % 1.6)).toFixed(2)}s`,
    "--blink-delay": `${(-((seed * 1.37) % 4.6)).toFixed(2)}s`,
  } as CSSProperties;
  return (
    <svg
      className="rook"
      data-float={float ? "" : undefined}
      data-mood={mood}
      data-gaze={gaze && mood !== "sleeping" ? "" : undefined}
      data-react={react ? "" : undefined}
      data-still={still ? "" : undefined}
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      style={style}
    >
      {ring ? <circle className="rook__ring" cx="50" cy="50" r="54" /> : null}
      <g className="rook__body">
        <rect className="rook__bat" x="18" y="12" width="16" height="26" rx="5" />
        <rect className="rook__bat" x="42" y="12" width="16" height="26" rx="5" />
        <rect className="rook__bat" x="66" y="12" width="16" height="26" rx="5" />
        <rect x="18" y="28" width="64" height="60" rx="18" />
      </g>
      <g className="rook__gaze">
        {mood === "sleeping" ? (
          <path d="M32 57L44 57M56 57L68 57" className="rook__line" />
        ) : (
          <g className="rook__look">
            <g className="rook__pupils">
              <ellipse className="rook__eye" cx="38" cy="56" rx="5" ry="7.5" />
              <ellipse className="rook__eye" cx="62" cy="56" rx="5" ry="7.5" />
            </g>
            <path className="rook__line rook__smile" d="M32 59Q38 49 44 59M56 59Q62 49 68 59" />
          </g>
        )}
      </g>
    </svg>
  );
}
