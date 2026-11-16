import type { OnboardingPicks, StoreCategory } from "@corvo/contracts";
import { STORE_CATEGORIES } from "@corvo/contracts";
import { Button } from "@corvo/ui-web";
import { Trans } from "@lingui/react/macro";
import { useState } from "react";
import { ImportFlow } from "../ImportFlow";
import { useStoreCategoryLabels } from "../StoreCategoryChips";

type Way = "team" | "import" | "blank";

/** How the space starts: a ready team for the areas picked, agents brought in, or just the Chief. */
export function StartStep({ onDone }: { onDone: (picks: OnboardingPicks) => void }) {
  const [screen, setScreen] = useState<"start" | "import">("start");
  const labels = useStoreCategoryLabels();
  const [way, setWay] = useState<Way>("team");
  // In the order tapped: the first one decides which agent is made.
  const [picked, setPicked] = useState<readonly StoreCategory[]>([]);

  function toggle(category: StoreCategory) {
    setPicked((current) =>
      current.includes(category)
        ? current.filter((item) => item !== category)
        : [...current, category],
    );
  }

  const card = (value: Way) =>
    `w-full rounded-xl border p-4 text-left motion-safe:transition-colors ${
      way === value ? "border-foreground bg-muted" : "border-border hover:bg-muted/50"
    }`;

  if (screen === "import") {
    return (
      <div>
        <h1 className="mb-6 text-[32px] font-medium text-foreground">
          <Trans>Import</Trans>
        </h1>
        <ImportFlow onBack={() => setScreen("start")} onFinish={() => onDone({ categories: [] })} />
      </div>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onDone({ categories: way === "team" ? [...picked] : [] });
      }}
    >
      <h1 className="text-[32px] font-medium text-foreground">
        <Trans>How do you want to start?</Trans>
      </h1>
      <div className="mt-6 flex flex-col gap-2">
        <div className={card("team")}>
          <button
            type="button"
            aria-pressed={way === "team"}
            className="w-full text-left font-medium"
            onClick={() => setWay("team")}
          >
            <Trans>A ready team</Trans>
          </button>
          {way === "team" ? (
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {STORE_CATEGORIES.map((category) => (
                <Button
                  key={category}
                  type="button"
                  size="sm"
                  variant={picked.includes(category) ? "secondary" : "outline"}
                  aria-pressed={picked.includes(category)}
                  onClick={() => toggle(category)}
                >
                  {labels[category]}
                </Button>
              ))}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          className={`${card("import")} font-medium`}
          onClick={() => setScreen("import")}
        >
          <Trans>Import</Trans>
        </button>
        <button
          type="button"
          aria-pressed={way === "blank"}
          className={`${card("blank")} font-medium`}
          onClick={() => setWay("blank")}
        >
          <Trans>Just the Chief</Trans>
        </button>
      </div>
      <Button type="submit" className="mt-8 w-full">
        <Trans>Continue</Trans>
      </Button>
    </form>
  );
}
