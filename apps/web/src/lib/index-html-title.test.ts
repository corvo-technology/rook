import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("ships an empty title, so a partner's host never shows the app's name before its own", () => {
  const html = readFileSync(fileURLToPath(new URL("../../index.html", import.meta.url)), "utf8");
  expect(html).toContain("<title></title>");
});
