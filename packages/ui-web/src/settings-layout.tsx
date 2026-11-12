import { ChevronLeft } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { useEffect, useRef } from "react";
import { Button } from "./components/ui/button.js";
import { cn } from "./lib/utils.js";

export type SettingsLayoutSection = {
  id: string;
  label: string;
  icon?: ComponentType<{ className?: string; strokeWidth?: number }>;
};

export type SettingsLayoutProps = {
  /** The page name, shown beside the back arrow ("Settings"). */
  title: string;
  /** Where the arrow and Esc go: the router sends the person back to where they came from. */
  onBack: () => void;
  sections: readonly SettingsLayoutSection[];
  activeId: string;
  /** Navigate to the section's own route. */
  onSelect: (id: string) => void;
  /** Optional title override for the content; defaults to the active section's label. */
  heading?: ReactNode;
  /** Content width: `prose` (max-w-2xl, default) or `full` for tables. */
  width?: "prose" | "full";
  children: ReactNode;
};

/**
 * The whole-page shell for Settings: a left nav (a scrolling row on narrow screens) and one
 * section on the right. It owns no routing; the app maps `activeId`/`onSelect` to a route per
 * section (`/settings/:section`) so deep links and reloads work. Esc calls `onBack` unless a menu
 * or a field is handling it.
 */
export function SettingsLayout({
  title,
  onBack,
  sections,
  activeId,
  onSelect,
  heading,
  width = "prose",
  children,
}: SettingsLayoutProps) {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  const active = sections.find((section) => section.id === activeId);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("input, textarea, select")) return;
      if (document.querySelector('[role="listbox"], [role="menu"], [role="dialog"]')) return;
      event.preventDefault();
      onBackRef.current();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div
      data-testid="settings-page"
      data-settings-section={activeId}
      className="flex h-full min-h-0 flex-col bg-background text-foreground md:flex-row"
    >
      <div className="flex shrink-0 flex-col gap-1 border-b border-border px-3 pt-3 md:w-60 md:border-e md:border-b-0 md:px-4 md:pt-5">
        <Button
          variant="text"
          className="h-9 justify-start gap-1.5 px-1 text-heading3"
          data-testid="settings-back"
          onClick={onBack}
        >
          <ChevronLeft className="rtl:rotate-180" />
          {title}
        </Button>
        <nav
          aria-label={title}
          data-testid="settings-nav"
          className="rk-scroll flex flex-row gap-1 overflow-x-auto py-2 md:flex-col md:overflow-y-auto md:py-3"
        >
          {sections.map((section) => {
            const Icon = section.icon;
            const current = section.id === activeId;
            return (
              <button
                key={section.id}
                type="button"
                data-testid={`settings-nav-${section.id}`}
                aria-current={current ? "page" : undefined}
                onClick={() => onSelect(section.id)}
                className={cn(
                  "flex shrink-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-start text-body1 outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                  current
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {Icon ? <Icon className="size-4 shrink-0" strokeWidth={1.75} /> : null}
                <span className="whitespace-nowrap">{section.label}</span>
              </button>
            );
          })}
        </nav>
      </div>
      <main className="rk-scroll min-h-0 min-w-0 flex-1 overflow-y-auto px-6 pb-12 pt-8 md:px-12 md:pt-12">
        <div className={cn("mx-auto space-y-8", width === "prose" ? "max-w-2xl" : "max-w-5xl")}>
          <h1 className="text-title">{heading ?? active?.label}</h1>
          {children}
        </div>
      </main>
    </div>
  );
}
