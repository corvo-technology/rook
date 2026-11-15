import { Trans } from "@lingui/react/macro";
import { useSearchParams } from "react-router-dom";
import { useSpaceRpc } from "../lib/space-rpc";
import { WikiBrowser } from "./WikiBrowser";

/** What the team knows, as pages that link to each other and that the agents read and cite. */
export function WikiPage() {
  const rpc = useSpaceRpc();
  const [params, setParams] = useSearchParams();
  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <h1 className="px-6 py-4 text-xl font-light tracking-tight">
        <Trans>Wiki</Trans>
      </h1>
      <WikiBrowser
        api={rpc.wiki}
        title={params.get("page")}
        onOpen={(next) => setParams(next ? { page: next } : {})}
      />
    </div>
  );
}
