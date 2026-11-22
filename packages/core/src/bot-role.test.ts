import { expect, it } from "vitest";
import { botRole } from "./bot-role.js";
import { CHIEF_BOT_SPAWN_KEY } from "./bot-sections.js";

it("shows the Chief as the owner's right hand whatever title is stored", () => {
  const chief = { spawnKey: CHIEF_BOT_SPAWN_KEY, title: "Chief of Staff dos Agentes" };
  expect(botRole(chief, "pt-BR")).toBe("seu braço direito");
  expect(botRole(chief, "en")).toBe("your right hand");
});

it("leaves every other agent's own title alone", () => {
  expect(botRole({ spawnKey: null, title: "Bookkeeper" }, "en")).toBe("Bookkeeper");
  expect(botRole(undefined, "en")).toBe("");
});
