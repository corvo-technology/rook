import { Trans } from "@lingui/react/macro";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { useSpaceRpc } from "../lib/space-rpc";
import { WikiBrowser } from "./WikiBrowser";

/** What the team knows, as pages that link to each other and that the agents read and cite. */
export function WikiPage() {
  const rpc = useSpaceRpc();
  const [params, setParams] = useSearchParams();
  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <PageHeader width="full">
        <Trans>Wiki</Trans>
      </PageHeader>
      <WikiBrowser
        api={rpc.wiki}
        title={params.get("page")}
        onOpen={(next) => setParams(next ? { page: next } : {})}
      />
    </div>
  );
}
