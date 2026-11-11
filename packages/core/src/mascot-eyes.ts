/** Where the two eyes sit on the rook's 100-unit tile, and how big they are. */
export const MASCOT_EYES = {
  centers: [
    { x: 38, y: 56 },
    { x: 62, y: 56 },
  ],
  rx: 5,
  ry: 7.5,
  /** Looking up at the person: higher and a little to the right, as waiting for an answer. */
  waitingCenters: [
    { x: 40, y: 52 },
    { x: 64, y: 52 },
  ],
} as const;

/** Eyes that are asleep are short dashes at the eyes' height; done is a pair of happy arcs. */
export const MASCOT_ASLEEP_DASHES = ["M32 57 L44 57", "M56 57 L68 57"] as const;
export const MASCOT_HAPPY_ARCS = ["M32 59 Q38 49 44 59", "M56 59 Q62 49 68 59"] as const;

/** The furthest, in tile units, the eyes move from the middle to look at something. */
export const EYE_REACH = 4;

/** Past this distance, in pixels, the eyes look as far as they can. */
const FULL_REACH_DISTANCE = 240;

/**
 * Where the eyes look when something is at `to` and the mascot is at `from`: toward it, further the
 * further away it is, up to `EYE_REACH`. Straight ahead when it is right on the mascot.
 */
export function eyeLook(
  from: { x: number; y: number },
  to: { x: number; y: number },
): { x: number; y: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return { x: 0, y: 0 };
  const strength = Math.min(1, distance / FULL_REACH_DISTANCE) * EYE_REACH;
  return { x: (dx / distance) * strength, y: (dy / distance) * strength };
}

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

/**
 * What a mood changes on the rook: only its eyes and its color. Open eyes work or idle, eyes up
 * wait for the person's approval, dashes are asleep (in gray), arcs are done.
 */
export function mascotEyeState(mood: MascotMood): "open" | "up" | "closed" | "happy" {
  switch (mood) {
    case "alert":
      return "up";
    case "asleep":
      return "closed";
    case "happy":
      return "happy";
    default:
      return "open";
  }
}
