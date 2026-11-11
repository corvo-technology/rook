import type { OnboardingPicks, SignupSurvey, StoreCategory } from "@corvo/contracts";
import { STORE_CATEGORIES } from "@corvo/contracts";
import { Button, ToggleGroup, ToggleGroupItem } from "@corvo/ui-web";
import { Trans } from "@lingui/react/macro";
import { useId, useState } from "react";
import { rpc } from "../../lib/rpc";
import { useStoreCategoryLabels } from "../StoreCategoryChips";

type Use = NonNullable<SignupSurvey["use"]>;

export function UseStep({ onDone }: { onDone: (picks: OnboardingPicks) => void }) {
  const fieldId = useId();
  const labels = useStoreCategoryLabels();
  const [use, setUse] = useState<Use | null>(null);
  // In the order tapped: the first one decides which agent is made.
  const [picked, setPicked] = useState<readonly StoreCategory[]>([]);

  function toggle(category: StoreCategory) {
    setPicked((current) =>
      current.includes(category)
        ? current.filter((item) => item !== category)
        : [...current, category],
    );
  }

  function submit() {
    // Answers are optional, so a slow or failed save never holds up onboarding. Saving writes
    // every survey field, so nothing is sent when nothing was answered.
    if (use) void rpc.onboarding.signupSurvey({ use }).catch(() => undefined);
    onDone({ ...(use ? { use } : {}), categories: [...picked] });
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <h1 id={`${fieldId}-use`} className="text-[32px] font-medium text-foreground">
        <Trans>How will you use Rook?</Trans>
      </h1>
      <ToggleGroup
        aria-labelledby={`${fieldId}-use`}
        value={use ? [use] : []}
        onValueChange={([next]) => setUse((next as Use | undefined) ?? null)}
        spacing={1}
        className="mt-6 grid w-full grid-cols-3 rounded-lg bg-muted p-1"
      >
        <ToggleGroupItem
          value="personal"
          className="aria-pressed:bg-background aria-pressed:shadow-sm"
        >
          <Trans>Personal</Trans>
        </ToggleGroupItem>
        <ToggleGroupItem value="work" className="aria-pressed:bg-background aria-pressed:shadow-sm">
          <Trans>Work</Trans>
        </ToggleGroupItem>
        <ToggleGroupItem value="both" className="aria-pressed:bg-background aria-pressed:shadow-sm">
          <Trans>Both</Trans>
        </ToggleGroupItem>
      </ToggleGroup>
      <fieldset className="mt-8 min-w-0">
        <legend className="text-sm font-medium text-foreground">
          <Trans>What should your bots help with?</Trans>
        </legend>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {STORE_CATEGORIES.map((category) => (
            <Button
              key={category}
              type="button"
              variant={picked.includes(category) ? "secondary" : "outline"}
              aria-pressed={picked.includes(category)}
              className="h-auto justify-start py-3"
              onClick={() => toggle(category)}
            >
              {labels[category]}
            </Button>
          ))}
        </div>
      </fieldset>
      <Button type="submit" className="mt-8 w-full">
        <Trans>Continue</Trans>
      </Button>
    </form>
  );
}
