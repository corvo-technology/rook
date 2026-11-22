import type { ReactNode } from "react";

/** A soft card of Home with a dithered band at its foot. */
export function HomeCard({
  title,
  testId,
  action,
  className = "",
  band = true,
  children,
}: {
  title: ReactNode;
  testId: string;
  action?: ReactNode;
  className?: string;
  /** The dithered band at the foot. */
  band?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      data-testid={testId}
      className={`${band ? "rk-home-dither" : ""} flex min-h-56 flex-col rounded-3xl border border-border bg-muted/50 p-5 ${className}`}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold">{title}</h2>
        <div className="flex items-center gap-1">{action}</div>
      </div>
      {children}
    </section>
  );
}

export const cardLink =
  "rounded text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";
