/** Where the two eyes sit on the rook's 100-unit tile, and how big they are. */
export const MASCOT_EYES = {
  centers: [
    { x: 38, y: 56 },
    { x: 62, y: 56 },
  ],
  rx: 5,
  ry: 7.5,
} as const;

/** Done is a pair of happy arcs, for the small glyph. */
export const MASCOT_HAPPY_ARCS = ["M32 59 Q38 49 44 59", "M56 59 Q62 49 68 59"] as const;

/** Closed eyes that curve down, for the small rook glyph that sleeps where nothing is going on. */
export const MASCOT_SLEEP_ARCS = ["M32 55 Q38 62 44 55", "M56 55 Q62 62 68 55"] as const;

/** How many dots ring a rook that is thinking, and where they sit on its 100-unit tile. */
export const ROOK_RING_DOT_COUNT = 8;

/** Dots evenly around the tile's middle, clockwise from the top, `radius` units out. */
export function rookRingDots(
  count: number = ROOK_RING_DOT_COUNT,
  radius = 43,
): { x: number; y: number }[] {
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * 2 * Math.PI - Math.PI / 2;
    return {
      x: Number((50 + radius * Math.cos(angle)).toFixed(2)),
      y: Number((50 + radius * Math.sin(angle)).toFixed(2)),
    };
  });
}

/** The arc the rook folds into while something loads: three quarters of a circle around the middle. */
export const ROOK_SPINNER_ARC = "M50 16 A34 34 0 1 1 16 50";

export type MascotMood = "idle" | "thinking" | "alert" | "failed" | "happy" | "asleep";

/** How the mascot feels, from what its run is doing and whether work just finished. */
export function mascotMood(status: string | undefined, justFinished: boolean): MascotMood {
  switch (status) {
    case "queued":
    case "leased":
    case "running":
      return "thinking";
    case "waiting_input":
    case "waiting_takeover":
      return "alert";
    case "failed":
      return "failed";
    case "asleep":
      return "asleep";
    default:
      return justFinished ? "happy" : "idle";
  }
}
