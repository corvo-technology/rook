/**
 * Tells open streams the moment someone stops belonging to a space, so a removed member's
 * realtime subscriptions close at once instead of at the next periodic re-check. The re-check
 * stays as the fallback for a removal made by another API process.
 */
class AccessRevocations {
  private readonly waiting = new Map<string, Set<() => void>>();

  /** Resolves when `userId` loses `spaceId`; never resolves if the signal aborts first. */
  watch(spaceId: string, userId: string, signal?: AbortSignal): Promise<void> {
    const key = `${spaceId}:${userId}`;
    return new Promise((resolve) => {
      const waiters = this.waiting.get(key) ?? new Set();
      this.waiting.set(key, waiters);
      waiters.add(resolve);
      signal?.addEventListener(
        "abort",
        () => {
          waiters.delete(resolve);
          if (waiters.size === 0) this.waiting.delete(key);
        },
        { once: true },
      );
    });
  }

  revoke(spaceId: string, userId: string): void {
    const key = `${spaceId}:${userId}`;
    const waiters = this.waiting.get(key);
    this.waiting.delete(key);
    for (const resolve of waiters ?? []) resolve();
  }
}

export const accessRevocations = new AccessRevocations();
