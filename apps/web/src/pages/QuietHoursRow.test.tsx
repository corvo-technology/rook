// @vitest-environment jsdom

import type { QuietHours } from "@corvo/contracts";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: (strings: TemplateStringsArray) => strings.join("") }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@corvo/ui-web", () => ({
  Input: (props: React.ComponentProps<"input">) => <input {...props} />,
  Label: ({ children, htmlFor }: { children?: ReactNode; htmlFor?: string }) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
  Switch: ({
    checked,
    onCheckedChange,
    ...props
  }: {
    checked: boolean;
    onCheckedChange?: (checked: boolean) => void;
  } & React.ComponentProps<"button">) => (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange?.(!checked)}
      {...props}
    />
  ),
}));

import { clockMinutes, clockText, QuietHoursRow } from "./QuietHoursRow";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Array<() => void> = [];
afterEach(() => {
  for (const unmount of roots.splice(0)) unmount();
  document.body.innerHTML = "";
});

function mount(value: QuietHours, onChange: (next: QuietHours) => Promise<unknown>) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(<QuietHoursRow value={value} onChange={onChange} />));
  roots.push(() => act(() => root.unmount()));
  return host;
}

it("reads and writes the clock a time input holds", () => {
  expect(clockText(22 * 60)).toBe("22:00");
  expect(clockText(8 * 60 + 5)).toBe("08:05");
  expect(clockMinutes("22:00")).toBe(1320);
  expect(clockMinutes("")).toBeNull();
  expect(clockMinutes("24:00")).toBeNull();
  expect(clockMinutes("07:60")).toBeNull();
});

it("shows the window only while quiet hours are on", () => {
  const off = mount({ enabled: false, start: 1320, end: 480 }, async () => undefined);
  expect(off.querySelector('[data-testid="quiet-hours-start"]')).toBeNull();
  roots.pop()?.();
  const on = mount({ enabled: true, start: 1320, end: 480 }, async () => undefined);
  expect((on.querySelector('[data-testid="quiet-hours-start"]') as HTMLInputElement).value).toBe(
    "22:00",
  );
  expect((on.querySelector('[data-testid="quiet-hours-end"]') as HTMLInputElement).value).toBe(
    "08:00",
  );
});

it("saves the switch", () => {
  const onChange = vi.fn(async () => undefined);
  const host = mount({ enabled: true, start: 1320, end: 480 }, onChange);
  act(() => (host.querySelector('[data-testid="quiet-hours-toggle"]') as HTMLElement).click());
  expect(onChange).toHaveBeenCalledWith({ enabled: false, start: 1320, end: 480 });
});

it("puts the switch back when the save fails", async () => {
  const onChange = vi.fn(async () => {
    throw new Error("offline");
  });
  const host = mount({ enabled: true, start: 1320, end: 480 }, onChange);
  await act(async () =>
    (host.querySelector('[data-testid="quiet-hours-toggle"]') as HTMLElement).click(),
  );
  expect(
    host.querySelector('[data-testid="quiet-hours-toggle"]')?.getAttribute("aria-checked"),
  ).toBe("true");
});
