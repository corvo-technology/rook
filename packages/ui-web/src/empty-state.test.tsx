// @vitest-environment jsdom
import { expect, it } from "vitest";
import { EmptyState } from "./empty-state.js";
import { mount } from "./test-render.js";

it("shows one line, a piece and only the action it is given", async () => {
  const view = await mount(
    <EmptyState title="No routines yet" piece="knight" data-testid="empty" />,
  );
  expect(view.host.querySelector("[data-testid=empty] p")?.textContent).toBe("No routines yet");
  expect(view.host.querySelector("[data-testid=empty] > :first-child")?.tagName).not.toBe("P");
  expect(view.host.querySelector("button")).toBeNull();
  await view.cleanup();
});
