import type { MascotId, MascotMood } from "@corvo/core";
import {
  MASCOT_ASLEEP_DASHES,
  MASCOT_EYES,
  MASCOT_HAPPY_ARCS,
  MASCOT_LOOKS,
  mascotEyeState,
  ROOK,
  ROOK_ASLEEP_COLOR,
} from "@corvo/core";

/**
 * The rook: one rounded block under three battlements, in the agent's shade, with two eyes. The eyes
 * are drawn here so they can move: they follow the pointer, blink on their own, scan while the agent
 * works and look up when it waits for you. Done is a pair of happy arcs, asleep is two dashes and
 * a gray body. Nothing else about the rook changes with the agent's state.
 */
export function MascotFace({
  mascot,
  mood,
  blink,
  body,
}: {
  mascot: MascotId;
  mood: MascotMood;
  blink: { every: string; delay: string };
  /** The body in a color of one's own; the mascot's own shade when absent. */
  body?: string;
}) {
  const state = mascotEyeState(mood);
  const shade = state === "closed" ? ROOK_ASLEEP_COLOR : (body ?? MASCOT_LOOKS[mascot].color);
  const centers = state === "up" ? MASCOT_EYES.waitingCenters : MASCOT_EYES.centers;
  return (
    <svg
      className="corvo-mascot-eyes"
      data-mood={mood}
      viewBox={ROOK.viewBox}
      aria-hidden="true"
      overflow="visible"
      style={{ "--blink-every": blink.every, "--blink-delay": blink.delay } as React.CSSProperties}
    >
      <g fill={shade}>
        {ROOK.battlements.map((battlement) => (
          <rect key={battlement.x} className="corvo-mascot-battlement" {...battlement} />
        ))}
        <rect {...ROOK.body} />
      </g>
      <g className="corvo-mascot-gaze">
        <g className="corvo-mascot-scan">
          {state === "open" || state === "up"
            ? centers.map((center) => (
                <g key={center.x} className="corvo-mascot-eye">
                  <g className="corvo-mascot-blink">
                    <ellipse
                      className="corvo-mascot-eye-ball"
                      cx={center.x}
                      cy={center.y}
                      rx={MASCOT_EYES.rx}
                      ry={MASCOT_EYES.ry}
                    />
                  </g>
                </g>
              ))
            : (state === "closed" ? MASCOT_ASLEEP_DASHES : MASCOT_HAPPY_ARCS).map((d) => (
                <path
                  key={d}
                  className="corvo-mascot-smile"
                  d={d}
                  fill="none"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                />
              ))}
        </g>
      </g>
    </svg>
  );
}
