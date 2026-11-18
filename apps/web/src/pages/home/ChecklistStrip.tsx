import type { Bot, HomeChecklist, HomeChecklistItemId } from "@corvo/contracts";
import { BotAvatar } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { Check, ChevronDown } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

/** A full-width row of what is left of getting started; it opens on a click and is gone when done. */
export function ChecklistStrip({
  list,
  chief,
  labels,
  target,
}: {
  list: HomeChecklist;
  chief?: Bot;
  labels: Record<HomeChecklistItemId, string>;
  target: (id: HomeChecklistItemId) => string;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const { done, total } = list;
  if (done >= total) return null;
  return (
    <section
      data-testid="home-checklist"
      className="rounded-2xl border border-border bg-card/70 shadow-sm"
    >
      <button
        type="button"
        aria-expanded={open}
        className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-start outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setOpen((value) => !value)}
      >
        {chief ? <BotAvatar color={chief.color} identity={chief.id} size={28} /> : null}
        <span className="flex-1 text-sm font-medium">
          {t`Pick up where you left off · ${done} of ${total}`}
        </span>
        <span aria-hidden className="hidden h-1 w-24 gap-1 sm:flex">
          {list.items.map((item) => (
            <span
              key={item.id}
              className={`h-full flex-1 rounded-full ${item.done ? "bg-foreground" : "bg-border"}`}
            />
          ))}
        </span>
        <ChevronDown
          aria-hidden
          className={`size-4 text-muted-foreground transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open ? (
        <ul className="rk-home-row-in flex flex-wrap gap-2 px-4 pb-4">
          {list.items.map((item) => (
            <li key={item.id}>
              <Link
                to={target(item.id)}
                className={`rk-home-lift inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-[13px] outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring ${
                  item.done ? "text-muted-foreground line-through" : ""
                }`}
              >
                {item.done ? <Check aria-hidden className="size-3" /> : null}
                {labels[item.id]}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
