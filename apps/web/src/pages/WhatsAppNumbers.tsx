import type { WhatsAppNumber } from "@corvo/contracts";
import {
  Button,
  Disclosure,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  OptionSelect,
  RadioGroup,
  RadioGroupItem,
} from "@corvo/ui-web";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight, MoreHorizontal } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { encode } from "uqr";
import { useSpaceQueries } from "../lib/query";
import { rpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";
import { AppLetter, StoreAppHeader } from "./StoreAppHeader";

const LINK_POLL_MS = 1_500;

type Mode = WhatsAppNumber["mode"];

/** The QR code WhatsApp shows to link a device, drawn as one path so it scans in any theme. */
function Qr({ text }: { text: string }) {
  const { t } = useLingui();
  const { data, path } = useMemo(() => {
    const { data: cells } = encode(text, { ecc: "L", border: 2 });
    const dark: string[] = [];
    cells.forEach((row, y) => {
      row.forEach((on, x) => {
        if (on) dark.push(`M${x} ${y}h1v1h-1z`);
      });
    });
    return { data: cells, path: dark.join("") };
  }, [text]);
  return (
    <svg
      data-testid="whatsapp-qr"
      role="img"
      aria-label={t`QR code`}
      viewBox={`0 0 ${data.length} ${data.length}`}
      shapeRendering="crispEdges"
      className="size-56 rounded-xl"
    >
      {/* A scanner needs dark on light whatever the theme is. */}
      <rect width={data.length} height={data.length} fill="white" />
      <path d={path} fill="black" />
    </svg>
  );
}

function useNumbers() {
  const queries = useSpaceQueries();
  const options = queries.messaging.whatsapp.numbers.list.queryOptions();
  return { list: useQuery(options).data, key: options.queryKey };
}

/** The WhatsApp row in the Store's list: one line that opens the app's own screen. */
export function WhatsAppListRow({ onOpen }: { onOpen: () => void }) {
  const { list } = useNumbers();
  if (!list?.available) return null;
  const count = list.numbers.length;
  return (
    <button
      type="button"
      data-testid="whatsapp-numbers"
      className="flex w-full min-w-0 items-center gap-3 rounded-xl px-2.5 py-2 text-start hover:bg-accent/60 focus-visible:outline-2"
      onClick={onOpen}
    >
      <AppLetter name="WhatsApp" />
      <span className="min-w-0 flex-1 truncate text-[15px] font-medium">WhatsApp</span>
      {count > 0 ? (
        <span className="shrink-0 text-[12.5px] text-muted-foreground">
          <Plural value={count} one="# number" other="# numbers" />
        </span>
      ) : null}
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  );
}

function ModeChoice({ value, onChange }: { value: Mode; onChange: (mode: Mode) => void }) {
  const { t } = useLingui();
  return (
    <RadioGroup
      aria-label={t`Answers`}
      value={value}
      onValueChange={(next) => onChange(next === "service" ? "service" : "assistant")}
    >
      {/* biome-ignore lint/a11y/noLabelWithoutControl: the wrapped RadioGroupItem is the control. */}
      <label className="flex cursor-pointer gap-3 rounded-xl border border-border p-3.5">
        <RadioGroupItem
          value="assistant"
          data-testid="whatsapp-mode-assistant"
          className="mt-0.5"
        />
        <span>
          <span className="block text-[15px] text-foreground">
            <Trans>My assistant</Trans>
          </span>
          <span className="mt-0.5 block text-[13px] text-muted-foreground">
            <Trans>Answers your own chat with yourself.</Trans>
          </span>
        </span>
      </label>
      {/* biome-ignore lint/a11y/noLabelWithoutControl: the wrapped RadioGroupItem is the control. */}
      <label className="flex cursor-pointer gap-3 rounded-xl border border-border p-3.5">
        <RadioGroupItem value="service" data-testid="whatsapp-mode-service" className="mt-0.5" />
        <span>
          <span className="block text-[15px] text-foreground">
            <Trans>Customer service</Trans>
          </span>
          <span className="mt-0.5 block text-[13px] text-muted-foreground">
            <Trans>Answers anyone who writes to this number.</Trans>
          </span>
        </span>
      </label>
    </RadioGroup>
  );
}

/** Choose the agent and who the number answers, then scan: the whole way to a linked number. */
function LinkPanel({
  open,
  botId,
  onClose,
  onLinked,
}: {
  open: boolean;
  botId: string | undefined;
  onClose: () => void;
  onLinked: () => Promise<unknown>;
}) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const bots = (useQuery(queries.bots.list.queryOptions()).data ?? []).filter(
    (bot) => !bot.archivedAt,
  );
  const [chosen, setChosen] = useState<string | undefined>(botId);
  const [mode, setMode] = useState<Mode>("assistant");
  const [link, setLink] = useState<{ id: string; qr?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const linkId = link?.id;
  const agent = chosen ?? botId ?? bots[0]?.id;
  // Read fresh by the watcher below without restarting it each time the dialog renders.
  const finish = useRef(onLinked);
  finish.current = onLinked;
  const close = useRef(onClose);
  close.current = onClose;
  const failedText = t`Could not connect`;
  const failedTextRef = useRef(failedText);
  failedTextRef.current = failedText;

  // The scan happens on the phone, so watch the link until it settles.
  useEffect(() => {
    if (!linkId) return;
    let active = true;
    const check = async () => {
      try {
        const status = await rpc.messaging.whatsapp.link.status({ linkId });
        if (!active) return;
        if (status.state === "qr") {
          setLink((current) => (current?.id === linkId ? { id: linkId, qr: status.qr } : current));
        } else if (status.state === "linked") {
          setLink(null);
          await finish.current();
          close.current();
        } else {
          setLink(null);
          setError(failedTextRef.current);
        }
      } catch {
        // A poll that fails once is tried again on the next tick.
      }
    };
    // Look at once, so the QR code shows as soon as it exists, then keep watching.
    void check();
    const poll = window.setInterval(() => void check(), LINK_POLL_MS);
    return () => {
      active = false;
      window.clearInterval(poll);
    };
  }, [linkId]);

  function leave() {
    if (link) void rpc.messaging.whatsapp.link.cancel({ linkId: link.id }).catch(() => undefined);
    setLink(null);
    setError(null);
    setMode("assistant");
    onClose();
  }

  async function start() {
    if (!agent) return;
    setError(null);
    setStarting(true);
    try {
      const started = await rpc.messaging.whatsapp.link.start({ botId: agent, mode });
      setLink({ id: started.linkId });
    } catch (err) {
      setError(errorText(err, t`Could not connect`));
    } finally {
      setStarting(false);
    }
  }

  if (!open) return null;
  return (
    <section
      className="space-y-4 rounded-xl border border-border p-4"
      data-testid="whatsapp-link"
      aria-labelledby="whatsapp-link-title"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          leave();
        }
      }}
    >
      <h3 id="whatsapp-link-title" className="text-heading3 text-foreground">
        <Trans>Add number</Trans>
      </h3>
      {link ? (
        <div className="flex flex-col items-center gap-4 py-2">
          {link.qr ? <Qr text={link.qr} /> : <div className="size-56" aria-hidden="true" />}
          <Button type="button" variant="ghost" size="sm" onClick={leave}>
            <Trans>Cancel</Trans>
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {bots.length > 1 ? (
            <OptionSelect
              aria-label={t`Agent`}
              data-testid="whatsapp-agent"
              value={agent ?? null}
              options={bots.map((bot) => ({ value: bot.id, label: bot.name }))}
              onValueChange={setChosen}
            />
          ) : null}
          <ModeChoice value={mode} onChange={setMode} />
          <p className="text-[13px] text-muted-foreground">
            <Trans>This uses WhatsApp without the official API. WhatsApp can ban the number.</Trans>
          </p>
          <Button
            type="button"
            className="w-full"
            disabled={!agent || starting}
            onClick={() => void start()}
          >
            <Trans>Show QR code</Trans>
          </Button>
          <Button type="button" variant="ghost" size="sm" className="w-full" onClick={leave}>
            <Trans>Cancel</Trans>
          </Button>
        </div>
      )}
      {error ? <p className="text-[13px] text-destructive">{error}</p> : null}
    </section>
  );
}

function NumberCard({ number }: { number: WhatsAppNumber }) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const { key } = useNumbers();
  const bots = (useQuery(queries.bots.list.queryOptions()).data ?? []).filter(
    (bot) => !bot.archivedAt,
  );
  const connections = useQuery(queries.connections.list.queryOptions()).data ?? [];
  const [error, setError] = useState<string | null>(null);

  // One entry per connected app, by the name the person knows it by.
  const apps = [
    ...new Map(connections.map((connection) => [connection.provider, connection.displayName])),
  ];

  async function change(input: Parameters<typeof rpc.messaging.whatsapp.numbers.update>[0]) {
    setError(null);
    try {
      await rpc.messaging.whatsapp.numbers.update(input);
      await queryClient.invalidateQueries({ queryKey: key });
    } catch (err) {
      setError(errorText(err, t`Could not update`));
    }
  }

  async function remove() {
    setError(null);
    try {
      await rpc.messaging.whatsapp.numbers.disconnect({ id: number.id });
      await queryClient.invalidateQueries({ queryKey: key });
    } catch (err) {
      setError(errorText(err, t`Could not disconnect`));
    }
  }

  const disconnected = number.status === "disconnected";
  return (
    <div
      data-testid={`whatsapp-number-${number.id}`}
      className="space-y-3 rounded-xl border px-4 py-3.5"
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{number.number}</span>
        {disconnected ? (
          <span className="shrink-0 text-[12.5px] text-muted-foreground">
            <Trans>Disconnected</Trans>
          </span>
        ) : number.paused ? (
          <span className="shrink-0 text-[12.5px] text-muted-foreground">
            <Trans>Paused</Trans>
          </span>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`${t`More`} ${number.number}`}
            render={<Button variant="ghost" size="icon-sm" className="text-muted-foreground" />}
          >
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-auto min-w-40">
            {disconnected ? null : (
              <DropdownMenuItem
                onClick={() => void change({ id: number.id, paused: !number.paused })}
              >
                {number.paused ? <Trans>Resume</Trans> : <Trans>Pause</Trans>}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem variant="destructive" onClick={() => void remove()}>
              <Trans>Disconnect</Trans>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {bots.length > 1 ? (
          <OptionSelect
            aria-label={t`Agent`}
            value={number.botId}
            options={bots.map((bot) => ({ value: bot.id, label: bot.name }))}
            onValueChange={(botId) =>
              botId !== number.botId && void change({ id: number.id, botId })
            }
          />
        ) : (
          <div className="self-center text-[13px] text-muted-foreground">{number.botName}</div>
        )}
        <OptionSelect
          aria-label={t`Answers`}
          value={number.mode}
          options={[
            { value: "assistant", label: t`My assistant` },
            { value: "service", label: t`Customer service` },
          ]}
          onValueChange={(mode) => mode !== number.mode && void change({ id: number.id, mode })}
        />
      </div>
      {number.mode === "service" && apps.length > 0 ? (
        <Disclosure
          summaryClassName="text-[13px] text-muted-foreground"
          summary={<Trans>Apps visitors can use</Trans>}
        >
          <div className="flex flex-wrap gap-1.5 pt-3">
            {apps.map(([provider, name]) => {
              const on = number.visitorConnectors.includes(provider);
              return (
                <Button
                  key={provider}
                  type="button"
                  variant={on ? "default" : "outline"}
                  size="xs"
                  aria-pressed={on}
                  onClick={() =>
                    void change({
                      id: number.id,
                      visitorConnectors: (on
                        ? number.visitorConnectors.filter((entry) => entry !== provider)
                        : [...number.visitorConnectors, provider]
                      ).sort(),
                    })
                  }
                >
                  {on ? <Check aria-hidden="true" /> : null}
                  {name}
                </Button>
              );
            })}
          </div>
        </Disclosure>
      ) : null}
      {error ? <p className="text-[13px] text-destructive">{error}</p> : null}
    </div>
  );
}

/** WhatsApp's own screen in the Store: its numbers, and the one way to add another. */
export function WhatsAppApp({ botId, onBack }: { botId: string | undefined; onBack: () => void }) {
  const queryClient = useQueryClient();
  const { list, key } = useNumbers();
  const [adding, setAdding] = useState(false);
  const numbers = list?.numbers ?? [];
  const add = (
    <Button type="button" variant="secondary" size="sm" onClick={() => setAdding(true)}>
      <Trans>Add number</Trans>
    </Button>
  );
  return (
    <div className="space-y-5" data-testid="whatsapp-app">
      <StoreAppHeader name="WhatsApp" onBack={onBack} action={numbers.length > 0 ? add : null} />
      {numbers.length === 0 ? <div className="flex justify-center py-10">{add}</div> : null}
      <div className="space-y-2">
        {numbers.map((number) => (
          <NumberCard key={number.id} number={number} />
        ))}
      </div>
      <LinkPanel
        open={adding}
        botId={botId}
        onClose={() => setAdding(false)}
        onLinked={() => queryClient.invalidateQueries({ queryKey: key })}
      />
    </div>
  );
}
