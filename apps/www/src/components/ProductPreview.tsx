import { useEffect, useRef, useState } from "react";
import type { LaunchAgent, LaunchCopy } from "../i18n/launch";
import type { RookMood } from "./Rook";
import { Rook } from "./Rook";
import "../styles/preview.css";

type Copy = LaunchCopy["preview"];
type Decision = "pending" | "approved" | "denied";

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

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const decide = (next: Exclude<Decision, "pending">) => {
    if (decision !== "pending") return;
    setDecision(next);
    setWorking(true);
    timer.current = window.setTimeout(() => setWorking(false), 1500);
  };

  const finished = decision !== "pending" && !working;
  const reply = decision === "approved" ? copy.approvedReply : copy.deniedReply;

  // Asking while it waits on you, working while it carries out the answer, smiling when approved.
  const mood: RookMood = decision === "pending" ? "asking" : working ? "working" : decision === "approved" ? "done" : "working";

  return (
    <section className="pv" data-testid="product-preview" aria-label={`#${channel.name}`}>
      <header className="pv-head">
        <p>
          <strong># {channel.name}</strong>
          {channel.purpose ? <span> · {channel.purpose}</span> : null}
        </p>
        <span>
          {channel.members.length} {copy.agentsCount}
        </span>
      </header>

      {channel.messages.map((message, index) => {
        if (message.kind === "you") return null;
        const agent = agentOf(copy, message.agent);
        const waiting = Boolean(message.approval);
        return (
          <article key={index} className="pv-msg">
            <Rook hue={agent.hue} size={40} mood={waiting ? mood : "working"} />
            <div className="pv-msg__body">
              <p className="pv-msg__who">
                <strong>{agent.name}</strong> · {agent.role}
              </p>
              <p>{message.text.join(" ")}</p>
              {waiting ? (
                <div className="pv-approval" data-decision={decision}>
                  <div>
                    <p className="pv-approval__flag">
                      {decision === "pending" ? copy.waiting : decision === "approved" ? copy.approved : copy.denied}
                    </p>
                    <p>{copy.approvalBody}</p>
                    <code>{copy.approvalCall}</code>
                  </div>
                  {decision === "pending" ? (
                    <div className="pv-approval__actions">
                      <button type="button" className="pv-btn pv-btn--solid" onClick={() => decide("approved")}>
                        {copy.approve}
                      </button>
                      <button type="button" className="pv-btn" onClick={() => decide("denied")}>
                        {copy.deny}
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </article>
        );
      })}

      {finished ? (
        <article className="pv-msg">
          <Rook hue={agentOf(copy, "Bento").hue} size={40} mood={mood} />
          <div className="pv-msg__body">
            <p className="pv-msg__who">
              <strong>Bento</strong>
            </p>
            {reply.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        </article>
      ) : null}

      <div className="pv-composer">
        <span>
          {copy.composer} #{channel.name}
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
