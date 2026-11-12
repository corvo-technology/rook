// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("open-bot-avatar/dom", () => ({
  mountAvatar: vi.fn(() => ({ update: vi.fn(), destroy: vi.fn() })),
}));
vi.mock("@lingui/core/macro", () => ({
  t: (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => text + part + (values[index] ?? ""), ""),
}));
vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
}));

import { AvatarStudioPopover, BotCharacterPicker, BotLookPicker } from "./avatar-studio-popover";

const onChange = vi.fn();
beforeEach(() => {
  onChange.mockReset();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

async function mount(element: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(element));
  return { host, unmount: () => act(async () => root.unmount()) };
}

const tile = (host: HTMLElement, name: string) =>
  [...host.querySelectorAll("button")].find((item) => item.getAttribute("aria-label") === name) as
    | HTMLButtonElement
    | undefined;
const pressed = (host: HTMLElement) =>
  [...host.querySelectorAll("button")]
    .filter((item) => item.getAttribute("aria-pressed") === "true")
    .map((item) => item.getAttribute("aria-label"));

it("offers the default chick and every character, each by name", async () => {
  const { host, unmount } = await mount(<BotCharacterPicker value="#3B82F6" onChange={onChange} />);
  const buttons = host.querySelectorAll('[data-testid="avatar-studio-characters"] button');
  expect(buttons).toHaveLength(28);
  expect(tile(host, "Default")).toBeDefined();
  for (const name of [
    "King",
    "Queen",
    "Bishop",
    "Knight",
    "Pawn",
    "Ghost",
    "Witch Hat",
    "Paint Brush",
    "Watering Can",
  ]) {
    expect(tile(host, name), name).toBeDefined();
  }
  await unmount();
});

it("puts the default first, then the chess pieces, then the other characters", async () => {
  const { host, unmount } = await mount(<BotCharacterPicker value="#3B82F6" onChange={onChange} />);
  const names = [...host.querySelectorAll('[data-testid="avatar-studio-characters"] button')].map(
    (item) => item.getAttribute("aria-label"),
  );
  expect(names.slice(0, 7)).toEqual([
    "Default",
    "King",
    "Queen",
    "Bishop",
    "Knight",
    "Pawn",
    "Controller",
  ]);
  await unmount();
});

it("wears a chess piece in the color the agent already wears", async () => {
  const { host, unmount } = await mount(<BotCharacterPicker value="#14B8A6" onChange={onChange} />);
  await act(async () => tile(host, "Knight")?.click());
  expect(onChange).toHaveBeenCalledExactlyOnceWith("#14B8A6::char_knight");
  await unmount();
});

it("marks the chick when no character is worn, and the character when there is one", async () => {
  const plain = await mount(<BotCharacterPicker value="#3B82F6" onChange={onChange} />);
  expect(pressed(plain.host)).toEqual(["Default"]);
  await plain.unmount();
  const worn = await mount(<BotCharacterPicker value="#3B82F6::char_cat" onChange={onChange} />);
  expect(pressed(worn.host)).toEqual(["Cat"]);
  await worn.unmount();
});

it("puts the character on the color the agent already wears", async () => {
  const { host, unmount } = await mount(<BotCharacterPicker value="#14B8A6" onChange={onChange} />);
  await act(async () => tile(host, "Ghost")?.click());
  expect(onChange).toHaveBeenCalledExactlyOnceWith("#14B8A6::char_ghost");
  await unmount();
});

it("changes character without changing color, and goes back to the chick", async () => {
  const { host, unmount } = await mount(
    <BotCharacterPicker value="#14B8A6::char_ghost" onChange={onChange} />,
  );
  await act(async () => tile(host, "Rocket")?.click());
  expect(onChange).toHaveBeenLastCalledWith("#14B8A6::char_rocket");
  await act(async () => tile(host, "Default")?.click());
  expect(onChange).toHaveBeenLastCalledWith("#14B8A6");
  await unmount();
});

it("starts from the default color when the agent wears a photo", async () => {
  const { host, unmount } = await mount(
    <BotCharacterPicker value="data:image/webp;base64,AAAA" onChange={onChange} />,
  );
  expect(pressed(host)).toEqual([]);
  await act(async () => tile(host, "Star")?.click());
  expect(onChange).toHaveBeenCalledWith(expect.stringMatching(/^#[0-9A-Fa-f]{6}::char_star$/));
  await unmount();
});

it("keeps the character when another color is chosen, and shows it in each swatch", async () => {
  const { host, unmount } = await mount(
    <BotLookPicker value="#3B82F6::char_cat" onChange={onChange} />,
  );
  expect(
    host.querySelectorAll('[data-testid="avatar-studio-colors"] [data-character="cat"]'),
  ).toHaveLength(10);
  await act(async () => tile(host, "Color #EAB308")?.click());
  expect(onChange).toHaveBeenCalledExactlyOnceWith("#EAB308::char_cat");
  await unmount();
});

it("keeps choosing a plain color for the chick as before", async () => {
  const { host, unmount } = await mount(<BotLookPicker value="#3B82F6" onChange={onChange} />);
  await act(async () => tile(host, "Color #EAB308")?.click());
  expect(onChange).toHaveBeenCalledExactlyOnceWith("#EAB308");
  expect(pressed(host)).toEqual(["Color #3B82F6"]);
  await unmount();
});

async function pickColor(host: HTMLElement, hex: string) {
  const input = host.querySelector<HTMLInputElement>('input[type="color"]') as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, hex);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("keeps the character on a color of one's own, once the drag settles", async () => {
  vi.useFakeTimers();
  try {
    const { host, unmount } = await mount(
      <BotLookPicker value="#3B82F6::char_cat" onChange={onChange} />,
    );
    await pickColor(host, "#112233");
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(500));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("#112233::char_cat");
    await unmount();
  } finally {
    vi.useRealTimers();
  }
});

it("keeps the character on a color still waiting when the picker closes", async () => {
  vi.useFakeTimers();
  try {
    const { host, unmount } = await mount(
      <BotLookPicker value="#3B82F6::char_ghost" onChange={onChange} />,
    );
    await pickColor(host, "#445566");
    await unmount();
    expect(onChange).toHaveBeenCalledExactlyOnceWith("#445566::char_ghost");
  } finally {
    vi.useRealTimers();
  }
});

it("shows the character in the tile of a color of one's own", async () => {
  const { host, unmount } = await mount(
    <BotLookPicker value="#14B8A6::char_rocket" onChange={onChange} />,
  );
  expect(host.querySelectorAll('[data-character="rocket"]').length).toBeGreaterThan(10);
  expect(host.querySelector("[data-custom-color]")?.textContent).toContain("#14B8A6");
  await unmount();
});

it("picks from the role on request, and only while it is not already doing so", async () => {
  let finish: () => void = () => undefined;
  const onDesign = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
  const { host, unmount } = await mount(
    <AvatarStudioPopover value="#3B82F6" onChange={onChange} onDesign={onDesign} />,
  );
  await act(async () => host.querySelector<HTMLButtonElement>("button")?.click());
  const design = () =>
    document.querySelector<HTMLButtonElement>('[data-testid="avatar-studio-design"]');
  // The studio opens on the color tab; the action lives with the characters.
  expect(design()).toBeNull();
  await act(async () =>
    [...document.querySelectorAll<HTMLElement>('[role="tab"]')]
      .find((item) => item.textContent === "Character")
      ?.click(),
  );
  await act(async () => design()?.click());
  await act(async () => design()?.click());
  expect(onDesign).toHaveBeenCalledOnce();
  expect(design()?.disabled).toBe(true);
  await act(async () => finish());
  expect(design()?.disabled).toBe(false);
  await unmount();
});
