/**
 * Work that outlives the request handler that started it. A stream's response can end (drain,
 * client hang-up) while its generator is still awaiting a session check; the handler's promise
 * is settled by then, so graceful shutdown cannot see it. Route such work through `run` and
 * `close` waits for it before the DB pools end; work started after `close` is refused.
 */
export function createInFlight() {
  const running = new Set<Promise<unknown>>();
  let closed = false;
  return {
    run<T>(work: () => Promise<T>): Promise<T> {
      if (closed) return Promise.reject(new Error("Server is shutting down"));
      const started = work();
      const settled = started.then(
        () => undefined,
        () => undefined,
      );
      running.add(settled);
      void settled.then(() => running.delete(settled));
      return started;
    },
    async close(timeoutMs = 5_000): Promise<void> {
      closed = true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        Promise.all(running),
        new Promise((resolve) => {
          timer = setTimeout(resolve, timeoutMs);
        }),
      ]);
      clearTimeout(timer);
    },
  };
}
