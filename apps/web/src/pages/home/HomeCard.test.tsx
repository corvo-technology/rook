// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { HomeCard } from "./HomeCard";

it("shows the title and its action, with nothing to move or hide the card", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <HomeCard title="Working now" testId="card" action={<button type="button">See all</button>}>
        body
      </HomeCard>,
    ),
  );
  expect(host.querySelector("h2")?.textContent).toBe("Working now");
  expect([...host.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["See all"]);
  await act(async () => root.unmount());
  host.remove();
});
