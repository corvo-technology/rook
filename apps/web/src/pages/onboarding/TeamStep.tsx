import type { AgentCatalogLocale, OnboardingPicks, StoreCategory } from "@corvo/contracts";
import type { SuggestedAgent } from "@corvo/core";
import { AGENT_CATALOG, suggestedChannelAgents } from "@corvo/core";
import { Button } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { ImportFlow } from "../ImportFlow";
import { useStoreCategoryLabels } from "../StoreCategoryChips";
import { ContinueButton } from "./OnboardingLayout";

/** What the person turned off in the suggested team; the rest is kept. */
export type TeamDropped = { agents: readonly string[]; channels: readonly StoreCategory[] };
export const NOTHING_DROPPED: TeamDropped = { agents: [], channels: [] };

export function agentName(slug: string, locale: AgentCatalogLocale): string {
  return AGENT_CATALOG.find((entry) => entry.slug === slug)?.name[locale] ?? slug;
}

/** The agents and channels that stay once what was turned off is taken out. */
export function keptTeam(suggestion: readonly SuggestedAgent[], dropped: TeamDropped) {
  const agents = suggestion.filter((agent) => !dropped.agents.includes(agent.slug));
  const channels = suggestedChannelAgents(suggestion).filter(
    (agent) => !dropped.agents.includes(agent.slug) && !dropped.channels.includes(agent.category),
  );
  return { agents, channels };
}

/**
 * How the team starts: bring the agents already used elsewhere, or let the Chief build one from
 * what the person said they do. The suggested agents and their channels can be turned off one by
 * one before anything is made.
 */
export function TeamStep({
  suggestion,
  dropped,
  locale,
  onDroppedChange,
  onDone,
}: {
  suggestion: readonly SuggestedAgent[];
  dropped: TeamDropped;
  locale: AgentCatalogLocale;
  onDroppedChange: (next: TeamDropped) => void;
  onDone: (picks: OnboardingPicks, way: "team" | "import") => void;
}) {
  const { t } = useLingui();
  const categoryLabels = useStoreCategoryLabels();
  const [screen, setScreen] = useState<"start" | "import">("start");
  const kept = keptTeam(suggestion, dropped);
  const toggle = <Item,>(list: readonly Item[], item: Item) =>
    list.includes(item) ? list.filter((entry) => entry !== item) : [...list, item];

  if (screen === "import") {
    return (
      <div>
        <h1 className="mb-6 text-[32px] font-medium text-foreground">{t`Import`}</h1>
        <ImportFlow
          onBack={() => setScreen("start")}
          onFinish={() => onDone({ categories: [] }, "import")}
        />
      </div>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onDone(
          {
            categories: [],
            agents: kept.agents.map((agent) => agent.slug),
            channels: kept.channels.map((agent) => ({
              name: categoryLabels[agent.category],
              agentSlugs: [agent.slug],
            })),
          },
          "team",
        );
      }}
    >
      <h1 className="text-[32px] font-medium text-foreground">{t`Your team`}</h1>
      <div className="mt-6 flex flex-col gap-2">
        <button
          type="button"
          className="w-full rounded-xl border border-border p-4 text-left font-medium hover:bg-muted/50 motion-safe:transition-colors"
          onClick={() => setScreen("import")}
        >
          {t`Import`}
        </button>
        <div className="rounded-xl border border-foreground bg-muted p-4">
          <p className="font-medium">
            {t`I don't use any yet: Rook builds a team from what you do`}
          </p>
          {suggestion.length > 0 ? (
            <div data-testid="team-suggestion" className="mt-3 flex flex-col gap-3">
              <div className="flex flex-wrap gap-2">
                {suggestion.map((agent) => (
                  <Button
                    key={agent.slug}
                    type="button"
                    size="sm"
                    variant={dropped.agents.includes(agent.slug) ? "outline" : "secondary"}
                    aria-pressed={!dropped.agents.includes(agent.slug)}
                    onClick={() =>
                      onDroppedChange({ ...dropped, agents: toggle(dropped.agents, agent.slug) })
                    }
                  >
                    {agentName(agent.slug, locale)}
                  </Button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {suggestedChannelAgents(suggestion).map((agent) => {
                  const gone =
                    dropped.agents.includes(agent.slug) ||
                    dropped.channels.includes(agent.category);
                  return (
                    <Button
                      key={agent.category}
                      type="button"
                      size="sm"
                      variant={gone ? "outline" : "secondary"}
                      aria-pressed={!gone}
                      disabled={dropped.agents.includes(agent.slug)}
                      onClick={() =>
                        onDroppedChange({
                          ...dropped,
                          channels: toggle(dropped.channels, agent.category),
                        })
                      }
                    >
                      {`#${categoryLabels[agent.category]}`}
                    </Button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <ContinueButton className="mt-8 w-full">{t`Continue`}</ContinueButton>
    </form>
  );
}
