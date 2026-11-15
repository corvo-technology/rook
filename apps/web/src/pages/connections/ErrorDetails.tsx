import { Disclosure } from "@corvo/ui-web";
import { Trans } from "@lingui/react/macro";

/** The raw log of a server that is not working, behind a disclosure so the row stays compact. */
export function ErrorDetails({ message }: { message: string }) {
  return (
    <Disclosure
      data-testid="mcp-health-details"
      className="mt-1"
      summary={<Trans>Error details</Trans>}
      summaryClassName="text-[11px] text-muted-foreground"
    >
      <pre
        dir="ltr"
        className="rk-scroll mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-muted p-2 text-start font-mono text-[11px] leading-snug text-foreground wrap-anywhere"
      >
        {message}
      </pre>
    </Disclosure>
  );
}
