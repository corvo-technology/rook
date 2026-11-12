// @vitest-environment jsdom
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

import { BotAvatar, parseBotAvatar } from "./bot-avatar.js";
import { botCharacter } from "./bot-characters.js";

beforeEach(() => {
  vi.useFakeTimers();
  dom.mountAvatar.mockClear();
  dom.handles.length = 0;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(() => vi.useRealTimers());

async function mount(color: string, size: number, status?: string) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<BotAvatar color={color} size={size} status={status} />));
  return {
    host,
    rerender: (next: { color?: string; size?: number; status?: string }) =>
      act(async () =>
        root.render(
          <BotAvatar
            color={next.color ?? color}
            size={next.size ?? size}
            status={next.status ?? status}
          />,
        ),
      ),
    unmount: () => act(async () => root.unmount()),
  };
}

const lastOptions = () => (dom.mountAvatar.mock.calls.at(-1) as unknown as [HTMLElement, never])[1];

describe("parseBotAvatar with a character", () => {
  it("reads the color and the character, and ignores one that is not known", () => {
    expect(parseBotAvatar("#1FBF68::char_sprout")).toEqual({
      color: "#1FBF68",
      isImage: false,
      characterId: "sprout",
    });
    expect(parseBotAvatar("#1FBF68::char_nobody")).toEqual({ color: "#1FBF68", isImage: false });
    expect(parseBotAvatar("#1FBF68::shape_2")).toEqual({ color: "#1FBF68", isImage: false });
  });
});

describe("a character in an agent's color", () => {
  it("replaces the chick, keeping the sizes, the name and the working ring of any avatar", () => {
    const html = renderToString(
      <BotAvatar color="#1FBF68::char_sprout" size={40} status="running" />,
    );
    expect(html).toContain('data-character="sprout"');
    expect(html).toContain('data-working="true"');
    expect(html).toContain("corvo-bot-avatar-ring-working");
    expect(html).toMatch(/style="[^"]*width:40px;height:40px/);
    expect(html).not.toContain("data-mascot");
    expect(html).not.toContain("<img");
  });

  it("is hidden from assistive technology like the chick, since the agent's name is shown beside it", () => {
    const html = renderToString(<BotAvatar color="#1FBF68::char_sprout" size={40} />);
    expect(html).toContain('aria-hidden="true"');
  });

  it("draws it in the agent's color with eyes that show on it", async () => {
    const light = await mount("#FFEB3B::char_cat", 40);
    expect(lastOptions()).toMatchObject({ color: "#FFEB3B", eyeColor: "#141414" });
    await light.unmount();
    const dark = await mount("#1A237E::char_cat", 40);
    expect(lastOptions()).toMatchObject({ color: "#1A237E", eyeColor: "#FFFFFF" });
    await dark.unmount();
  });

  it("draws a small one still and a large one alive, following the pointer", async () => {
    const small = await mount("#1FBF68::char_sprout", 38);
    expect(lastOptions()).toMatchObject({ still: true, followPointer: false, label: "" });
    await small.unmount();
    const large = await mount("#1FBF68::char_sprout", 78);
    expect(lastOptions()).toMatchObject({ still: false, followPointer: true, label: "" });
    await large.unmount();
  });

  it("mounts the definition of the character it names", async () => {
    const { unmount } = await mount("#8B5CF6::char_ghost", 40);
    expect(lastOptions()).toMatchObject({ definition: botCharacter("ghost")?.definition });
    await unmount();
  });

  it("thinks while the agent works, and smiles for a moment when it finishes", async () => {
    const { rerender, unmount } = await mount("#1FBF68::char_sprout", 78, "idle");
    expect(lastOptions()).toMatchObject({ mood: "idle" });
    await rerender({ status: "running" });
    expect(dom.handles[0]?.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ mood: "thinking" }),
    );
    await rerender({ status: "idle" });
    expect(dom.handles[0]?.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ mood: "happy" }),
    );
    await act(async () => vi.advanceTimersByTime(2_000));
    expect(dom.handles[0]?.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ mood: "idle" }),
    );
    await unmount();
  });

  it("does not smile after a failure", async () => {
    const { rerender, unmount } = await mount("#1FBF68::char_sprout", 78, "running");
    await rerender({ status: "failed" });
    expect(dom.handles[0]?.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ mood: "happy" }),
    );
    await unmount();
  });

  it("follows a change of color without being mounted again", async () => {
    const { rerender, unmount } = await mount("#1FBF68::char_sprout", 40);
    await rerender({ color: "#FF00FF::char_sprout" });
    expect(dom.mountAvatar).toHaveBeenCalledTimes(1);
    expect(dom.handles[0]?.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ color: "#FF00FF" }),
    );
    await unmount();
  });

  it("is mounted again when it grows into a lively size, and let go when it goes", async () => {
    const { rerender, unmount } = await mount("#1FBF68::char_sprout", 38);
    await rerender({ size: 78 });
    expect(dom.mountAvatar).toHaveBeenCalledTimes(2);
    expect(dom.handles[0]?.destroy).toHaveBeenCalledTimes(1);
    expect(lastOptions()).toMatchObject({ still: false });
    await unmount();
    expect(dom.handles[1]?.destroy).toHaveBeenCalledTimes(1);
  });

  it("swaps to another character without keeping the first", async () => {
    const first = await mount("#1FBF68::char_sprout", 40);
    await first.rerender({ color: "#1FBF68::char_cat" });
    expect(dom.handles[0]?.destroy).toHaveBeenCalledTimes(1);
    expect(lastOptions()).toMatchObject({ definition: botCharacter("cat")?.definition });
    await first.unmount();
  });

  it("falls back to the chick for a character that is not known", () => {
    const html = renderToString(<BotAvatar color="#1FBF68::char_nobody" size={40} />);
    expect(html).toContain("data-mascot");
    expect(html).not.toContain("data-character");
  });
});
