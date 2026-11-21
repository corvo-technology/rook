import { useEffect, useRef, useState } from "react";
import type { LaunchAgent, LaunchCopy } from "../i18n/launch";
import { Rook } from "./Rook";
import "../styles/preview.css";

type Copy = LaunchCopy["preview"];
type Decision = "pending" | "approved" | "denied";
/** The opening act: the request is typed, sent, worked on, then answered. The page renders the last one. */
type Act = "waiting" | "typing" | "sent" | "working" | "answered";

function agentOf(copy: Copy, name: string): LaunchAgent {
  return copy.agents.find((agent) => agent.name === name) ?? copy.agents[0]!;
}

/**
 * The product's channels, one per area of a company, each with an agent waiting on your yes. Approving or
 * denying plays the rest: the agent works, then answers.
 */
export function ProductPreview({ copy }: { copy: Copy }) {
  const channels = copy.conversations.filter((conversation) => conversation.kind === "channel");
  const [activeId, setActiveId] = useState(channels[0]!.id);
  const channel = channels.find((conversation) => conversation.id === activeId) ?? channels[0]!;
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const decision = decisions[channel.id] ?? "pending";
  const [working, setWorking] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const root = useRef<HTMLElement>(null);
  const stopOpening = useRef<() => void>(() => {});
  const [act, setAct] = useState<Act>("answered");
  const [typed, setTyped] = useState("");
  const request = channel.messages.find((m) => m.kind === "you")?.text ?? "";
  const openingRequest = channels[0]!.messages.find((m) => m.kind === "you")?.text ?? "";

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Once, when the window comes into view, the first request types itself and the team answers.
  // Until then, and with reduced motion or no script, the finished conversation shows.
  useEffect(() => {
    const node = root.current;
    if (!node || !openingRequest || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timers: number[] = [];
    const later = (ms: number, run: () => void) => timers.push(window.setTimeout(run, ms));
    const type = (count: number) => {
      setTyped(openingRequest.slice(0, count));
      if (count < openingRequest.length) later(34 + ((count * 37) % 45), () => type(count + 1));
      else {
        later(450, () => {
          setTyped("");
          setAct("sent");
        });
        later(1100, () => setAct("working"));
        later(2700, () => setAct("answered"));
      }
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        setAct("typing");
        later(500, () => type(1));
      },
      { threshold: 0.4 },
    );
    observer.observe(node);
    const stop = () => {
      observer.disconnect();
      timers.forEach((id) => window.clearTimeout(id));
    };
    stopOpening.current = stop;
    return stop;
  }, [openingRequest]);

  // Picking an area ends the opening act and shows that channel as it stands.
  const pick = (id: string) => {
    if (id === channel.id) return;
    stopOpening.current();
    window.clearTimeout(timer.current);
    setWorking(false);
    setTyped("");
    setAct("answered");
    setActiveId(id);
  };

  const decide = (next: Exclude<Decision, "pending">) => {
    if (decision !== "pending") return;
    setDecisions((all) => ({ ...all, [channel.id]: next }));
    setWorking(true);
    timer.current = window.setTimeout(() => setWorking(false), 1500);
  };

  const finished = decision !== "pending" && !working;
  const approval = channel.approval;
  const reply = (decision === "approved" ? approval?.approved : approval?.denied) ?? [];
  // The agent that is waiting on your yes.
  const asking = channel.messages.find((m) => m.kind === "agent" && m.approval);
  const asked = asking?.kind === "agent" ? agentOf(copy, asking.agent) : undefined;
  // The call it waited on, as one quiet line once you have answered.
  const decided = `${(approval?.body ?? "").replace(/[.。]$/, "")} · ${decision === "approved" ? copy.approved : copy.denied}`;

  return (
    <div className="pv-wrap">
    <div className="pv-tabs" role="group" aria-label={copy.channels}>
      {channels.map((item) => (
        <button key={item.id} type="button" className="pv-tab" aria-pressed={item.id === channel.id} onClick={() => pick(item.id)}>
          {item.tab ?? item.name}
        </button>
      ))}
    </div>
    <section ref={root} className="pv ink" data-testid="product-preview" aria-label={`#${channel.name}`}>
      <header className="pv-head">
        <p>
          <strong># {channel.name}</strong>
          {channel.purpose ? <span> · {channel.purpose}</span> : null}
        </p>
        <span>
          {channel.members.length} {copy.agentsCount}
        </span>
      </header>

      {request ? (
        <p className="pv-you" data-off={act === "waiting" || act === "typing" ? "" : undefined}>
          {request}
        </p>
      ) : null}

      <div className="pv-stage">
      {asked ? (
        <article className="pv-msg pv-msg--quiet pv-stage__working" data-off={act === "working" ? undefined : ""} aria-hidden="true">
          <Rook hue={asked.hue} size={40} mood="working" ring />
          <p className="pv-msg__who">
            <strong>{asked.name}</strong> · {copy.working}…
          </p>
        </article>
      ) : null}
      <div className="pv-stage__thread" data-off={act === "answered" ? undefined : ""}>
      {channel.messages.map((message, index) => {
        if (message.kind === "you") return null;
        const agent = agentOf(copy, message.agent);
        const waiting = Boolean(message.approval);
        return (
          <div key={index} className="pv-thread">
            {waiting && asked ? (
              <p className="pv-handoff">
                <Rook hue={agentOf(copy, "Rook").hue} size={18} seed={index} />
                <span>
                  {copy.chief} → @{asked.name}
                </span>
              </p>
            ) : null}
            <article className="pv-msg">
              <Rook hue={agent.hue} size={40} seed={index + 1} mood={waiting && decision === "pending" ? "asking" : "idle"} />
              <div className="pv-msg__body">
                <p className="pv-msg__who">
                  <strong>{agent.name}</strong> · {agent.role}
                </p>
                <p>{message.text.join(" ")}</p>
                {waiting && decision === "pending" ? (
                  <div className="pv-approval" data-decision={decision}>
                    <div>
                      <p className="pv-approval__flag">{copy.waiting}</p>
                      <p>{approval?.body}</p>
                      <code>{approval?.call}</code>
                    </div>
                    <div className="pv-approval__actions">
                      <button type="button" className="pv-btn pv-btn--solid" onClick={() => decide("approved")}>
                        {copy.approve}
                      </button>
                      <button type="button" className="pv-btn" onClick={() => decide("denied")}>
                        {copy.deny}
                      </button>
                    </div>
                  </div>
                ) : null}
                {waiting && decision !== "pending" ? (
                  <p className="pv-decided" data-decision={decision}>
                    <span aria-hidden="true">{decision === "approved" ? "✓" : "✕"}</span> {decided}
                  </p>
                ) : null}
              </div>
            </article>
          </div>
        );
      })}
      </div>
      </div>

      {asked && working ? (
        <article className="pv-msg pv-msg--quiet">
          <Rook hue={asked.hue} size={40} mood="working" ring />
          <p className="pv-msg__who">
            <strong>{asked.name}</strong> · {copy.working}…
          </p>
        </article>
      ) : null}

      {asked && finished ? (
        <article className="pv-msg">
          <Rook hue={asked.hue} size={40} mood={decision === "approved" ? "done" : "idle"} />
          <div className="pv-msg__body">
            <p className="pv-msg__who">
              <strong>{asked.name}</strong>
            </p>
            {reply.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        </article>
      ) : null}

      <div className="pv-composer">
        <span>
          {act === "typing" && typed ? (
            <>
              {typed}
              <i className="pv-caret" aria-hidden="true" />
            </>
          ) : (
            <>
              {copy.composer} #{channel.name}
            </>
          )}
        </span>
        <span className="pv-composer__send" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M12 19V5M6 11l6-6 6 6" />
          </svg>
        </span>
      </div>
    </section>
    {channel.closing ? (
      <div className="pv-foot">
        <p>
          <strong>{channel.closing}</strong> {channel.saved ? <span>{channel.saved}</span> : null}
        </p>
        {channel.systems ? (
          <ul>
            {channel.systems.map((system) => (
              <li key={system}>{system}</li>
            ))}
          </ul>
        ) : null}
      </div>
    ) : null}
    </div>
  );
}
