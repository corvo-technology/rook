import { BOT_INSTRUCTIONS_MAX_LENGTH } from "@corvo/contracts";
import { describe, expect, it } from "vitest";
import { AGENT_CATALOG } from "./agent-catalog-data.js";
import { CHANNELS_WITH_NOTES, CHIEF_AGENT, chiefInstructions } from "./chief-agent.js";
import { MESSAGING_PROVIDER_IDS } from "./messaging-providers.js";

describe("the Chief", () => {
  it("is named and described in both languages", () => {
    expect(CHIEF_AGENT.name.en).not.toBe(CHIEF_AGENT.name["pt-BR"]);
    expect(CHIEF_AGENT.description.en).not.toBe(CHIEF_AGENT.description["pt-BR"]);
  });

  for (const locale of ["en", "pt-BR"] as const) {
    describe(locale, () => {
      const text = chiefInstructions(locale);

      it("fits in a bot's instructions", () => {
        expect(text.length).toBeLessThan(BOT_INSTRUCTIONS_MAX_LENGTH);
      });

      it("teaches it to delegate with a brief that stands on its own, and to bring the answer back", () => {
        expect(text).toContain("message_bot");
        expect(text).toMatch(locale === "en" ? /stands on its own/ : /se sustente sozinho/);
        expect(text).toMatch(locale === "en" ? /real substance/ : /substância real/);
      });

      it("sends work for a team into the team's group, not into each member's direct chat", () => {
        expect(text).toContain("handoff_to_bot");
        expect(text).toMatch(
          locale === "en"
            ? /for a team that has a group, hand it off in that group[\s\S]*one call per member/
            : /para uma equipe que tem um grupo, entregue no grupo[\s\S]*uma chamada por membro/,
        );
      });

      it("starts alone: greets, asks what the owner needs, suggests Store agents and adds the ones accepted", () => {
        expect(text).toMatch(
          locale === "en"
            ? /When you have no teammates yet[\s\S]*ask what they want help with[\s\S]*suggest one to three agents[\s\S]*add the ones the owner accepts/
            : /Quando você ainda não tem colegas[\s\S]*pergunte com o que ele quer ajuda[\s\S]*sugira de um a três agentes[\s\S]*adicione os que o dono aceitar/,
        );
      });

      it("unblocks a teammate with connect_app and does not send the owner to the Store", () => {
        expect(text).toMatch(/connect_app[\s\S]*agent/);
        expect(text).not.toMatch(
          locale === "en" ? /tell the owner which one to connect/ : /diga ao dono qual conectar/,
        );
        expect(text).toMatch(
          locale === "en"
            ? /Be proactive[\s\S]*the blocker is yours/
            : /Seja proativo[\s\S]*o bloqueio é seu/,
        );
      });

      it("says which language to speak first and to follow the person afterwards", () => {
        expect(text).toMatch(
          locale === "en"
            ? /app is in English[\s\S]*language the person writes/
            : /app está em português do Brasil[\s\S]*idioma em que a pessoa escrever/,
        );
      });

      it("teaches it to look up the Store's agents, ask first, add one only after a yes, and pass on the work", () => {
        expect(text).toContain("store_agents");
        expect(text).toContain("install_agent");
        expect(text).toMatch(
          locale === "en" ? /Only after a clear yes/ : /Só depois de um sim claro/,
        );
        expect(text).toMatch(
          locale === "en"
            ? /hand the original request to the new agent/
            : /passe o pedido original ao novo agente/,
        );
      });

      it("knows the email agent needs setup and that the owner connects apps in the Store", () => {
        expect(text).toMatch(
          locale === "en" ? /email agent needs setup/ : /agente de email precisa de configuração/,
        );
        expect(text).toMatch(locale === "en" ? /under Apps/ : /em Apps/);
      });

      it("keeps the owner in control: agents are added only after a yes and never changed or deleted unasked", () => {
        expect(text).toMatch(
          locale === "en"
            ? /Add an agent only after the owner says yes, and never delete or change agents unless the owner asks/
            : /Adicione um agente só depois de o dono dizer sim e nunca apague nem altere agentes a menos que o dono peça/,
        );
        expect(text).toMatch(locale === "en" ? /owner's approval/ : /aprovação do dono/);
      });

      it("does not carry a list of Store agents that would go stale", () => {
        for (const agent of AGENT_CATALOG) expect(text).not.toContain(`- ${agent.name[locale]}:`);
      });
    });
  }

  it("is written differently in each language", () => {
    expect(chiefInstructions("pt-BR")).not.toBe(chiefInstructions("en"));
  });
});

describe("the Chief in a chat app", () => {
  it("has a note for every chat app Rook knows by name, so a new integration cannot be left out", () => {
    for (const provider of MESSAGING_PROVIDER_IDS) expect(CHANNELS_WITH_NOTES).toContain(provider);
  });

  for (const locale of ["en", "pt-BR"] as const) {
    it(`adds how to write and greet in ${locale}, after the usual instructions`, () => {
      const base = chiefInstructions(locale);
      for (const provider of MESSAGING_PROVIDER_IDS) {
        const text = chiefInstructions(locale, provider);
        expect(text.startsWith(base), provider).toBe(true);
        expect(text.length, provider).toBeGreaterThan(base.length);
        expect(text, provider).toMatch(locale === "en" ? /introduce yourself/ : /apresente-se/);
      }
    });
  }

  it("writes differently for each app", () => {
    expect(chiefInstructions("en", "telegram")).not.toBe(chiefInstructions("en", "whatsapp"));
    expect(chiefInstructions("en", "sendblue")).toContain("iMessage or SMS");
  });

  it("treats an extra named Telegram bot as Telegram", () => {
    expect(chiefInstructions("en", "telegram-sales")).toBe(chiefInstructions("en", "telegram"));
  });

  it("uses a generic note for an app it does not know yet", () => {
    const text = chiefInstructions("en", "some-new-app");
    expect(text).toContain("a chat app");
    expect(text.startsWith(chiefInstructions("en"))).toBe(true);
  });

  it("adds nothing without a chat app", () => {
    expect(chiefInstructions("en")).not.toContain("reached through");
  });
});
