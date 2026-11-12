import { renderToString } from "react-dom/server";
import { expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (parts: TemplateStringsArray, ...values: unknown[]) =>
      parts.reduce((text, part, index) => text + part + (values[index] ?? ""), ""),
  }),
}));

import { WorkingLine, workingLineText } from "./WorkingLine";

const say = {
  one: (name: string) => `${name} is working…`,
  two: (a: string, b: string) => `${a} and ${b} are working…`,
  many: (count: number) => `${count} agents are working…`,
};

it("names one agent, then two, then counts", () => {
  expect(workingLineText(["Bento"], say)).toBe("Bento is working…");
  expect(workingLineText(["Bento", "Cora"], say)).toBe("Bento and Cora are working…");
  expect(workingLineText(["Bento", "Cora", "Fabio"], say)).toBe("3 agents are working…");
  expect(workingLineText(["a", "b", "c", "d"], say)).toBe("4 agents are working…");
});

const render = (names: string[]) =>
  renderToString(
    <WorkingLine
      bots={names.map((name) => ({
        botId: name.toLowerCase(),
        name,
        color: "#14B8A6",
        status: "running",
      }))}
    />,
  );

it("shows each working agent's rook and says who is working", () => {
  const html = render(["Bento", "Cora"]);
  expect(html).toContain('role="status"');
  expect(html).toContain("Bento and Cora are working…");
  expect(html).toContain("corvo-bot-avatar-ring-working");
});

it("counts three or more agents instead of naming them", () => {
  expect(render(["Bento", "Cora", "Fabio"])).toContain("3 agents are working…");
});

it("is nothing while nobody works", () => {
  expect(render([])).toBe("");
});
