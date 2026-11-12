import type { Bot, StepRun, Workflow } from "@corvo/contracts";
import { ROUTINE_MAX_STEPS } from "@corvo/contracts";
import { BotAvatar, Button, Spinner } from "@corvo/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, Play, Plus, X, Zap } from "lucide-react";
import type { ReactNode } from "react";
import { useId, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { takeInitialBootstrap } from "../lib/bootstrap";
import { cronLabels } from "../lib/cron";
import { useSpaceQueries } from "../lib/query";
import { routineTriggerSummary } from "../lib/routine-trigger";
import { rpc } from "../lib/rpc";
import { useSidePanel } from "../lib/side-panel";
import { errorText } from "../lib/user-error";
import { formatWhen, insertStep, moveStep } from "../lib/workflow-flow";
import { AddStepDialog } from "./AddStepDialog";
import { NewRoutinePanel } from "./NewRoutinePanel";
import { WindowChrome } from "./WindowChrome";

const NO_BOTS: Bot[] = [];
type PlainStep = { botId: string; instruction: string };

const plainSteps = (workflow: Workflow): PlainStep[] =>
  workflow.steps.map(({ botId, instruction }) => ({ botId, instruction }));

/** Each routine as a flow: what starts it, the agent it wakes, then the agents that carry the work on. */
export function WorkflowsPage() {
  const { t } = useLingui();
  const navigate = useNavigate();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState<{ workflow: Workflow; index: number } | null>(null);
  const sidePanel = useSidePanel();
  const creating = sidePanel.isOpen("new-routine");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bots =
    useQuery({
      queryKey: queries.bootstrap.queryKey({ input: {} }),
      queryFn: () => takeInitialBootstrap(),
      select: (bootstrap) => bootstrap.bots,
    }).data ?? NO_BOTS;
  const botById = useMemo(() => new Map(bots.map((bot) => [bot.id, bot])), [bots]);
  const workflows = useQuery(queries.routines.workflows.queryOptions({ input: {} }));

  function refresh() {
    return queryClient.invalidateQueries({ queryKey: queries.routines.workflows.key() });
  }

  async function saveSteps(workflow: Workflow, steps: PlainStep[]) {
    setSaving(true);
    setError(null);
    try {
      await rpc.routines.setSteps({ routineId: workflow.id, steps });
      await refresh();
      setAdding(null);
    } catch (reason) {
      setError(errorText(reason, t`Could not save`));
    } finally {
      setSaving(false);
    }
  }

  async function runNow(workflow: Workflow) {
    setError(null);
    try {
      await rpc.routines.testRun({ routineId: workflow.id });
    } catch (reason) {
      setError(errorText(reason, t`Could not run the routine`));
    }
  }

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <div className="app-drag flex items-center gap-2 px-4 pt-3">
        <WindowChrome />
      </div>
      <header className="flex items-center gap-2 px-6 py-4">
        <h1 className="text-base font-medium">
          <Trans>Workflows</Trans>
        </h1>
        <Button
          className="ms-auto"
          size="sm"
          disabled={bots.length === 0}
          onClick={() => sidePanel.open("new-routine")}
        >
          <Plus />
          <Trans>New routine</Trans>
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto px-6 pb-6">
        {error && !adding ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {workflows.error && !workflows.data ? (
          <p role="alert" className="text-sm text-destructive">
            {errorText(workflows.error, t`Could not load`)}
          </p>
        ) : workflows.isPending ? (
          <Spinner />
        ) : workflows.data?.length === 0 ? (
          <p className="m-auto text-sm text-muted-foreground">
            <Trans>No workflows yet</Trans>
          </p>
        ) : (
          workflows.data?.map((workflow) => (
            <WorkflowCanvas
              key={workflow.id}
              workflow={workflow}
              botById={botById}
              onOpenBot={(botId) => navigate(`/app/${botId}`)}
              onRun={() => void runNow(workflow)}
              onAdd={(index) => {
                setError(null);
                setAdding({ workflow, index });
              }}
              onMove={(index, delta) =>
                void saveSteps(workflow, moveStep(plainSteps(workflow), index, delta))
              }
              onRemove={(index) =>
                void saveSteps(
                  workflow,
                  plainSteps(workflow).filter((_, position) => position !== index),
                )
              }
            />
          ))
        )}
      </div>
      {adding ? (
        <AddStepDialog
          bots={bots}
          saving={saving}
          error={error}
          onClose={() => setAdding(null)}
          onAdd={(step) =>
            void saveSteps(
              adding.workflow,
              insertStep(plainSteps(adding.workflow), adding.index, step),
            )
          }
        />
      ) : null}
      {creating && bots.length > 0 ? (
        <NewRoutinePanel
          bots={bots}
          onClose={sidePanel.close}
          onCreated={() => {
            sidePanel.close();
            void refresh();
          }}
        />
      ) : null}
    </div>
  );
}

/** A faint grid of dots behind the flow, in the border color so it follows the theme. */
function DotGrid() {
  const id = useId();
  return (
    <svg aria-hidden="true" className="pointer-events-none absolute inset-0 size-full text-border">
      <defs>
        <pattern id={id} width="18" height="18" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="1" fill="currentColor" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

function WorkflowCanvas({
  workflow,
  botById,
  onOpenBot,
  onRun,
  onAdd,
  onMove,
  onRemove,
}: {
  workflow: Workflow;
  botById: Map<string, Bot>;
  onOpenBot: (botId: string) => void;
  onRun: () => void;
  onAdd: (index: number) => void;
  onMove: (index: number, delta: -1 | 1) => void;
  onRemove: (index: number) => void;
}) {
  const { i18n } = useLingui();
  const locale = i18n.locale || "en";
  const now = new Date();
  const canAdd = workflow.steps.length < ROUTINE_MAX_STEPS;
  const last = workflow.lastRun;
  return (
    <section
      data-testid="workflow"
      className="relative shrink-0 overflow-hidden rounded-2xl border border-border animate-in fade-in-0 duration-200 motion-reduce:animate-none"
    >
      <DotGrid />
      <div className="relative flex flex-wrap items-center gap-x-3 gap-y-2 px-5 pt-4">
        <h2 className="min-w-0 truncate text-heading3 font-medium">{workflow.name}</h2>
        <span className="flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-0.5 text-label text-muted-foreground">
          <span
            aria-hidden="true"
            className={`size-1.5 rounded-full ${workflow.active ? "bg-success" : "bg-muted-foreground"}`}
          />
          {workflow.active ? <Trans>Active</Trans> : <Trans>Paused</Trans>}
        </span>
        {last ? (
          <span className={`text-body2 ${stateTone(last.state)}`}>
            <Trans>Last run</Trans> {formatWhen(last.at, now, locale)}
          </span>
        ) : null}
        <Button className="ms-auto" size="sm" onClick={onRun}>
          <Play />
          <Trans>Run now</Trans>
        </Button>
      </div>

      <ol className="relative flex items-center overflow-x-auto px-5 pt-14 pb-7">
        <li className="relative w-52 shrink-0 rounded-2xl border border-border bg-card p-3">
          <span className="absolute -top-6 start-1 flex items-center gap-1 text-caption text-muted-foreground">
            <Zap className="size-3" aria-hidden="true" />
            <Trans>Trigger</Trans>
          </span>
          <p className="text-body1 font-medium">
            {routineTriggerSummary(workflow, cronLabels(locale))}
          </p>
          {workflow.active && workflow.nextRunAt ? (
            <p className="mt-1 text-body2 text-muted-foreground">
              <Trans>Next</Trans> {formatWhen(workflow.nextRunAt, now, locale)}
            </p>
          ) : null}
        </li>
        <FlowLink state={last ? (last.state === "running" ? "running" : "done") : undefined} />
        <StepNode
          number={1}
          bot={botById.get(workflow.botId)}
          text={workflow.prompt}
          run={last}
          now={now}
          locale={locale}
          onOpen={() => onOpenBot(workflow.botId)}
        />
        {workflow.steps.map((step, index) => (
          <FlowItem
            key={step.id}
            link={
              <FlowLink
                state={(index === 0 ? last : workflow.steps[index - 1]?.lastRun)?.state}
                onAdd={canAdd ? () => onAdd(index) : undefined}
              />
            }
          >
            <StepNode
              number={index + 2}
              bot={botById.get(step.botId)}
              text={step.instruction}
              run={step.lastRun}
              now={now}
              locale={locale}
              onOpen={() => onOpenBot(step.botId)}
              tools={{
                canMoveEarlier: index > 0,
                canMoveLater: index < workflow.steps.length - 1,
                onMove: (delta) => onMove(index, delta),
                onRemove: () => onRemove(index),
              }}
            />
          </FlowItem>
        ))}
        {canAdd ? (
          <>
            <FlowLink state={workflow.steps.at(-1)?.lastRun?.state ?? last?.state} />
            <li className="shrink-0">
              <Button variant="outline" size="sm" onClick={() => onAdd(workflow.steps.length)}>
                <Plus />
                <Trans>Add step</Trans>
              </Button>
            </li>
          </>
        ) : null}
      </ol>
    </section>
  );
}

/** A link and the node after it, which belong together in the row. */
function FlowItem({ link, children }: { link: ReactNode; children: ReactNode }) {
  return (
    <>
      {link}
      {children}
    </>
  );
}

const stateTone = (state: StepRun["state"]) =>
  state === "done" ? "text-success" : state === "failed" ? "text-destructive" : "text-warning";

/** The link takes the color of how the step before it went, and its dashes travel while it runs. */
function FlowLink({ state, onAdd }: { state: StepRun["state"] | undefined; onAdd?: () => void }) {
  const { t } = useLingui();
  const tone =
    state === "done"
      ? "text-success"
      : state === "failed"
        ? "text-destructive"
        : state === "running"
          ? "text-warning"
          : "text-border";
  return (
    <li
      aria-hidden={onAdd ? undefined : true}
      data-testid="flow-link"
      data-state={state ?? "idle"}
      className="group/link relative grid h-8 w-16 shrink-0 place-items-center"
    >
      <svg aria-hidden="true" width="100%" height="2" className={`overflow-visible ${tone}`}>
        <line
          x1="0"
          y1="1"
          x2="100%"
          y2="1"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={state === "done" ? undefined : "6 5"}
          className={state === "running" ? "flow-dash" : undefined}
        />
      </svg>
      {onAdd ? (
        <button
          type="button"
          aria-label={t`Add a step here`}
          onClick={onAdd}
          className="absolute grid size-6 place-items-center rounded-full border border-border bg-background text-muted-foreground opacity-70 transition-[opacity,color] outline-none group-hover/link:opacity-100 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
        >
          <Plus className="size-3.5" aria-hidden="true" />
        </button>
      ) : null}
    </li>
  );
}

function StepNode({
  number,
  bot,
  text,
  run,
  now,
  locale,
  onOpen,
  tools,
}: {
  number: number;
  bot: Bot | undefined;
  text: string;
  run: StepRun | null;
  now: Date;
  locale: string;
  onOpen: () => void;
  tools?: {
    canMoveEarlier: boolean;
    canMoveLater: boolean;
    onMove: (delta: -1 | 1) => void;
    onRemove: () => void;
  };
}) {
  const { t } = useLingui();
  const ring =
    run?.state === "running"
      ? "border-warning/60 ring-2 ring-warning/25 motion-safe:animate-pulse"
      : run?.state === "done"
        ? "border-success/40"
        : run?.state === "failed"
          ? "border-destructive/50"
          : "border-border";
  const label = run ? { done: t`Done`, failed: t`Failed`, running: t`Running` }[run.state] : null;
  return (
    <li
      className={`group relative w-56 shrink-0 rounded-2xl border bg-card p-3 transition-colors duration-200 animate-in fade-in-0 slide-in-from-bottom-1 motion-reduce:animate-none motion-reduce:transition-none ${ring}`}
    >
      <span className="absolute -top-6 start-1 text-caption text-muted-foreground">
        <Trans>Step {number}</Trans>
      </span>
      {tools ? (
        <div className="absolute start-1/2 -top-12 z-10 flex -translate-x-1/2 gap-0.5 rounded-xl border border-border bg-popover p-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 motion-reduce:transition-none">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={t`Move earlier`}
            disabled={!tools.canMoveEarlier}
            onClick={() => tools.onMove(-1)}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={t`Move later`}
            disabled={!tools.canMoveLater}
            onClick={() => tools.onMove(1)}
          >
            <ChevronRight />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={t`Remove`}
            onClick={tools.onRemove}
          >
            <X />
          </Button>
        </div>
      ) : null}
      <button type="button" onClick={onOpen} className="block w-full text-start">
        <span className="flex items-center gap-2 text-body1 font-medium">
          {bot ? (
            <BotAvatar color={bot.color} identity={bot.id} size={18} status={bot.status} />
          ) : null}
          <span className="truncate">{bot?.name}</span>
        </span>
        <span className="mt-1.5 line-clamp-2 block text-body2 text-muted-foreground">{text}</span>
        {run && label ? (
          <span className={`mt-2.5 flex items-center gap-1.5 text-label ${stateTone(run.state)}`}>
            {run.state === "running" ? (
              <Spinner className="size-3" aria-hidden="true" />
            ) : run.state === "done" ? (
              <Check className="size-3" aria-hidden="true" />
            ) : (
              <X className="size-3" aria-hidden="true" />
            )}
            {label} · {formatWhen(run.at, now, locale)}
          </span>
        ) : null}
      </button>
    </li>
  );
}
