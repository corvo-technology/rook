// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { PageHeader } from "./PageHeader";

it("renders the title as the page heading beside its controls", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <PageHeader
        leading={<button type="button">Back</button>}
        actions={<button type="button">Add</button>}
      >
        Team
      </PageHeader>,
    ),
  );
  expect(host.querySelector("h1")?.textContent).toBe("Team");
  expect(host.querySelectorAll("header button")).toHaveLength(2);
  await act(async () => root.unmount());
  host.remove();
});
