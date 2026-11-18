import type { BusinessKind } from "@corvo/contracts";
import type { OnboardingStepId } from "./onboarding-steps";

export type RailAnswers = {
  spaceName: string | null;
  business: BusinessKind | null;
  userName: string | null;
  /** How the team was chosen, once it was. */
  team: { way: "team" | "import" | "blank"; agents: number } | null;
};

export type RailLabels = {
  business: Record<BusinessKind, string>;
  imported: string;
  justTheChief: string;
  agents: (count: number) => string;
};

/** The answer each finished step shows under its title in the rail. Steps without one show none. */
export function railDetails(
  answers: RailAnswers,
  labels: RailLabels,
): Partial<Record<OnboardingStepId, string>> {
  const details: Partial<Record<OnboardingStepId, string>> = {};
  const name = answers.spaceName?.trim();
  if (name) details.workspace = name;
  if (answers.business) details.business = labels.business[answers.business];
  const person = answers.userName?.trim();
  if (person) details.you = person;
  if (answers.team) {
    details.start =
      answers.team.way === "import"
        ? labels.imported
        : answers.team.agents > 0
          ? labels.agents(answers.team.agents)
          : labels.justTheChief;
  }
  return details;
}

/** How many steps are still ahead, counting the one open. */
export function stepsLeft(
  visible: readonly OnboardingStepId[],
  done: ReadonlySet<OnboardingStepId>,
): number {
  return visible.filter((step) => !done.has(step)).length;
}

/** The first word of a name, for greeting someone. */
export function firstName(name: string | null | undefined): string {
  return name?.trim().split(/\s+/)[0] ?? "";
}
