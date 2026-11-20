import type { ReactNode } from "react";

/** The one look of a page title, for pages whose header holds more than controls. */
export function PageTitle({ children }: { children: ReactNode }) {
  return <h1 className="min-w-0 text-xl font-light tracking-tight">{children}</h1>;
}

const widths = { prose: "max-w-3xl", wide: "max-w-5xl", full: "" } as const;

/** The title of a top-level page: one size, weight and place everywhere. A way back goes in `leading`, page controls in `actions`. */
export function PageHeader({
  children,
  leading,
  actions,
  width = "prose",
  flush,
}: {
  children: ReactNode;
  leading?: ReactNode;
  actions?: ReactNode;
  width?: keyof typeof widths;
  /** Drop the side padding when the page already pads its content. */
  flush?: boolean;
}) {
  return (
    <header
      className={`mx-auto flex w-full flex-wrap items-center gap-x-3 gap-y-2 pt-6 pb-4 ${flush ? "" : "px-6"} ${widths[width]}`}
    >
      {leading}
      <PageTitle>{children}</PageTitle>
      {actions ? <div className="ms-auto flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}
