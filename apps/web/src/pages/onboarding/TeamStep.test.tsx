// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => `${text}${index > 0 ? values[index - 1] : ""}${part}`, "");
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});
vi.mock("../ImportFlow", () => ({
  ImportFlow: ({ onBack, onFinish }: { onBack: () => void; onFinish: () => void }) => (
    <div>
      <button type="button" onClick={onBack}>
        Back
      </button>
      <button type="button" onClick={onFinish}>
        Finish import
      </button>
    </div>
  ),
}));

import { suggestTeam } from "@corvo/core";
import type { TeamDropped } from "./TeamStep";
import { keptTeam, NOTHING_DROPPED, TeamStep } from "./TeamStep";

const suggestion = suggestTeam({ business: "agency", areas: ["sales"] });
const onDone = vi.fn();
const onDroppedChange = vi.fn();
let container: HTMLDivElement;
let root: Root;

const button = (name: string) => {
  const found = [...container.querySelectorAll("button")].find((b) =>
    b.textContent?.startsWith(name),
  );
  if (!found) throw new Error(`no button ${name}`);
  return found;
};

function render(dropped: TeamDropped = NOTHING_DROPPED, team = suggestion) {
  act(() =>
    root.render(
      <TeamStep
        suggestion={team}
        dropped={dropped}
        locale="en"
        onDroppedChange={onDroppedChange}
        onDone={onDone}
      />,
    ),
  );
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  onDone.mockReset();
  onDroppedChange.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("keptTeam", () => {
  it("drops an agent with its channel, and a channel alone", () => {
    expect(
      keptTeam(suggestion, { agents: [suggestion[0]!.slug], channels: [] }).channels.map(
        (agent) => agent.slug,
      ),
    ).not.toContain(suggestion[0]!.slug);
    const kept = keptTeam(suggestion, { agents: [], channels: [suggestion[1]!.category] });
    expect(kept.agents).toHaveLength(suggestion.length);
    expect(kept.channels.map((agent) => agent.slug)).not.toContain(suggestion[1]!.slug);
  });
});

describe("TeamStep", () => {
  it("builds the suggested team as it stands: each agent, and a channel for the first ones", async () => {
    render();
    await act(async () => button("Continue").click());
    const [picks, way] = onDone.mock.calls[0]!;
    expect(way).toBe("team");
    expect(picks.categories).toEqual([]);
    expect(picks.agents).toEqual(suggestion.map((agent) => agent.slug));
    expect(picks.channels).toHaveLength(3);
    expect(picks.channels[0]).toEqual({
      name: expect.any(String),
      agentSlugs: [suggestion[0]!.slug],
    });
  });

  it("leaves out what the person turned off", async () => {
    render({ agents: [suggestion[0]!.slug], channels: [suggestion[1]!.category] });
    await act(async () => button("Continue").click());
    const [picks] = onDone.mock.calls[0]!;
    expect(picks.agents).not.toContain(suggestion[0]!.slug);
    expect(
      picks.channels.map((channel: { agentSlugs: string[] }) => channel.agentSlugs[0]),
    ).toEqual([suggestion[2]!.slug]);
  });

  it("reports a toggled agent without losing what was already off", () => {
    render({ agents: ["x"], channels: [] });
    const chips = container.querySelectorAll('[data-testid="team-suggestion"] button');
    act(() => (chips[0] as HTMLButtonElement).click());
    expect(onDroppedChange).toHaveBeenCalledWith({
      agents: ["x", suggestion[0]!.slug],
      channels: [],
    });
  });

  it("starts with only the Chief when there is nothing to suggest", async () => {
    render(NOTHING_DROPPED, []);
    expect(container.querySelector('[data-testid="team-suggestion"]')).toBeNull();
    await act(async () => button("Continue").click());
    expect(onDone.mock.calls[0]![0]).toEqual({ categories: [], agents: [], channels: [] });
  });

  it("opens the import as its own screen and finishes the step from it", async () => {
    render();
    await act(async () => button("Import").click());
    expect(container.textContent).not.toContain("builds a team");
    await act(async () => button("Finish import").click());
    expect(onDone).toHaveBeenCalledWith({ categories: [] }, "import");
  });

  it("comes back from the import", async () => {
    render();
    await act(async () => button("Import").click());
    await act(async () => button("Back").click());
    expect(container.textContent).toContain("I don't use any yet");
  });
});
