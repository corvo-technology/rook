import { AgentLoader } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";

/** A whole-page wait: the rook, thinking and then working. It fades in late, so a quick load paints nothing in between. */
export function PageLoading(props: React.ComponentPropsWithoutRef<"div">) {
  const { t } = useLingui();
  return (
    <div className="grid h-full place-items-center bg-background" {...props}>
      <span className="animate-in fade-in-0 fill-mode-both delay-500 duration-300 motion-reduce:animate-none">
        <AgentLoader size={44} label={t`Loading…`} />
      </span>
    </div>
  );
}
