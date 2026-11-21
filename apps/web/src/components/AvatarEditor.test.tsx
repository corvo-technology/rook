// @vitest-environment jsdom
import { AVATAR_COLORS } from "@corvo/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AvatarEditor } from "./AvatarEditor";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: (parts: TemplateStringsArray) => parts.join("") }),
  Trans: ({ children }: { children: string }) => children,
}));

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

async function mount(value: string | null, onSave = vi.fn(async () => {})) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  await act(async () =>
    createRoot(host).render(
      <AvatarEditor
        value={value}
        preview={(v) => <i data-testid="preview">{v}</i>}
        onSave={onSave}
      />,
    ),
  );
  return { host, onSave };
}

it("offers every color and saves the one chosen", async () => {
  const { host, onSave } = await mount(null);
  const swatches = host.querySelectorAll<HTMLButtonElement>("[aria-pressed]");
  expect(swatches).toHaveLength(AVATAR_COLORS.length);
  await act(async () => swatches[2]?.click());
  expect(onSave).toHaveBeenCalledWith(AVATAR_COLORS[2]);
});

it("marks the current color and offers Remove only when there is something to remove", async () => {
  const { host, onSave } = await mount(AVATAR_COLORS[1]);
  expect(host.querySelectorAll("[aria-pressed=true]")).toHaveLength(1);
  const remove = [...host.querySelectorAll("button")].find((b) => b.textContent === "Remove");
  await act(async () => remove?.click());
  expect(onSave).toHaveBeenCalledWith(null);
  document.body.innerHTML = "";
  const empty = await mount(null);
  expect([...empty.host.querySelectorAll("button")].some((b) => b.textContent === "Remove")).toBe(
    false,
  );
});

it("shows an error when saving fails", async () => {
  const { host } = await mount(
    null,
    vi.fn(async () => Promise.reject(new Error("no"))),
  );
  await act(async () => host.querySelector<HTMLButtonElement>("[aria-pressed]")?.click());
  expect(host.querySelector("[role=alert]")?.textContent).toBe("Could not save");
});
