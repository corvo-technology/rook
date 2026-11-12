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
 * One channel of the product with an agent waiting on your yes. Approving or denying plays the
 * rest: the agent works, then answers.
 */
export function ProductPreview({ copy }: { copy: Copy }) {
  const channel = copy.conversations[0]!;
  const [decision, setDecision] = useState<Decision>("pending");
  const [working, setWorking] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const root = useRef<HTMLElement>(null);
  const [act, setAct] = useState<Act>("answered");
  const [typed, setTyped] = useState("");
  const request = channel.messages.find((m) => m.kind === "you")?.text ?? "";

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Once, when the window comes into view, the request types itself and the team answers.
  // Reduced motion, or no script, keeps the finished conversation.
  useEffect(() => {
    const node = root.current;
    if (!node || !request || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setAct("waiting");
    const timers: number[] = [];
    const later = (ms: number, run: () => void) => timers.push(window.setTimeout(run, ms));
    const type = (count: number) => {
      setTyped(request.slice(0, count));
      if (count < request.length) later(34 + ((count * 37) % 45), () => type(count + 1));
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
    return () => {
      observer.disconnect();
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, [request]);

  const decide = (next: Exclude<Decision, "pending">) => {
    if (decision !== "pending") return;
    setDecision(next);
    setWorking(true);
    timer.current = window.setTimeout(() => setWorking(false), 1500);
  };

  const finished = decision !== "pending" && !working;
  const reply = decision === "approved" ? copy.approvedReply : copy.deniedReply;
  // The agent that is waiting on your yes.
  const asking = channel.messages.find((m) => m.kind === "agent" && m.approval);
  const asked = asking?.kind === "agent" ? agentOf(copy, asking.agent) : undefined;
  // The call it waited on, as one quiet line once you have answered.
  const decided = `${copy.approvalBody.replace(/[.。]$/, "")} · ${decision === "approved" ? copy.approved : copy.denied}`;

  return (
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
                <Rook hue={agentOf(copy, "Chief").hue} size={18} seed={index} />
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
                      <p>{copy.approvalBody}</p>
                      <code>{copy.approvalCall}</code>
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
  );
}
