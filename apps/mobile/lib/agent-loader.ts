/** How the mobile loader moves: the rook breathes while it thinks and works faster once the wait runs long. */
export function agentLoaderMotion(working: boolean): { periodMs: number; scale: number } {
  return working ? { periodMs: 520, scale: 1.1 } : { periodMs: 1_100, scale: 1.05 };
}
