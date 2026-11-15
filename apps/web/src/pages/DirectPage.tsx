import { EmptyState } from "@corvo/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { ChevronLeft } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { PeopleList } from "../components/PeopleList";
import { authClient } from "../lib/auth";
import { useDirectPeople } from "../lib/use-direct-people";
import { DirectChat } from "./DirectChat";
import { WindowChrome } from "./WindowChrome";

/** The people of the space and the conversation open with one of them. */
export function DirectPage() {
  const { t } = useLingui();
  const { userId } = useParams();
  const navigate = useNavigate();
  const session = authClient.useSession();
  const people = useDirectPeople();
  const currentUserId = session.data?.user.id ?? "";
  return (
    <div className="flex h-full min-h-0 bg-background text-foreground">
      <aside
        className={`${userId ? "hidden md:flex" : "flex"} w-full shrink-0 flex-col gap-3 border-e border-sidebar-border bg-sidebar px-2.5 pt-3 md:w-64`}
      >
        <div className="app-drag flex items-center px-2">
          <WindowChrome />
        </div>
        <h1 className="px-2.5 text-[11px] font-semibold uppercase tracking-wider">
          <Trans>People</Trans>
        </h1>
        <PeopleList
          people={people.data ?? []}
          activeUserId={userId}
          onOpen={(id) => navigate(`/app/dm/${id}`)}
        />
      </aside>
      <main className={`${userId ? "flex" : "hidden md:flex"} min-w-0 flex-1 flex-col`}>
        {userId ? (
          <>
            <button
              type="button"
              aria-label={t`Back`}
              onClick={() => navigate("/app/dm")}
              className="flex items-center gap-1 px-3 pt-3 text-sm text-muted-foreground md:hidden"
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <DirectChat key={userId} userId={userId} currentUserId={currentUserId} />
          </>
        ) : (
          <EmptyState title={t`Pick someone to write to`} className="m-auto" />
        )}
      </main>
    </div>
  );
}
