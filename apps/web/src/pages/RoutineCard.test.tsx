// @vitest-environment jsdom

import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";

const testRun = vi.hoisted(() => vi.fn());
vi.mock("../lib/rpc", () => ({ rpc: { routines: { testRun } } }));
vi.mock("../lib/user-error", () => ({ errorText: () => "Could not run the routine" }));
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: (parts: TemplateStringsArray) => parts.join("") }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@corvo/ui-web", () => {
  const Container = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Button: (props: ComponentProps<"button">) => <button type="button" {...props} />,
    SidePanel: ({
      title,
      footer,
      children,
    }: {
      title?: ReactNode;
      footer?: ReactNode;
      children?: ReactNode;
    }) => (
      <aside>
        <h2>{title}</h2>
        {children}
        <footer>{footer}</footer>
      </aside>
    ),
  };
});

import { RoutineCard } from "./RoutineCard";

const item = {
  routineId: "r1",
  name: "Morning summary",
  botId: "b1",
  botName: "Chief",
  at: "2026-10-30T12:00:00.000Z",
  state: "upcoming" as const,
  runId: null,
};

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {
  testRun.mockReset();
});

async function renderCard(onRan = vi.fn()) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <RoutineCard
        item={item}
        time="Fri 9:00 AM"
        onOpenAgent={() => {}}
        onRan={onRan}
        onClose={() => {}}
      />,
    ),
  );
  const run = [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Run now"),
  )!;
  return { container, run };
}

it("runs the routine now and tells the screen to refresh", async () => {
  testRun.mockResolvedValue({ runId: "run-1" });
  const onRan = vi.fn();
  const { container, run } = await renderCard(onRan);
  expect(container.textContent).toContain("Chief · Fri 9:00 AM");
  await act(async () => run.click());
  expect(testRun).toHaveBeenCalledWith({ routineId: "r1" });
  expect(onRan).toHaveBeenCalledTimes(1);
});

it("says so when the run could not start, and lets the person try again", async () => {
  testRun.mockImplementation(() => {
    const failed = Promise.reject(new Error("boom"));
    failed.catch(() => undefined);
    return failed;
  });
  const onRan = vi.fn();
  const { container, run } = await renderCard(onRan);
  await act(async () => {
    run.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(container.querySelector("[role='alert']")).not.toBeNull();
  expect(run.disabled).toBe(false);
  expect(onRan).not.toHaveBeenCalled();
});
