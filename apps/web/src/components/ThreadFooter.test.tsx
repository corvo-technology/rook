import { renderToString } from "react-dom/server";
import { expect, it } from "vitest";
import { ThreadFooter } from "./ThreadFooter";

it("shows the reply count, the faces and the time of the last reply", () => {
  const html = renderToString(
    <ThreadFooter
      open={false}
      countLabel="3 replies"
      faces={[{ botId: "research", color: "#14B8A6" }]}
      lastAt="2026-11-02T12:20:00.000Z"
      lastLabel="12:20 PM"
      onOpen={() => undefined}
    />,
  );
  expect(html).toContain('data-testid="thread-footer"');
  expect(html).toContain('aria-expanded="false"');
  expect(html).toContain("3 replies");
  expect(html).toContain("12:20 PM");
  expect(html).toContain("corvo-mascot-avatar");
});

it("says it is open while its thread is", () => {
  const html = renderToString(
    <ThreadFooter
      open
      countLabel="1 reply"
      faces={[]}
      lastAt="2026-11-02T12:20:00.000Z"
      lastLabel="12:20 PM"
      onOpen={() => undefined}
    />,
  );
  expect(html).toContain('aria-expanded="true"');
});
