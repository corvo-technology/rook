import { CHESS_PIECES, ROOK_AVATAR } from "@corvo/core/chess-set";
import type { AvatarState, AvatarMood } from "open-bot-avatar";
import type { MountedAvatar } from "open-bot-avatar/dom";

// The grid is still pictures from the server. While it is on screen each one becomes a live avatar,
// and when it leaves they go back to pictures, so nothing runs off screen. With reduced motion
// the pictures stay.
const grid = document.querySelector<HTMLElement>("[data-agent-grid]");
const calm = !matchMedia("(prefers-reduced-motion: reduce)").matches;

if (grid && calm && "IntersectionObserver" in window) {
  const cells = [...grid.querySelectorAll<HTMLElement>("[data-piece]")];
  const stills = new Map(cells.map((cell) => [cell, cell.innerHTML]));
  const live = new Map<HTMLElement, { avatar: MountedAvatar; timer: number }>();
  let mount: Promise<typeof import("open-bot-avatar/dom")> | undefined;

  // Each avatar starts on its own beat, so a state never runs in step across the grid: an avatar's
  // animation counts from the moment its state begins.
  const delay = (cell: HTMLElement, n: number) => ((n * 7919) % 17) * 140 + (cell.dataset.piece?.length ?? 0) * 23;

  const start = async () => {
    mount ??= import("open-bot-avatar/dom");
    const { mountAvatar } = await mount;
    cells.forEach((cell, n) => {
      if (live.has(cell)) return;
      const timer = window.setTimeout(() => {
        const piece = cell.dataset.piece as keyof typeof CHESS_PIECES | "rook";
        cell.textContent = "";
        const avatar = mountAvatar(cell, {
          definition: piece === "rook" ? ROOK_AVATAR : CHESS_PIECES[piece],
          color: cell.dataset.color,
          eyeColor: cell.dataset.eye,
          state: cell.dataset.state as AvatarState,
          mood: cell.dataset.mood as AvatarMood,
          followPointer: false,
          label: "",
        });
        live.set(cell, { avatar, timer });
      }, delay(cell, n));
      live.set(cell, { avatar: { update() {}, destroy() {} }, timer });
    });
  };

  const stop = () => {
    for (const [cell, { avatar, timer }] of live) {
      clearTimeout(timer);
      avatar.destroy();
      cell.innerHTML = stills.get(cell) ?? "";
    }
    live.clear();
  };

  new IntersectionObserver(
    ([entry]) => {
      if (entry?.isIntersecting) void start();
      else stop();
    },
    { rootMargin: "80px" },
  ).observe(grid);
}
