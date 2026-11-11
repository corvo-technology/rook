/**
 * Several proposal cards can come from one reply. They are shown one at a time: answered ones stay
 * as compact answered cards, the first pending one carries the buttons, and later ones wait.
 */
export function proposalSteps(
  blocks: readonly { kind: string; proposal?: true; status?: string }[],
): {
  /** Positions of the proposal ask blocks, in order. */
  indexes: number[];
  /** The first proposal not yet answered, or null when all are. */
  current: number | null;
  /** 1-based place of `current` among the proposals; the total when none is pending. */
  position: number;
  total: number;
} {
  const indexes = blocks.flatMap((block, i) => (block.kind === "ask" && block.proposal ? [i] : []));
  const current = indexes.find((i) => blocks[i]?.status !== "answered") ?? null;
  return {
    indexes,
    current,
    position: current === null ? indexes.length : indexes.indexOf(current) + 1,
    total: indexes.length,
  };
}
