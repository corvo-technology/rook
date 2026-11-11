import type { CSSProperties } from "react";
import type { MascotHue } from "../mascot";
import { MASCOT_COLOR, MASCOT_SLEEP_COLOR } from "../mascot";

/** Working has open eyes; asking looks up and keeps the hue; sleeping is gray; done smiles. */
export type RookMood = "working" | "asking" | "sleeping" | "done";

function Eyes({ mood }: { mood: RookMood }) {
  if (mood === "sleeping") {
    return <path d="M32 57L44 57M56 57L68 57" className="rook__line" />;
  }
  if (mood === "done") {
    return <path d="M32 59Q38 49 44 59M56 59Q62 49 68 59" className="rook__line" />;
  }
  const up = mood === "asking";
  return (
    <g className="rook__eyes">
      <ellipse cx={up ? 40 : 38} cy={up ? 52 : 56} rx="5" ry="7.5" />
      <ellipse cx={up ? 64 : 62} cy={up ? 52 : 56} rx="5" ry="7.5" />
    </g>
  );
}

/**
 * The rook chess piece: one rounded block with three battlements and two eyes, in one color.
 * Plain markup, so it renders on the server and needs no script. Give it a `label` when it
 * carries meaning; without one it is decoration.
 */
export function Rook({
  hue,
  size,
  mood = "working",
  float = false,
  label,
}: {
  hue: MascotHue;
  size: number;
  mood?: RookMood;
  float?: boolean;
  label?: string;
}) {
  const color = mood === "sleeping" ? MASCOT_SLEEP_COLOR : MASCOT_COLOR[hue];
  return (
    <svg
      className="rook"
      data-float={float ? "" : undefined}
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      style={{ "--rook": color } as CSSProperties}
    >
      <g className="rook__body">
        <rect x="18" y="12" width="16" height="26" rx="5" />
        <rect x="42" y="12" width="16" height="26" rx="5" />
        <rect x="66" y="12" width="16" height="26" rx="5" />
        <rect x="18" y="28" width="64" height="60" rx="18" />
      </g>
      <Eyes mood={mood} />
    </svg>
  );
}
