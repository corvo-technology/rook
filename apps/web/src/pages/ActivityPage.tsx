import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { Search, SlidersHorizontal } from "lucide-react";
import { useId, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import type { ActivityListFilters } from "../lib/activity-list-filters";
import { emptyActivityFilters } from "../lib/activity-list-filters";
import { ActivityList } from "./ActivityList";

/** Every run in the space, what is working now and what finished, with its search and filters. */
export function ActivityPage() {
  const { t } = useLingui();
  const navigate = useNavigate();
  const [filters, setFilters] = useState<ActivityListFilters>(emptyActivityFilters);
  const [expanded, setExpanded] = useState(false);
  const filtersId = useId();
  const filterCount =
    Number(filters.status !== "all") +
    Number(Boolean(filters.dateRange.from)) +
    Number(Boolean(filters.dateRange.to));
  return (
    <div
      data-testid="activity-page"
      className="flex h-full min-h-0 flex-col overflow-y-auto bg-background text-foreground"
    >
      <PageHeader>{t`Activity`}</PageHeader>
      <div className="mx-auto w-full max-w-3xl px-6 pb-8">
        <InputGroup className="mb-3 w-auto rounded-xl border border-border bg-card text-muted-foreground focus-within:border-ring dark:bg-input">
          <InputGroupAddon>
            <Search size={16} strokeWidth={1.8} aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            value={filters.query}
            onChange={(event) => setFilters({ ...filters, query: event.target.value })}
            placeholder={t`Search runs`}
            aria-label={t`Search runs`}
            autoComplete="off"
            name="activity-search"
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              size="icon-sm"
              aria-label={t`Filters`}
              aria-expanded={expanded}
              aria-controls={filtersId}
              onClick={() => setExpanded((open) => !open)}
              className="relative rounded-lg"
            >
              <SlidersHorizontal size={16} aria-hidden="true" />
              {filterCount > 0 ? (
                <span
                  data-testid="activity-filter-indicator"
                  aria-hidden="true"
                  className="absolute end-1 top-1 size-1.5 rounded-full bg-primary"
                />
              ) : null}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        <ActivityList
          filters={filters}
          onFiltersChange={setFilters}
          filtersExpanded={expanded}
          filtersId={filtersId}
          onOpenRun={(run) => navigate(run.groupId ? `/app/g/${run.groupId}` : `/app/${run.botId}`)}
        />
      </div>
    </div>
  );
}
