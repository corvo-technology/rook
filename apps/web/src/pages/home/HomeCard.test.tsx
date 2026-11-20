// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { HomeCard } from "./HomeCard";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (strings: TemplateStringsArray, ...values: unknown[]) =>
      strings.reduce((text, part, index) => text + part + (values[index] ?? ""), ""),
  }),
}));

function card(name: string): ReactNode {
  return (
    <HomeCard title={name} name={name} testId={name} organizing onMove={() => {}} onHide={() => {}}>
      body
    </HomeCard>
  );
}

it("names each organize control after its card", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <>
        {card("Working now")}
        {card("Next routines")}
      </>,
    ),
  );
  const names = [...host.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"));
  expect(names).toEqual([
    "Move Working now earlier",
    "Move Working now later",
    "Hide Working now",
    "Move Next routines earlier",
    "Move Next routines later",
    "Hide Next routines",
  ]);
  await act(async () => root.unmount());
  host.remove();
});
