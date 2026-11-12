import type { Bot, Ticket, TicketStatus } from "@corvo/contracts";
import { TICKET_STATUSES } from "@corvo/contracts";
import { isRunWorking } from "@corvo/core";
import { BotAvatar, cn } from "@corvo/ui-web";
import type {
  Announcements,
  CollisionDetection,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  DropAnimation,
  KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import {
  DndContext,
  DragOverlay,
  defaultDropAnimationSideEffects,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  rectIntersection,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useLingui } from "@lingui/react/macro";
import { Plus } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useMemo, useRef, useState } from "react";
import { useTicketPriorityLabels } from "../../lib/ticket-priority";
import type { Placement } from "./board-drag";
import { arrangeLanes, laneForKey } from "./board-drag";

/** A spring that overshoots a touch, so a dropped card settles instead of stopping dead. */
const SETTLE = "cubic-bezier(0.34, 1.4, 0.64, 1)";
/** First cards fade in one after another; later ones and long lists appear at once. */
const INTRO_MS = 700;
const INTRO_STEP_MS = 35;
const INTRO_MAX = 8;

type Drag = {
  id: string;
  /** The column the card was in when it was picked up, and where in it. */
  from: TicketStatus;
  fromIndex: number;
  over: TicketStatus;
  height: number;
};

/** The pointer decides the column when there is one; the keyboard moves the card's box instead. */
const laneCollision: CollisionDetection = (args) => {
  const under = pointerWithin(args);
  return under.length > 0 ? under : rectIntersection(args);
};

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true
  );
}

export function BoardLanes({
  tickets,
  bots,
  labels,
  placement,
  onOpen,
  onMove,
  onAdd,
}: {
  tickets: readonly Ticket[];
  bots: readonly Bot[];
  labels: Record<TicketStatus, string>;
  placement: Placement;
  onOpen: (ticket: Ticket) => void;
  onMove: (ticket: Ticket, status: TicketStatus) => void;
  onAdd?: (status: TicketStatus) => void;
}) {
  const { t } = useLingui();
  const [drag, setDrag] = useState<Drag | null>(null);
  // The keyboard sensor keeps the options it was started with, so it reads the latest drag here.
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  const mountedAt = useRef(Date.now());
  const intro = Date.now() - mountedAt.current < INTRO_MS;

  const settled = useMemo(() => arrangeLanes(tickets, placement), [tickets, placement]);
  const lanes = useMemo(
    () => (drag ? arrangeLanes(tickets, { ...placement, [drag.id]: drag.over }) : settled),
    [tickets, placement, drag, settled],
  );
  const byId = useMemo(() => new Map(tickets.map((ticket) => [ticket.id, ticket])), [tickets]);
  const botsById = useMemo(() => new Map(bots.map((bot) => [bot.id, bot])), [bots]);
  const held = drag ? byId.get(drag.id) : undefined;
  const refOf = (id: unknown) => byId.get(String(id))?.ref ?? String(id);
  const laneOf = (id: unknown) => labels[id as TicketStatus] ?? String(id);

  const keyboardCoordinates: KeyboardCoordinateGetter = (event, { context }) => {
    const { collisionRect, droppableRects, over } = context;
    const current = (over?.id as TicketStatus | undefined) ?? dragRef.current?.over;
    if (!current || !collisionRect) return undefined;
    const target = laneForKey(event.code, current);
    const rect = target ? droppableRects.get(target) : undefined;
    if (!rect) return undefined;
    event.preventDefault();
    return { x: rect.left + (rect.width - collisionRect.width) / 2, y: rect.top + 40 };
  };
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: keyboardCoordinates,
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] },
    }),
  );

  const announcements: Announcements = {
    onDragStart: ({ active }) => {
      const ref = refOf(active.id);
      return t`Picked up ${ref}.`;
    },
    onDragOver: ({ active, over }) => {
      if (!over) return undefined;
      const ref = refOf(active.id);
      const lane = laneOf(over.id);
      return t`${ref} is over ${lane}.`;
    },
    onDragEnd: ({ active, over }) => {
      const ref = refOf(active.id);
      const lane = laneOf(over?.id ?? drag?.from);
      return over && over.id !== drag?.from
        ? t`Moved ${ref} to ${lane}.`
        : t`${ref} stays in ${lane}.`;
    },
    onDragCancel: ({ active }) => {
      const ref = refOf(active.id);
      const lane = laneOf(drag?.from);
      return t`${ref} stays in ${lane}.`;
    },
  };

  const dropAnimation: DropAnimation | null = prefersReducedMotion()
    ? null
    : {
        duration: 260,
        easing: SETTLE,
        sideEffects: (parts) => {
          // The tilt eases back to flat while the card flies home.
          parts.dragOverlay.node.querySelector("[data-lifted]")?.setAttribute("data-settling", "");
          return defaultDropAnimationSideEffects({ styles: { active: { opacity: "0" } } })(parts);
        },
      };

  function start(event: DragStartEvent) {
    const id = String(event.active.id);
    const ticket = byId.get(id);
    if (!ticket) return;
    const from = placement[id] ?? ticket.status;
    setDrag({
      id,
      from,
      fromIndex: settled[from].findIndex((row) => row.id === id),
      over: from,
      height: event.active.rect.current.initial?.height ?? 0,
    });
  }
  function over(event: DragOverEvent) {
    const lane = event.over?.id as TicketStatus | undefined;
    if (!lane) return;
    setDrag((current) => (current && current.over !== lane ? { ...current, over: lane } : current));
  }
  function end(event: DragEndEvent) {
    const lane = (event.over?.id as TicketStatus | undefined) ?? null;
    const ticket = drag ? byId.get(drag.id) : undefined;
    setDrag(null);
    if (ticket && drag && lane && lane !== drag.from) onMove(ticket, lane);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={laneCollision}
      autoScroll={{ threshold: { x: 0.12, y: 0.15 }, acceleration: 14 }}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable: t`Press space to pick up a ticket, the arrow keys to choose a column, and space again to drop it.`,
        },
      }}
      onDragStart={start}
      onDragOver={over}
      onDragEnd={end}
      onDragCancel={() => setDrag(null)}
    >
      <div data-testid="board-columns" className="flex min-h-full gap-3">
        {TICKET_STATUSES.map((status) => {
          const rows = lanes[status];
          const leaving = drag && drag.from === status && drag.over !== status;
          const lane = labels[status];
          return (
            <Lane
              key={status}
              status={status}
              label={lane}
              count={settled[status].length}
              onAdd={onAdd}
              addLabel={t`Add a ticket to ${lane}`}
            >
              {rows.flatMap((ticket, index) => {
                const card = (
                  <BoardCard
                    key={ticket.id}
                    ticket={ticket}
                    bot={ticket.assigneeBotId ? botsById.get(ticket.assigneeBotId) : undefined}
                    opening={drag?.id === ticket.id && drag.over !== drag.from}
                    introDelay={intro && index < INTRO_MAX ? index * INTRO_STEP_MS : undefined}
                    onOpen={() => onOpen(ticket)}
                  />
                );
                return leaving && index === drag.fromIndex
                  ? [<Closing key={`closing-${drag.id}`} height={drag.height} />, card]
                  : [card];
              })}
              {leaving && drag.fromIndex >= rows.length ? (
                <Closing key={`closing-${drag.id}`} height={drag.height} />
              ) : null}
            </Lane>
          );
        })}
      </div>
      <DragOverlay dropAnimation={dropAnimation}>
        {held ? (
          <div data-lifted="" className="rk-board-lifted cursor-grabbing rounded-[18px] shadow-2xl">
            <CardFace
              ticket={held}
              bot={held.assigneeBotId ? botsById.get(held.assigneeBotId) : undefined}
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function Lane({
  status,
  label,
  count,
  addLabel,
  onAdd,
  children,
}: {
  status: TicketStatus;
  label: string;
  count: number;
  addLabel: string;
  onAdd?: (status: TicketStatus) => void;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <section
      ref={setNodeRef}
      data-testid={`board-lane-${status}`}
      data-over={isOver ? "" : undefined}
      className="flex min-w-40 flex-1 flex-col rounded-[22px] bg-muted/60 p-1.5 ring-1 ring-transparent ring-inset transition-[background-color,box-shadow] duration-200 data-[over]:bg-accent data-[over]:ring-border motion-reduce:transition-none"
    >
      <header className="flex h-9 items-center gap-2 pr-0.5 pl-2.5">
        <h2 className="truncate font-display text-body2 font-medium tracking-tight">{label}</h2>
        <span className="font-mono text-caption text-faint-foreground tabular-nums">{count}</span>
        {onAdd ? (
          <button
            type="button"
            aria-label={addLabel}
            onClick={() => onAdd(status)}
            className="ml-auto grid size-7 shrink-0 place-items-center rounded-full text-faint-foreground transition-colors duration-150 hover:bg-background/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
          >
            <Plus className="size-3.5" />
          </button>
        ) : null}
      </header>
      <div className="flex min-h-16 flex-1 flex-col px-0.5 pt-0.5 pb-1">{children}</div>
    </section>
  );
}

function BoardCard({
  ticket,
  bot,
  opening,
  introDelay,
  onOpen,
}: {
  ticket: Ticket;
  bot: Bot | undefined;
  opening: boolean;
  introDelay: number | undefined;
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: ticket.id });
  const intro: CSSProperties | undefined =
    introDelay === undefined
      ? undefined
      : { animationDelay: `${introDelay}ms`, animationFillMode: "backwards" };
  return (
    <div className={cn("grid", opening && "rk-board-open")}>
      <div className={cn("min-h-0 pb-1.5", opening && "overflow-hidden")}>
        <button
          ref={setNodeRef}
          type="button"
          {...attributes}
          {...listeners}
          data-testid={`board-card-${ticket.id}`}
          data-dragging={isDragging ? "" : undefined}
          onClick={onOpen}
          style={intro}
          className={cn(
            "group block w-full cursor-grab touch-manipulation rounded-[18px] text-left outline-none transition-[transform,box-shadow] duration-200 ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-muted motion-reduce:transition-none",
            !isDragging &&
              "hover:-translate-y-px hover:shadow-md active:scale-[0.98] motion-reduce:hover:translate-y-0",
            isDragging && "cursor-grabbing",
            intro &&
              "animate-in fade-in-0 slide-in-from-bottom-1 duration-300 motion-reduce:animate-none",
          )}
        >
          <CardFace ticket={ticket} bot={bot} hollow={isDragging} />
        </button>
      </div>
    </div>
  );
}

/** What a card shows; hollow keeps its size as the space a dragged card will land in. */
function CardFace({
  ticket,
  bot,
  hollow = false,
}: {
  ticket: Ticket;
  bot: Bot | undefined;
  hollow?: boolean;
}) {
  const priorities = useTicketPriorityLabels();
  const flagged = ticket.priority === "high" || ticket.priority === "urgent";
  const working = ticket.status === "doing" && isRunWorking(bot?.status ?? "");
  return (
    <div
      className={cn(
        "rounded-[18px] border p-3 transition-colors duration-150 motion-reduce:transition-none",
        hollow ? "border-dashed border-border bg-background/40" : "border-border bg-card",
      )}
    >
      <div className={cn("space-y-1.5", hollow && "invisible")}>
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-caption text-faint-foreground">{ticket.ref}</span>
          {flagged ? (
            <span
              className={cn(
                "rounded-full border px-1.5 text-caption",
                ticket.priority === "urgent"
                  ? "border-destructive/30 text-destructive"
                  : "border-border text-muted-foreground",
              )}
            >
              {priorities[ticket.priority]}
            </span>
          ) : null}
        </div>
        <p className="line-clamp-3 text-body1 font-medium text-card-foreground">{ticket.title}</p>
        {bot ? (
          <div className="flex items-center gap-2 pt-1 text-label text-muted-foreground">
            <span data-working={working ? "" : undefined} className="relative inline-flex shrink-0">
              <BotAvatar
                color={bot.color}
                identity={bot.id}
                size={18}
                status={working ? bot.status : undefined}
              />
            </span>
            <span className="truncate">{bot.name}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** The room a dragged card leaves behind, closing smoothly so the cards below slide up. */
function Closing({ height }: { height: number }) {
  return (
    <div className="rk-board-close grid" aria-hidden="true">
      <div className="min-h-0 overflow-hidden">
        <div style={{ height: height + 6 }} />
      </div>
    </div>
  );
}
