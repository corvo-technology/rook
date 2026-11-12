// One rook travels the page, drawn by the same engine as the app's rooks. Every `[data-guide-stop]` is
// a place it rests, always in empty space reserved for it. The stop that is active follows the scroll
// (with hysteresis, so it never flickers), and when it changes the rook goes there on a time-based
// spring, never in step with the scroll, so wherever the page stops scrolling it is exactly at a stop.
// A hop between two rows of the same column leaves through the side margin; any other hop fades out
// and in instead of crossing the page. A `[data-guide-gone]` mark is a place it is not: it fades out
// there (the closing band has its own rook). Without this script, or with reduced motion, each stop
// keeps its own still rook.
import { ROOK_AVATAR, CHESS_PIECES } from "@corvo/core/chess-set";
import type { AvatarDefinition } from "open-bot-avatar";
import type { MountedAvatar } from "open-bot-avatar/dom";
import { mountAvatar } from "open-bot-avatar/dom";

const root = document.querySelector<HTMLElement>("[data-guide]");
const calm = !matchMedia("(prefers-reduced-motion: reduce)").matches;

type Point = { x: number; y: number };
// `y` is where it rests; `at` is the scroll line that makes the stop active.
type Stop = Point & { at: number; row: boolean; gone: boolean };
type Mate = { host: HTMLElement; avatar: MountedAvatar; at: Point; look: Point | null };

if (root && calm) {
  const html = document.documentElement;
  const host = root.querySelector<HTMLElement>("[data-avatar]")!;
  const BOX = root.offsetWidth;
  const OMEGA = 9; // spring stiffness: settles in about half a second
  const FADE_OUT = 160;
  const FADE_IN = 260;
  const ENTER = 0.62; // the next stop takes over when it rises above this share of the screen
  const LEAVE = 0.88; // and gives back only when it has sunk below this one
  const REACH = 320;
  const LANE = BOX + 12; // a side margin this wide lets it travel there

  const avatarOf = (el: HTMLElement, definition: AvatarDefinition, followPointer: boolean) => {
    const color = el.dataset.color;
    const eyeColor = el.dataset.eye;
    el.textContent = "";
    return mountAvatar(el, { definition, color, eyeColor, followPointer, label: "" });
  };

  const guide = avatarOf(host, ROOK_AVATAR, false);
  const mates: Mate[] = [...document.querySelectorAll<HTMLElement>("[data-mate]")].map((el) => {
    const piece = el.dataset.avatar as keyof typeof CHESS_PIECES | "rook";
    return { host: el, avatar: avatarOf(el, piece === "rook" ? ROOK_AVATAR : CHESS_PIECES[piece], true), at: { x: 0, y: 0 }, look: null };
  });

  let stops: Stop[] = [];
  let lane = 0; // x of the margin's middle, or 0 where the margin is too narrow
  let active = 0;
  let cur: Point | null = null;
  let opacity = 0;
  let wantVisible = true;
  let path: { pts: Point[]; len: number[] } | null = null;
  let p = 1;
  let v = 0;
  let fade: { t0: number; to: Point; moved: boolean } | null = null;
  let lastTime = 0;
  let frame = 0;
  let gazeFrame = 0;
  let pointer: Point | null = null;
  let link: Point | null = null;
  let look: Point | null = null;

  const centerOf = (el: HTMLElement): Point => {
    const r = el.getBoundingClientRect();
    return { x: r.left + scrollX + r.width / 2, y: r.top + scrollY + r.height / 2 };
  };

  const measure = () => {
    const slots = [...document.querySelectorAll<HTMLElement>("[data-guide-stop], [data-guide-gone]")].filter((el) => el.offsetParent !== null);
    stops = slots.map((el) => {
      const gone = "guideGone" in el.dataset;
      const c = centerOf(el);
      return { ...c, at: gone ? el.getBoundingClientRect().top + scrollY : c.y, row: "guideRow" in el.dataset, gone };
    });
    // A place it is not rests where it was, so it fades out without moving.
    stops.forEach((stop, i) => {
      if (stop.gone && i > 0) {
        stop.x = stops[i - 1]!.x;
        stop.y = stops[i - 1]!.y;
      }
    });
    const left = document.querySelector<HTMLElement>(".container")?.getBoundingClientRect().left ?? 0;
    lane = left >= LANE + 4 ? left / 2 : 0;
    for (const mate of mates) mate.at = centerOf(mate.host);
    if (!stops.length) return;
    active = Math.min(active, stops.length - 1);
    pick(true);
    if (cur && !path && !fade) {
      cur = { x: stops[active]!.x, y: stops[active]!.y };
      draw();
    }
    schedule();
  };

  // Which stop is active: the last one that has risen to the reading line; it keeps its place until
  // the next has, and gives it back only well after, so the rook never hops back and forth.
  const pick = (quiet = false) => {
    if (!stops.length) return;
    const edge = innerHeight;
    const atEnd = scrollY >= document.documentElement.scrollHeight - innerHeight - 2;
    let next = active;
    while (next < stops.length - 1 && (stops[next + 1]!.at - scrollY < edge * ENTER || atEnd)) next++;
    while (next > 0 && stops[next]!.at - scrollY > edge * LEAVE) next--;
    if (next === active && cur) return;
    const first = !cur;
    const from = stops[active]!;
    active = next;
    const to = stops[active]!;
    html.toggleAttribute("data-guide-end", to.gone);
    wantVisible = !to.gone;
    if (first) {
      cur = { x: to.x, y: to.y };
      opacity = wantVisible ? 1 : 0;
      draw();
      return;
    }
    if (quiet) return;
    go(from, to);
  };

  const go = (from: Stop, to: Stop) => {
    if (!cur) return;
    const there = { x: to.x, y: to.y };
    if (to.gone || from.gone || !(from.row && to.row && lane)) {
      // Cross the page? No: fade out here and in there.
      path = null;
      fade = { t0: 0, to: there, moved: false };
      schedule();
      return;
    }
    // Along the empty row out to the margin, down the margin, then along the next row in.
    const pts = [{ ...cur }, { x: lane, y: cur.y }, { x: lane, y: there.y }, there];
    const len = [0];
    for (let i = 1; i < pts.length; i++) len.push(len[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y));
    const total = len[len.length - 1]! || 1;
    const old = path ? path.len[path.len.length - 1]! : total;
    v = path ? (v * old) / total : 0;
    path = { pts, len };
    p = 0;
    fade = null;
    schedule();
  };

  const along = (): Point => {
    const { pts, len } = path!;
    const s = Math.min(1, Math.max(0, p)) * len[len.length - 1]!;
    let i = 1;
    while (i < len.length - 1 && s > len[i]!) i++;
    const span = len[i]! - len[i - 1]! || 1;
    const t = (s - len[i - 1]!) / span;
    return { x: pts[i - 1]!.x + (pts[i]!.x - pts[i - 1]!.x) * t, y: pts[i - 1]!.y + (pts[i]!.y - pts[i - 1]!.y) * t };
  };

  const draw = () => {
    if (!cur) return;
    root.style.transform = `translate3d(${(cur.x - BOX / 2).toFixed(2)}px, ${(cur.y - BOX / 2).toFixed(2)}px, 0)`;
    root.style.opacity = opacity.toFixed(3);
    if (!html.hasAttribute("data-guided")) html.setAttribute("data-guided", "");
  };

  const tick = (now: number) => {
    frame = 0;
    if (!cur || !stops.length) return;
    const dt = Math.min(1 / 30, lastTime ? (now - lastTime) / 1000 : 1 / 60);
    lastTime = now;
    let busy = false;
    const before = { ...cur };

    if (fade) {
      if (!fade.t0) fade.t0 = now;
      const u = now - fade.t0;
      if (u < FADE_OUT) opacity = 1 - u / FADE_OUT;
      else {
        if (!fade.moved) {
          cur = { ...fade.to };
          fade.moved = true;
        }
        opacity = wantVisible ? Math.min(1, (u - FADE_OUT) / FADE_IN) : 0;
      }
      if (u >= FADE_OUT + (wantVisible ? FADE_IN : 0)) {
        opacity = wantVisible ? 1 : 0;
        fade = null;
      } else busy = true;
    } else if (path) {
      // Critically damped spring on the way along the path.
      const a = OMEGA * OMEGA * (1 - p) - 2 * OMEGA * v;
      v += a * dt;
      p += v * dt;
      cur = along();
      if (Math.abs(1 - p) < 0.0008 && Math.abs(v) < 0.01) {
        cur = { x: stops[active]!.x, y: stops[active]!.y };
        path = null;
        p = 1;
        v = 0;
      } else busy = true;
    }
    draw();
    const moved = { x: cur.x - before.x, y: cur.y - before.y };
    steer(Math.hypot(moved.x, moved.y) > 0.4 ? moved : null);
    nudgeMates();
    if (busy) schedule();
    else lastTime = 0;
  };

  // Eyes: a hovered link, else the way it is travelling, else a pointer close by; otherwise the engine's own idle gaze.
  const steer = (travel: Point | null) => {
    if (!cur) return;
    const at = { x: cur.x, y: cur.y - scrollY };
    const aim = (to: Point, reach: number) => {
      const dx = to.x - at.x;
      const dy = to.y - at.y;
      const dist = Math.hypot(dx, dy) || 1;
      const pull = Math.min(1, dist / reach);
      return { x: (dx / dist) * pull, y: (dy / dist) * pull };
    };
    let want: Point | null = null;
    if (link) want = aim(link, 1);
    else if (travel) {
      const n = Math.hypot(travel.x, travel.y);
      want = { x: travel.x / n, y: travel.y / n };
    } else if (pointer && Math.hypot(pointer.x - at.x, pointer.y - at.y) < REACH) want = aim(pointer, 200);
    if ((want === null) !== (look === null) || (want && look && (Math.abs(want.x - look.x) > 0.04 || Math.abs(want.y - look.y) > 0.04))) {
      look = want;
      guide.update({ lookAt: want });
    }
  };

  // The pieces watch the rook once it has settled beside them.
  const nudgeMates = () => {
    const settled = !path && !fade && opacity > 0.9 && cur;
    for (const mate of mates) {
      let want: Point | null = null;
      if (settled && cur) {
        const dx = cur.x - mate.at.x;
        const dy = cur.y - mate.at.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 520) want = { x: dx / (dist || 1), y: dy / (dist || 1) };
      }
      const same = want && mate.look ? Math.abs(want.x - mate.look.x) < 0.04 && Math.abs(want.y - mate.look.y) < 0.04 : want === mate.look;
      if (!same) {
        mate.look = want;
        mate.avatar.update({ lookAt: want });
      }
    }
  };

  function schedule() {
    if (!frame && !document.hidden) frame = requestAnimationFrame(tick);
  }

  const onScroll = () => {
    const was = active;
    pick();
    if (active === was) steer(null);
  };

  addEventListener("scroll", onScroll, { passive: true });
  if (matchMedia("(hover: hover) and (pointer: fine)").matches) {
    addEventListener(
      "pointermove",
      (event) => {
        pointer = { x: event.clientX, y: event.clientY };
        const a = (event.target as Element).closest?.(".site-header a");
        const rect = a?.getBoundingClientRect();
        link = rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
        if (!gazeFrame)
          gazeFrame = requestAnimationFrame(() => {
            gazeFrame = 0;
            steer(null);
          });
      },
      { passive: true },
    );
    document.documentElement.addEventListener("pointerleave", () => {
      pointer = null;
      link = null;
      steer(null);
    });
  }
  new ResizeObserver(measure).observe(document.body);
  document.fonts?.ready.then(measure);
  measure();
}
