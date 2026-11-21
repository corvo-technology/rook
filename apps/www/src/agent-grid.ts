import { CHESS_PIECES, ROOK_AVATAR } from "@corvo/core/chess-set";
import { ROOK_EYE_COLOR } from "@corvo/core";
import type { MountedAvatar, mountAvatar } from "open-bot-avatar/dom";

// The row is still pictures from the server. While it is on screen one agent at a time wakes up,
// celebrates and goes back to its picture; then the next one. Pointing at an agent (or tapping it)
// wakes that one at once: it hops, shows a happy celebrating face and its caption lights up; when the
// pointer leaves it settles back into its picture. With reduced motion the pictures stay.
const GAP_MS = 700;
const AMBIENT_MS = 3200;
const TAP_MS = 2200;
const SETTLE_MS = 450;

const row = document.querySelector<HTMLElement>("[data-agent-row]");
const calm = !matchMedia("(prefers-reduced-motion: reduce)").matches;

if (row && calm && "IntersectionObserver" in window) {
  const items = [...row.querySelectorAll<HTMLElement>(".agent-row__item")];
  const stills = new Map(items.map((item) => [item, item.querySelector<HTMLElement>("[data-piece]")!.innerHTML]));
  const avatarOf = (item: HTMLElement) => item.querySelector<HTMLElement>("[data-piece]")!;

  let timer: number | undefined;
  let settleTimer: number | undefined;
  let live: { item: HTMLElement; avatar: MountedAvatar } | undefined;
  let hovered: HTMLElement | undefined;
  let visible = false;
  let turn = 0;
  let token = 0;
  let loading: Promise<{ mountAvatar: typeof mountAvatar }> | undefined;
  const load = () => (loading ??= import("open-bot-avatar/dom"));

  const mount = async (item: HTMLElement) => {
    const { mountAvatar } = await load();
    const el = avatarOf(item);
    const piece = el.dataset.piece as keyof typeof CHESS_PIECES | "rook";
    el.textContent = "";
    return mountAvatar(el, {
      definition: piece === "rook" ? ROOK_AVATAR : CHESS_PIECES[piece],
      color: el.dataset.color,
      eyeColor: ROOK_EYE_COLOR,
      state: "done",
      mood: "happy",
      followPointer: false,
      label: "",
    });
  };

  const rest = () => {
    clearTimeout(settleTimer);
    if (!live) return;
    live.avatar.destroy();
    avatarOf(live.item).innerHTML = stills.get(live.item) ?? "";
    live.item.removeAttribute("data-awake");
    live = undefined;
  };

  const ambient = () => {
    clearTimeout(timer);
    if (!visible || hovered || live) return;
    const item = items[turn % items.length]!;
    const mine = ++token;
    void mount(item).then((avatar) => {
      if (mine !== token || hovered || !visible) {
        avatar.destroy();
        avatarOf(item).innerHTML = stills.get(item) ?? "";
        return;
      }
      live = { item, avatar };
      timer = window.setTimeout(() => {
        rest();
        turn += 1;
        timer = window.setTimeout(ambient, GAP_MS);
      }, AMBIENT_MS);
    });
  };

  // Settle: the face calms down, then the picture comes back.
  const settle = (item: HTMLElement) => {
    if (hovered === item) hovered = undefined;
    if (live?.item !== item) return;
    item.removeAttribute("data-awake");
    live.avatar.update({ state: "idle", mood: "neutral" });
    clearTimeout(settleTimer);
    settleTimer = window.setTimeout(() => {
      rest();
      timer = window.setTimeout(ambient, GAP_MS);
    }, SETTLE_MS);
  };

  const wake = async (item: HTMLElement, hold: boolean) => {
    clearTimeout(timer);
    clearTimeout(settleTimer);
    if (hovered && hovered !== item) settle(hovered);
    hovered = item;
    const mine = ++token;
    if (live?.item === item) {
      // Already awake (the ambient turn): restart the hop and keep it happy.
      live.avatar.update({ state: "done", mood: "happy" });
    } else {
      rest();
      const avatar = await mount(item);
      if (mine !== token || hovered !== item) {
        avatar.destroy();
        avatarOf(item).innerHTML = stills.get(item) ?? "";
        return;
      }
      live = { item, avatar };
    }
    item.removeAttribute("data-awake");
    void item.offsetWidth; // restart the hop
    item.setAttribute("data-awake", "");
    if (!hold) {
      // A tap has no leave: it plays once.
      timer = window.setTimeout(() => settle(item), TAP_MS);
    }
  };

  for (const item of items) {
    item.addEventListener("pointerenter", (event) => {
      if (event.pointerType === "touch") return;
      void wake(item, true);
    });
    item.addEventListener("pointerleave", (event) => {
      if (event.pointerType === "touch") return;
      settle(item);
    });
    item.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "touch") void wake(item, false);
    });
  }
  // Warm the avatar engine the first time a pointer comes near the row.
  row.addEventListener("pointerenter", () => void load(), { once: true });

  new IntersectionObserver(
    ([entry]) => {
      visible = !!entry?.isIntersecting;
      if (visible) {
        if (!hovered) ambient();
      } else if (!hovered) {
        token++;
        clearTimeout(timer);
        rest();
      }
    },
    { rootMargin: "80px" },
  ).observe(row);
}
