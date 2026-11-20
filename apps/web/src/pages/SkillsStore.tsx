import type { SkillStoreEntry, StoreCategory } from "@corvo/contracts";
import { agentCatalogLocale, STORE_CATEGORIES } from "@corvo/contracts";
import { SKILL_STORE } from "@corvo/core";
import { Button } from "@corvo/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  CalendarDays,
  Check,
  FileText,
  ListChecks,
  Mail,
  Megaphone,
  Package,
  Palette,
  Search,
  SquareCode,
  Users,
  Wallet,
} from "lucide-react";
import type { ComponentType } from "react";
import { useState } from "react";
import { useSpaceQueries } from "../lib/query";
import { installStoreSkill, isSkillInstalled } from "../lib/skill-store-install";
import { errorText } from "../lib/user-error";
import { StoreCategoryChips } from "./StoreCategoryChips";

const ICONS: Record<SkillStoreEntry["icon"], ComponentType<{ className?: string }>> = {
  code: SquareCode,
  search: Search,
  check: Check,
  mail: Mail,
  list: ListChecks,
  file: FileText,
  money: Wallet,
  chart: BarChart3,
  megaphone: Megaphone,
  palette: Palette,
  calendar: CalendarDays,
  users: Users,
  box: Package,
};

/** Ready-made skills: instructions that teach an agent a task. Installing one adds it for every agent. */
export function SkillsStore({ query }: { query: string }) {
  const { t, i18n } = useLingui();
  const locale = agentCatalogLocale(i18n.locale);
  const skillsOptions = useSpaceQueries().agentSkills.list.queryOptions();
  const skills = useQuery(skillsOptions);
  const [category, setCategory] = useState<StoreCategory | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const installed = (skills.data ?? []).map((skill) => skill.name);

  async function install(entry: SkillStoreEntry) {
    setPending(entry.slug);
    setError(null);
    try {
      await installStoreSkill(entry, locale);
      await skills.refetch();
    } catch (err) {
      setError(errorText(err, t`Could not install the skill`));
    } finally {
      setPending(null);
    }
  }

  const needle = query.trim().toLowerCase();
  const entries = SKILL_STORE.filter(
    (entry) =>
      (!category || entry.category === category) &&
      (!needle ||
        `${entry.name[locale]} ${entry.description[locale]}`.toLowerCase().includes(needle)),
  );
  const categories = STORE_CATEGORIES.filter((item) =>
    SKILL_STORE.some((entry) => entry.category === item),
  );

  return (
    <div data-testid="skill-store">
      <StoreCategoryChips categories={categories} value={category} onChange={setCategory} />
      {entries.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          <Trans>No results</Trans>
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {entries.map((entry) => {
          const Icon = ICONS[entry.icon];
          const done = isSkillInstalled(entry, installed);
          return (
            <div
              key={entry.slug}
              data-testid={`skill-card-${entry.slug}`}
              className="flex min-w-0 flex-col gap-3 rounded-2xl border border-border p-4"
            >
              <div className="flex items-center gap-3">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent text-foreground">
                  <Icon className="size-5" />
                </div>
                <div className="min-w-0 flex-1 truncate text-[15.5px] font-medium">
                  {entry.name[locale]}
                </div>
                {done ? (
                  <span className="flex shrink-0 items-center gap-1 text-[13px] text-muted-foreground">
                    <Check className="size-4" />
                    <Trans>Installed</Trans>
                  </span>
                ) : (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={pending === entry.slug || skills.isPending}
                    onClick={() => void install(entry)}
                  >
                    <Trans>Install</Trans>
                  </Button>
                )}
              </div>
              <p className="text-[14px] leading-snug text-foreground/75">
                {entry.description[locale]}
              </p>
            </div>
          );
        })}
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-[13px] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
