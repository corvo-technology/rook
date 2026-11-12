import { RookGlyph } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";

/** A whole-page wait: the rook folding into a spinner. It fades in late, so a quick load paints nothing in between. */
export function PageLoading(props: React.ComponentPropsWithoutRef<"div">) {
  const { t } = useLingui();
  return (
    <div className="grid h-full place-items-center bg-background" {...props}>
      <span
        role="status"
        aria-label={t`Loading…`}
        className="animate-in fade-in-0 fill-mode-both delay-500 duration-300 motion-reduce:animate-none"
      >
        <RookGlyph state="loading" size={28} className="text-muted-foreground" />
      </span>
    </div>
  );
}
