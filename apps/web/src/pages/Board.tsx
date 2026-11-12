import { ChatMarkdown } from "@corvo/chat-ui/web";
import type { Bot, Ticket, TicketField, TicketPriority, TicketStatus } from "@corvo/contracts";
import {
  TICKET_COMMENT_MAX_LENGTH,
  TICKET_DESCRIPTION_MAX_LENGTH,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  TICKET_TITLE_MAX_LENGTH,
} from "@corvo/contracts";
import { fetchFresh, writeSaved } from "@corvo/core/query";
import {
  Button,
  buttonVariants,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  NativeSelect,
  NativeSelectOption,
  Textarea,
} from "@corvo/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Settings2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { followBoard } from "../lib/board-stream";
import { useSpaceQueries } from "../lib/query";
import { formatRelativeTime } from "../lib/relative-time";
import { rpc } from "../lib/rpc";
import { fieldChanges } from "../lib/ticket-fields";
import { useTicketPriorityLabels } from "../lib/ticket-priority";
import { useTicketStatusLabels } from "../lib/ticket-status";
import { errorText } from "../lib/user-error";
import { BoardSettings } from "./BoardSettings";
import { BoardLanes } from "./board/BoardLanes";
import { placeSaved } from "./board/board-drag";
import type { BoardSteps } from "./board/board-steps";
import { applyBoardStep, boardEventChangesList } from "./board/board-steps";
import { useTicketMoves } from "./board/use-ticket-moves";
import { TicketFields } from "./TicketFields";
import { WindowChrome } from "./WindowChrome";

export function BoardPage() {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const boardOptions = queries.boards.get.queryOptions();
  const boardQuery = useQuery(boardOptions);
  const statuses = useTicketStatusLabels(boardQuery.data?.statusLabels);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const ticketsOptions = queries.tickets.list.queryOptions({ input: {} });
  const ticketsQuery = useQuery(ticketsOptions);
  const botsQuery = useQuery(queries.bots.list.queryOptions());
  const tickets = ticketsQuery.data?.tickets ?? [];
  const bots = botsQuery.data ?? [];
  const [selected, setSelected] = useState<Ticket | { newIn: TicketStatus } | null>(null);
  const [ownerFilter, setOwnerFilter] = useState("");
  const [searchParams] = useSearchParams();
  const wantedRef = searchParams.get("ticket")?.toLowerCase();
  const openedRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    // An address that names a ticket opens it once, as a link from the Team screen does.
    if (!wantedRef || openedRef.current === wantedRef) return;
    const found = tickets.find((ticket) => ticket.ref.toLowerCase() === wantedRef);
    if (!found) return;
    openedRef.current = wantedRef;
    setSelected(found);
  }, [tickets, wantedRef]);
  const visible = ownerFilter
    ? tickets.filter((ticket) => ticket.assigneeBotId === ownerFilter)
    : tickets;
  const [streamError, setError] = useState("");
  const [moveError, setMoveError] = useState("");
  const [steps, setSteps] = useState<BoardSteps>(new Map());
  const loadFailed = ticketsQuery.error ?? botsQuery.error;
  const error = moveError || streamError || (loadFailed ? errorText(loadFailed) : "");
  /** A read sent after a change, so an older one in flight cannot bring back the old board. */
  const reload = () => fetchFresh(queryClient, ticketsOptions).then(() => undefined);
  const { placement, move } = useTicketMoves({
    save: (input) => rpc.tickets.move(input),
    onSaved: async (saved) => {
      await writeSaved(queryClient, ticketsOptions.queryKey, (current) => ({
        ...current,
        tickets: placeSaved(current?.tickets ?? [], saved),
      }));
      // Bots may answer the move; the next read brings what they changed.
      void fetchFresh(queryClient, ticketsOptions).catch(() => undefined);
    },
    onError: (cause) => setMoveError(errorText(cause)),
  });

  useEffect(() => {
    // Live events refresh the board and any open ticket's comments.
    const refreshComments = (ticketId?: string) =>
      void queryClient.invalidateQueries({
        queryKey: ticketId
          ? queries.tickets.comments.queryKey({ input: { ticketId } })
          : queries.tickets.comments.key(),
      });
    return followBoard({
      subscribe: (signal) => rpc.boards.subscribe(undefined, { signal }),
      onOpen: async () => {
        // A step missed while disconnected would never be cleared, so start from none.
        setSteps(new Map());
        await fetchFresh(queryClient, ticketsOptions);
        refreshComments();
        setError("");
      },
      onEvent: async (event) => {
        setSteps((current) => applyBoardStep(current, event));
        if (!boardEventChangesList(event)) return;
        refreshComments(event.ticketId);
        await fetchFresh(queryClient, ticketsOptions);
      },
      onError: (cause) => setError(errorText(cause)),
    });
  }, [queries]);

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden bg-background text-foreground">
      <WindowChrome />
      <header className="flex items-center gap-3 border-b px-4 py-3">
        <Link
          to="/app"
          className={buttonVariants({ variant: "ghost", size: "icon" })}
          aria-label={t`Back`}
        >
          <ChevronLeft />
        </Link>
        <h1 className="flex-1 font-display text-heading3 font-normal tracking-tight">
          <Trans>Tasks</Trans>
        </h1>
        {bots.length > 1 ? (
          <NativeSelect
            aria-label={t`Owner`}
            className="w-auto"
            value={ownerFilter}
            onChange={(event) => setOwnerFilter(event.target.value)}
          >
            <NativeSelectOption value="">{t`All`}</NativeSelectOption>
            {bots.map((bot) => (
              <NativeSelectOption key={bot.id} value={bot.id}>
                {bot.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        ) : null}
        {boardQuery.data ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label={t`Task settings`}
            onClick={() => setSettingsOpen(true)}
          >
            <Settings2 />
          </Button>
        ) : null}
        <Button onClick={() => setSelected({ newIn: "todo" })} disabled={bots.length === 0}>
          <Trans>New ticket</Trans>
        </Button>
      </header>
      {error ? (
        <p role="alert" className="px-4 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <main className="rk-scroll relative min-h-0 min-w-0 flex-1 overflow-auto p-4">
        <BoardLanes
          tickets={visible}
          bots={bots}
          labels={statuses}
          placement={placement}
          steps={steps}
          onOpen={setSelected}
          onMove={(ticket, status) => {
            setMoveError("");
            void move(ticket, status);
          }}
          onAdd={bots.length > 0 ? (status) => setSelected({ newIn: status }) : undefined}
        />
        {tickets.length === 0 && !error ? (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            <Trans>No tickets yet</Trans>
          </p>
        ) : null}
      </main>
      {settingsOpen && boardQuery.data ? (
        <BoardSettings
          board={boardQuery.data}
          onClose={() => setSettingsOpen(false)}
          onSave={async (changes) => {
            await rpc.boards.rename({ statusLabels: changes });
            await fetchFresh(queryClient, boardOptions);
          }}
        />
      ) : null}
      {selected ? (
        <TicketDialog
          key={"newIn" in selected ? `new-${selected.newIn}` : selected.id}
          ticket={"newIn" in selected ? null : selected}
          createIn={"newIn" in selected ? selected.newIn : "todo"}
          bots={bots}
          statuses={statuses}
          onClose={() => setSelected(null)}
          onSaved={reload}
        />
      ) : null}
    </div>
  );
}

function TicketDialog({
  ticket,
  createIn,
  bots,
  statuses,
  onClose,
  onSaved,
}: {
  ticket: Ticket | null;
  /** The column a new ticket goes to; tickets start in To do and move there once created. */
  createIn: TicketStatus;
  statuses: Record<TicketStatus, string>;
  bots: Bot[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useLingui();
  const formId = useId();
  const priorities = useTicketPriorityLabels();
  const [title, setTitle] = useState(ticket?.title ?? "");
  const [description, setDescription] = useState(ticket?.description ?? "");
  const [owner, setOwner] = useState(ticket?.assigneeBotId ?? bots[0]?.id ?? "");
  const [status, setStatus] = useState<TicketStatus>(ticket?.status ?? "todo");
  const [priority, setPriority] = useState<TicketPriority>(ticket?.priority ?? "normal");
  const [fields, setFields] = useState<TicketField[]>(ticket?.fields ?? []);
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const commentsOptions = queries.tickets.comments.queryOptions({
    input: ticket ? { ticketId: ticket.id } : skipToken,
  });
  const commentsQuery = useQuery(commentsOptions);
  const comments = commentsQuery.data ?? [];
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const shownError = error || (commentsQuery.error ? errorText(commentsQuery.error) : "");

  const changedFields = ticket ? fieldChanges(ticket.fields, fields) : {};

  async function save() {
    setBusy(true);
    setError("");
    try {
      if (ticket)
        await rpc.tickets.update({
          id: ticket.id,
          ...(title !== ticket.title ? { title } : {}),
          ...(description !== (ticket.description ?? "") ? { description } : {}),
          ...(owner !== (ticket.assigneeBotId ?? bots[0]?.id ?? "")
            ? { assigneeBotId: owner }
            : {}),
          ...(status !== ticket.status ? { status } : {}),
          ...(priority !== ticket.priority ? { priority } : {}),
          ...(Object.keys(changedFields).length > 0 ? { fields: changedFields } : {}),
        });
      else {
        const created = await rpc.tickets.create({
          title,
          description,
          assigneeBotId: owner,
          priority,
        });
        if (createIn !== "todo") await rpc.tickets.move({ id: created.id, status: createIn });
      }
      await onSaved();
      onClose();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }
  async function comment() {
    if (!ticket) return;
    setBusy(true);
    setError("");
    try {
      const row = await rpc.tickets.comment({ ticketId: ticket.id, body });
      const options = queries.tickets.comments.queryOptions({ input: { ticketId: ticket.id } });
      // A list already on screen shows the comment at once, unless a read already brought it.
      if (queryClient.getQueryData(options.queryKey)) {
        await writeSaved(queryClient, options.queryKey, (previous = []) =>
          previous.some((item) => item.id === row.id) ? previous : [...previous, row],
        );
      }
      setBody("");
      // Saving cancelled any read in flight, so the whole list is read again after the post.
      void fetchFresh(queryClient, options).catch(() => undefined);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{ticket?.title ?? t`New ticket`}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label htmlFor={`${formId}-title`} className="block space-y-1 text-sm">
            <span>
              <Trans>Title</Trans>
            </span>
            <Input
              id={`${formId}-title`}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={TICKET_TITLE_MAX_LENGTH}
              required
            />
          </label>
          <label htmlFor={`${formId}-description`} className="block space-y-1 text-sm">
            <span>
              <Trans>Description</Trans>
            </span>
            <Textarea
              id={`${formId}-description`}
              data-testid="ticket-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={TICKET_DESCRIPTION_MAX_LENGTH}
            />
          </label>
          <label htmlFor={`${formId}-owner`} className="block space-y-1 text-sm">
            <span>
              <Trans>Owner</Trans>
            </span>
            <NativeSelect
              className="w-full"
              id={`${formId}-owner`}
              value={owner}
              onChange={(event) => setOwner(event.target.value)}
              required
            >
              {bots.map((bot) => (
                <NativeSelectOption key={bot.id} value={bot.id}>
                  {bot.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          {ticket ? (
            <label htmlFor={`${formId}-status`} className="block space-y-1 text-sm">
              <span>
                <Trans>Status</Trans>
              </span>
              <NativeSelect
                className="w-full"
                id={`${formId}-status`}
                value={status}
                onChange={(event) => setStatus(event.target.value as TicketStatus)}
              >
                {TICKET_STATUSES.map((value) => (
                  <NativeSelectOption key={value} value={value}>
                    {statuses[value]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
          ) : null}
          <label htmlFor={`${formId}-priority`} className="block space-y-1 text-sm">
            <span>
              <Trans>Priority</Trans>
            </span>
            <NativeSelect
              className="w-full"
              id={`${formId}-priority`}
              value={priority}
              onChange={(event) => setPriority(event.target.value as TicketPriority)}
            >
              {TICKET_PRIORITIES.map((value) => (
                <NativeSelectOption key={value} value={value}>
                  {priorities[value]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          {ticket ? <TicketFields rows={fields} onChange={setFields} /> : null}
          <div className="flex justify-end">
            <Button type="submit" disabled={busy || !title.trim() || !owner}>
              {ticket ? t`Save` : t`Create`}
            </Button>
          </div>
        </form>
        {ticket ? (
          <div data-testid="ticket-comments" className="space-y-3 border-t pt-3">
            {comments.map((row) => (
              <div key={row.id} className="text-sm">
                <div className="mb-1 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span>{row.authorName}</span>
                  <time dateTime={row.createdAt}>{formatRelativeTime(row.createdAt)}</time>
                </div>
                <ChatMarkdown>{row.body}</ChatMarkdown>
              </div>
            ))}
            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                void comment();
              }}
            >
              <Textarea
                aria-label={t`Comment`}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                maxLength={TICKET_COMMENT_MAX_LENGTH}
              />
              <div className="flex justify-end">
                <Button type="submit" disabled={busy || !body.trim()}>
                  <Trans>Comment</Trans>
                </Button>
              </div>
            </form>
          </div>
        ) : null}
        {shownError ? (
          <p role="alert" className="text-sm text-destructive">
            {shownError}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
