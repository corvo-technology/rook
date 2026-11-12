// @vitest-environment jsdom
import { ROOK_ASLEEP_COLOR, ROOK_EYE_COLOR } from "@corvo/core";
import { avatarFrame, validateAvatar } from "open-bot-avatar";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dom = vi.hoisted(() => {
  const handles: { update: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }[] = [];
  const mountAvatar = vi.fn(() => {
    const handle = { update: vi.fn(), destroy: vi.fn() };
    handles.push(handle);
    return handle;
  });
  return { mountAvatar, handles };
});
vi.mock("open-bot-avatar/dom", () => ({ mountAvatar: dom.mountAvatar }));

import { LIVELY_FROM } from "./character-avatar.js";
import { ROOK_AVATAR, RookAvatar, rookGaze } from "./rook-avatar.js";

beforeEach(() => {
  dom.mountAvatar.mockClear();
  dom.handles.length = 0;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(() => vi.unstubAllGlobals());

async function render(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  return { host, root };
}

const lastOptions = () => (dom.mountAvatar.mock.calls.at(-1) as unknown as [HTMLElement, never])[1];

describe("the rook's definition", () => {
  it("is a valid Open Bot Avatar", () => {
    const result = validateAvatar(ROOK_AVATAR);
    expect(result.ok).toBe(true);
  });

  it("gives its drawn eyes room: well clear of the sides, the notches and the base", () => {
    // The engine draws eyes up to 1.45 times their contract size, and a happy arc about twice as
    // wide as a pill (5.9 units each side of an eye at scale 1). Its strict check asks for 4.5 units
    // of clearance; the solid block spans x 14..86 and y 28..88, its base curving away only past x 32 and 68,
    // which the eyes barely reach, so 87 is the floor under them.
    const { x, y, spacing, scale } = ROOK_AVATAR.eyes;
    const halfWidth = spacing / 2 + 5.9 * scale;
    const halfHeight = (11 / 2) * scale * 1.45;
    expect(x - halfWidth - 14).toBeGreaterThanOrEqual(4.5);
    expect(86 - (x + halfWidth)).toBeGreaterThanOrEqual(4.5);
    expect(y - halfHeight - 28).toBeGreaterThanOrEqual(4.5);
    expect(87 - (y + halfHeight)).toBeGreaterThanOrEqual(4.5);
  });

  it("draws two eyes at rest and when it looks up, down or to a side", () => {
    for (const gaze of [
      undefined,
      { x: 0, y: -1 },
      { x: 0, y: 1 },
      { x: 1, y: 0 },
      { x: -1, y: 0 },
    ]) {
      const frame = avatarFrame(ROOK_AVATAR, { gaze, reducedMotion: true });
      expect(frame.shapes.filter((shape) => shape.kind === "eye")).toHaveLength(2);
    }
  });
});

describe("rookGaze", () => {
  it("looks up when it waits, down when it failed or sleeps, and ahead otherwise", () => {
    expect(rookGaze("alert")?.y).toBeLessThan(0);
    expect(rookGaze("failed")?.y).toBeGreaterThan(0);
    expect(rookGaze("asleep")?.y).toBeGreaterThan(0);
    for (const mood of ["idle", "thinking", "happy"] as const)
      expect(rookGaze(mood)).toBeUndefined();
  });
});

describe("RookAvatar", () => {
  it("is one still SVG at a small size, with nothing mounted", () => {
    const html = renderToString(<RookAvatar color="#75aef5" mood="idle" size={LIVELY_FROM - 1} />);
    expect(html).toContain("<svg");
    expect(html).toContain("#75aef5");
    expect(html).toContain(ROOK_EYE_COLOR);
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('role="img"');
    expect(dom.mountAvatar).not.toHaveBeenCalled();
  });

  it("shares one drawing between rooks that look the same", () => {
    const draw = () => renderToString(<RookAvatar color="#54c398" mood="thinking" size={32} />);
    expect(draw()).toBe(draw());
    expect(draw()).not.toBe(renderToString(<RookAvatar color="#54c398" mood="idle" size={32} />));
  });

  it("is mounted alive from the lively size, in its color and looking at the pointer", async () => {
    const { root } = await render(<RookAvatar color="#75aef5" mood="idle" size={LIVELY_FROM} />);
    expect(dom.mountAvatar).toHaveBeenCalledTimes(1);
    expect(lastOptions()).toMatchObject({
      definition: ROOK_AVATAR,
      color: "#75aef5",
      eyeColor: ROOK_EYE_COLOR,
      mood: "idle",
      still: false,
      followPointer: true,
      lookAt: null,
    });
    await act(async () => root.unmount());
    expect(dom.handles[0]?.destroy).toHaveBeenCalledTimes(1);
  });

  it("maps the moods to the engine's and looks up when it waits", async () => {
    const at = (mood: "idle" | "thinking" | "happy" | "alert" | "failed") => (
      <RookAvatar color="#75aef5" mood={mood} size={80} />
    );
    const { root } = await render(at("thinking"));
    expect(lastOptions()).toMatchObject({ mood: "thinking" });
    await act(async () => root.render(at("happy")));
    expect(dom.handles[0]?.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ mood: "happy" }),
    );
    await act(async () => root.render(at("alert")));
    expect(dom.handles[0]?.update).toHaveBeenCalledWith(expect.objectContaining({ mood: "idle" }));
    expect(dom.handles[0]?.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ lookAt: { x: 0, y: -1 } }),
    );
    expect(dom.mountAvatar).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });

  it("is alive at a small size when its place asks, and looks where it is told", async () => {
    const { root } = await render(
      <RookAvatar color="#75aef5" mood="idle" size={36} live lookAt={{ x: 0, y: 0.9 }} />,
    );
    expect(dom.mountAvatar).toHaveBeenCalledTimes(1);
    expect(lastOptions()).toMatchObject({ still: false, lookAt: { x: 0, y: 0.9 } });
    await act(async () => root.unmount());
  });

  it("is gray and still when it sleeps, even at a large size", async () => {
    const { host, root } = await render(<RookAvatar color="#75aef5" mood="asleep" size={120} />);
    expect(dom.mountAvatar).not.toHaveBeenCalled();
    expect(host.innerHTML).toContain(ROOK_ASLEEP_COLOR);
    expect(host.innerHTML).not.toContain("#75aef5");
    await act(async () => root.unmount());
  });
});
