import { useLingui } from "@lingui/react/macro";
import { ArrowLeft, ArrowRight, EyeOff } from "lucide-react";
import type { ReactNode } from "react";

/** A soft card of Home with a dithered band at its foot; in organize mode it can move or hide. */
export function HomeCard({
  title,
  name,
  testId,
  action,
  organizing,
  onMove,
  onHide,
  className = "",
  band = true,
  children,
}: {
  title: ReactNode;
  /** The title as plain text, for the accessible names of the organize controls. */
  name: string;
  testId: string;
  action?: ReactNode;
  organizing: boolean;
  onMove: (by: -1 | 1) => void;
  onHide: () => void;
  className?: string;
  /** The dithered band at the foot. */
  band?: boolean;
  children: ReactNode;
}) {
  const { t } = useLingui();
  const tool =
    "grid size-7 place-items-center rounded-full text-muted-foreground outline-none hover:bg-foreground/8 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <section
      data-testid={testId}
      className={`${band ? "rk-home-dither" : ""} flex min-h-56 flex-col rounded-3xl border border-border bg-muted/50 p-5 ${className}`}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold">{title}</h2>
        <div className="flex items-center gap-1">
          {organizing ? (
            <>
              <button
                type="button"
                aria-label={t`Move ${name} earlier`}
                className={tool}
                onClick={() => onMove(-1)}
              >
                <ArrowLeft aria-hidden className="size-3.5" />
              </button>
              <button
                type="button"
                aria-label={t`Move ${name} later`}
                className={tool}
                onClick={() => onMove(1)}
              >
                <ArrowRight aria-hidden className="size-3.5" />
              </button>
              <button type="button" aria-label={t`Hide ${name}`} className={tool} onClick={onHide}>
                <EyeOff aria-hidden className="size-3.5" />
              </button>
            </>
          ) : (
            action
          )}
        </div>
      </div>
      {children}
    </section>
  );
}

export const cardLink =
  "rounded text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";
