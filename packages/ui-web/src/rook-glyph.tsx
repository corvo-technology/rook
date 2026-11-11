import {
  MASCOT_EYES,
  MASCOT_HAPPY_ARCS,
  MASCOT_SLEEP_ARCS,
  ROOK,
  ROOK_SPINNER_ARC,
  rookRingDots,
} from "@corvo/core";
import { useId } from "react";
import { cn } from "./lib/utils.js";
import "./styles.css";

/**
 * What the small rook is doing: looking around while idle, thinking inside a ring of dots, asleep
 * with closed eyes, done with happy arcs, or folding into a spinner arc while something loads.
 */
export type RookGlyphState = "idle" | "thinking" | "asleep" | "done" | "loading";

const RING_DOTS = rookRingDots();

/**
 * The rook as an icon: one silhouette in `currentColor` (ink unless a color is set on it or a
 * parent), with the eyes cut out of it. The same geometry as the bots' avatars, so the interface's
 * waiting and idle moments speak with the same character. Decorative unless `label` is given.
 */
export function RookGlyph({
  state = "idle",
  size = 20,
  label,
  className,
}: {
  state?: RookGlyphState;
  size?: number;
  label?: string;
  className?: string;
}) {
  const maskId = `rook-glyph-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const frame = {
    className: cn("corvo-rook-glyph relative inline-block shrink-0", className),
    "data-state": state,
    style: { width: size, height: size },
  };
  const drawing = (
    <svg viewBox={ROOK.viewBox} className="block h-full w-full" overflow="visible">
      <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
        <rect width="100" height="100" fill="white" />
        {state === "asleep" || state === "done" ? (
          (state === "asleep" ? MASCOT_SLEEP_ARCS : MASCOT_HAPPY_ARCS).map((d) => (
            <path
              key={d}
              className="corvo-rook-glyph-arcs"
              d={d}
              fill="none"
              stroke="black"
              strokeWidth="6"
              strokeLinecap="round"
            />
          ))
        ) : (
          <g className="corvo-rook-glyph-eyes">
            {MASCOT_EYES.centers.map((center) => (
              <ellipse
                key={center.x}
                className="corvo-rook-glyph-eye"
                cx={center.x}
                cy={center.y}
                rx={MASCOT_EYES.rx + 0.5}
                ry={MASCOT_EYES.ry}
                fill="black"
              />
            ))}
          </g>
        )}
      </mask>
      <g className="corvo-rook-glyph-body" fill="currentColor" mask={`url(#${maskId})`}>
        {ROOK.battlements.map((battlement) => (
          <rect key={battlement.x} {...battlement} />
        ))}
        <rect {...ROOK.body} />
      </g>
      {state === "thinking" ? (
        <g className="corvo-rook-glyph-dots" fill="currentColor">
          {RING_DOTS.map((dot, index) => (
            <circle
              key={`${dot.x}-${dot.y}`}
              className="corvo-rook-glyph-dot"
              cx={dot.x}
              cy={dot.y}
              r="5"
              style={{ animationDelay: `${index * 0.125}s` }}
            />
          ))}
        </g>
      ) : null}
      {state === "loading" ? (
        <g className="corvo-rook-glyph-spinner">
          <path
            className="corvo-rook-glyph-arc"
            d={ROOK_SPINNER_ARC}
            fill="none"
            stroke="currentColor"
            strokeWidth="10"
            strokeLinecap="round"
          />
        </g>
      ) : null}
    </svg>
  );
  return label ? (
    <span {...frame} role="img" aria-label={label}>
      {drawing}
    </span>
  ) : (
    <span {...frame} aria-hidden="true">
      {drawing}
    </span>
  );
}
