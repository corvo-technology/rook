// One rook travels the page. Every `[data-guide-stop]` is a place it rests; scrolling carries it from
// one to the next. Positions are read once per resize and the rook only moves by transform, so the
// layout never shifts. Frames run only while something is moving. Without this script, or with
// reduced motion, each stop keeps its own still rook.
const root = document.querySelector<HTMLElement>("[data-guide]");
const calm = !matchMedia("(prefers-reduced-motion: reduce)").matches;

type Stop = { x: number; y: number; w: number; clip: number };

if (root && calm) {
  const html = document.documentElement;
  const rook = root.querySelector<SVGElement>(".rook")!;
  const BOX = 100;
  const LEG_MIN = 260;
  const HOLD = 0.55;
  const REACH = 320;
  const MAX_X = 3.2;
  const MAX_Y = 2.6;

  let stops: Stop[] = [];
  let keys: number[] = [];
  let cur: { x: number; y: number; w: number; clip: number } | null = null;
  let squash = 0;
  let squashSpeed = 0;
  let lastSpeed = 0;
  let lastTime = 0;
  let prevView = { x: 0, y: 0 };
  let pointer: { x: number; y: number } | null = null;
  let link: { x: number; y: number } | null = null;
  let look = { x: 0, y: 0 };
  let frame = 0;
  const fine = matchMedia("(hover: hover) and (pointer: fine)").matches;

  const docPoint = (el: HTMLElement) => {
    let x = 0;
    let y = 0;
    for (let node: HTMLElement | null = el; node; node = node.offsetParent as HTMLElement | null) {
      x += node.offsetLeft;
      y += node.offsetTop;
    }
    return { x, y };
  };

  const measure = () => {
    const slots = [...document.querySelectorAll<HTMLElement>("[data-guide-stop]")].filter((el) => el.offsetParent !== null);
    stops = slots.map((el) => {
      const at = docPoint(el);
      return { x: at.x + el.offsetWidth / 2, y: at.y + el.offsetHeight, w: el.offsetWidth, clip: Number(el.dataset.guideClip ?? 0) };
    });
    // The scroll position at which the rook rests at each stop: when the stop is near the middle of the screen.
    const max = Math.max(0, document.documentElement.scrollHeight - innerHeight);
    keys = stops.map((stop) => stop.y - stop.w / 2 - innerHeight * HOLD);
    keys[0] = 0;
    for (let i = 1; i < keys.length; i++) keys[i] = Math.max(keys[i]!, keys[i - 1]! + LEG_MIN);
    const last = keys.length - 1;
    keys[last] = Math.min(keys[last]!, max);
    for (let i = last - 1; i >= 1; i--) keys[i] = Math.min(keys[i]!, keys[i + 1]! - 60);
    schedule();
  };

  const target = () => {
    const s = scrollY;
    const last = stops.length - 1;
    let i = 0;
    while (i < last && s >= keys[i + 1]!) i++;
    if (i >= last) return { ...stops[last]!, t: 1, leg: last, from: stops[last]!, to: stops[last]! };
    const from = stops[i]!;
    const to = stops[i + 1]!;
    const raw = Math.min(1, Math.max(0, (s - keys[i]!) / (keys[i + 1]! - keys[i]!)));
    const t = raw * raw * (3 - 2 * raw);
    const mix = (a: number, b: number) => a + (b - a) * t;
    return { x: mix(from.x, to.x), y: mix(from.y, to.y), w: mix(from.w, to.w), clip: mix(from.clip, to.clip), t: raw, leg: i, from, to };
  };

  const tick = (now: number) => {
    frame = 0;
    if (!stops.length) return;
    const dt = Math.min(64, lastTime ? now - lastTime : 16);
    lastTime = now;
    const goal = target();
    const first = !cur;
    if (!cur) cur = { x: goal.x, y: goal.y, w: goal.w, clip: goal.clip };
    const k = first ? 1 : 1 - Math.exp(-dt / 70);
    const before = { x: cur.x, y: cur.y };
    cur.x += (goal.x - cur.x) * k;
    cur.y += (goal.y - cur.y) * k;
    cur.w += (goal.w - cur.w) * k;
    cur.clip += (goal.clip - cur.clip) * k;
    const gap = Math.hypot(goal.x - cur.x, goal.y - cur.y) + Math.abs(goal.w - cur.w);
    if (gap < 0.2) {
      cur.x = goal.x;
      cur.y = goal.y;
      cur.w = goal.w;
      cur.clip = goal.clip;
    }

    // A little squash when it stops: the slowing down is pushed into a spring.
    const speed = Math.hypot(cur.x - before.x, cur.y - before.y) / dt;
    squashSpeed += Math.max(0, lastSpeed - speed) * 0.5;
    lastSpeed = speed;
    squashSpeed += (-squash * 0.06 - squashSpeed * 0.18) * (dt / 16);
    squash = Math.min(0.14, Math.max(-0.08, squash + squashSpeed * (dt / 16)));

    const scale = cur.w / BOX;
    root.style.transform = `translate3d(${(cur.x - BOX / 2).toFixed(2)}px, ${(cur.y - BOX).toFixed(2)}px, 0) scale(${(scale * (1 + squash * 0.6)).toFixed(4)}, ${(scale * (1 - squash)).toFixed(4)})`;
    root.style.clipPath = cur.clip > 0.002 ? `inset(0 -30% ${(cur.clip * 100).toFixed(2)}% -30%)` : "";
    if (!html.hasAttribute("data-guided")) html.setAttribute("data-guided", "");

    // Eyes: a hovered link, else the way it is travelling, else a pointer close by.
    const view = { x: cur.x, y: cur.y - cur.w / 2 - scrollY };
    const move = { x: view.x - prevView.x, y: view.y - prevView.y };
    prevView = view;
    const moving = Math.hypot(move.x, move.y) > 0.6;
    let want = { x: 0, y: 0 };
    const aim = (to: { x: number; y: number }, reach: number) => {
      const dx = to.x - view.x;
      const dy = to.y - view.y;
      const dist = Math.hypot(dx, dy) || 1;
      const pull = Math.min(1, dist / reach);
      return { x: (dx / dist) * pull * MAX_X, y: (dy / dist) * pull * MAX_Y };
    };
    if (link) want = aim(link, 1);
    else if (moving) {
      const len = Math.hypot(move.x, move.y);
      want = { x: (move.x / len) * MAX_X, y: (move.y / len) * MAX_Y };
    } else if (pointer && Math.hypot(pointer.x - view.x, pointer.y - view.y) < REACH) want = aim(pointer, 200);
    if (Math.abs(want.x - look.x) > 0.05 || Math.abs(want.y - look.y) > 0.05) {
      look = want;
      rook.style.setProperty("--gaze-x", `${look.x.toFixed(2)}px`);
      rook.style.setProperty("--gaze-y", `${look.y.toFixed(2)}px`);
    }

    // At the last stop it smiles and says its piece.
    const end = goal.leg >= stops.length - 1 || (goal.leg === stops.length - 2 && goal.t > 0.96);
    rook.toggleAttribute("data-happy", end);
    html.toggleAttribute("data-guide-end", end && gap < 4);

    const busy = gap >= 0.2 || Math.abs(squash) > 0.003 || Math.abs(squashSpeed) > 0.003 || moving;
    if (busy) schedule();
    else {
      lastTime = 0;
      lastSpeed = 0;
    }
  };

  function schedule() {
    if (!frame && !document.hidden) frame = requestAnimationFrame(tick);
  }

  addEventListener("scroll", schedule, { passive: true });
  if (fine) {
    addEventListener(
      "pointermove",
      (event) => {
        pointer = { x: event.clientX, y: event.clientY };
        const a = (event.target as Element).closest?.(".site-header a");
        const rect = a?.getBoundingClientRect();
        link = rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
        schedule();
      },
      { passive: true },
    );
    document.documentElement.addEventListener("pointerleave", () => {
      pointer = null;
      link = null;
      schedule();
    });
  }
  new ResizeObserver(measure).observe(document.body);
  document.fonts?.ready.then(measure);
  measure();
}
