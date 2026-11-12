// The rooks' eyes follow the pointer, or the keyboard focus. One passive listener, one frame per
// burst of events, and only for rooks in view. Touch screens and reduced motion keep them still.
const MAX_X = 3.2;
const MAX_Y = 2.6;
const REACH = 200;

if (
  window.matchMedia("(hover: hover) and (pointer: fine)").matches &&
  !window.matchMedia("(prefers-reduced-motion: reduce)").matches
) {
  let target: { x: number; y: number } | null = null;
  let frame = 0;

  const flush = () => {
    frame = 0;
    const rooks = [...document.querySelectorAll<SVGElement>(".rook[data-gaze]")];
    const rects = rooks.map((rook) => rook.getBoundingClientRect());
    rooks.forEach((rook, i) => {
      const rect = rects[i]!;
      if (rect.bottom < 0 || rect.top > innerHeight) return;
      let x = 0;
      let y = 0;
      if (target) {
        const dx = target.x - (rect.left + rect.width / 2);
        const dy = target.y - (rect.top + rect.height / 2);
        const dist = Math.hypot(dx, dy) || 1;
        const pull = Math.min(1, dist / REACH);
        x = (dx / dist) * pull * MAX_X;
        y = (dy / dist) * pull * MAX_Y;
      }
      rook.style.setProperty("--gaze-x", `${x.toFixed(2)}px`);
      rook.style.setProperty("--gaze-y", `${y.toFixed(2)}px`);
    });
  };

  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(flush);
  };

  addEventListener(
    "pointermove",
    (event) => {
      target = { x: event.clientX, y: event.clientY };
      schedule();
    },
    { passive: true },
  );
  addEventListener("scroll", schedule, { passive: true });
  document.documentElement.addEventListener("pointerleave", () => {
    target = null;
    schedule();
  });
  // Tabbing to a link or button turns the rooks toward it.
  document.addEventListener("focusin", (event) => {
    const el = event.target as HTMLElement;
    if (!el.matches?.(":focus-visible")) return;
    const rect = el.getBoundingClientRect();
    target = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    schedule();
  });
}

// A tap or click makes a rook smile for a moment, where there is no hover to do it.
document.addEventListener("click", (event) => {
  const rook = (event.target as Element).closest?.(".rook[data-react]");
  if (!rook) return;
  rook.setAttribute("data-happy", "");
  setTimeout(() => rook.removeAttribute("data-happy"), 1400);
});
