import { CHESS_PIECES, ROOK_AVATAR } from "@corvo/core/chess-set";
import { ROOK_EYE_COLOR } from "@corvo/core";
import type { AvatarState } from "open-bot-avatar";
import type { MountedAvatar } from "open-bot-avatar/dom";

// The row is still pictures from the server. While it is on screen one agent at a time wakes up,
// celebrates and goes back to its picture; then the next one. With reduced motion the
// pictures stay.
const SEQUENCE: { state: AvatarState; ms: number }[] = [
  { state: "done", ms: 3200 },
];
const GAP_MS = 700;

const row = document.querySelector<HTMLElement>("[data-agent-row]");
const calm = !matchMedia("(prefers-reduced-motion: reduce)").matches;

if (row && calm && "IntersectionObserver" in window) {
  const avatars = [...row.querySelectorAll<HTMLElement>("[data-piece]")];
  const stills = new Map(avatars.map((el) => [el, el.innerHTML]));
  let timer: number | undefined;
  let live: { el: HTMLElement; avatar: MountedAvatar } | undefined;
  let turn = 0;

  const rest = () => {
    if (!live) return;
    live.avatar.destroy();
    live.el.innerHTML = stills.get(live.el) ?? "";
    live = undefined;
  };

  const wait = (ms: number, next: () => void) => {
    timer = window.setTimeout(next, ms);
  };

  const play = async (step: number) => {
    const el = avatars[turn % avatars.length];
    if (!el) return;
    const { mountAvatar } = await import("open-bot-avatar/dom");
    const { state, ms } = SEQUENCE[step] ?? SEQUENCE[0]!;
    if (!live) {
      const piece = el.dataset.piece as keyof typeof CHESS_PIECES | "rook";
      el.textContent = "";
      live = {
        el,
        avatar: mountAvatar(el, {
          definition: piece === "rook" ? ROOK_AVATAR : CHESS_PIECES[piece],
          color: el.dataset.color,
          eyeColor: ROOK_EYE_COLOR,
          state,
          mood: "happy",
          followPointer: false,
          label: "",
        }),
      };
    } else {
      live.avatar.update({ state });
    }
    wait(ms, () => {
      if (step + 1 < SEQUENCE.length) return void play(step + 1);
      rest();
      turn += 1;
      wait(GAP_MS, () => void play(0));
    });
  };

  new IntersectionObserver(
    ([entry]) => {
      clearTimeout(timer);
      if (entry?.isIntersecting) void play(0);
      else rest();
    },
    { rootMargin: "80px" },
  ).observe(row);
}
