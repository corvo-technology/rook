import type { ProductEvent } from "@corvo/contracts";
import { I18nProvider } from "@lingui/react";
import { createRoot } from "react-dom/client";
import { bootstrapI18n, i18n } from "../../src/lib/i18n";
import "../../src/styles.css";
import { FixtureTranscript, reduceThreadEvents } from "./thread-fixture";

declare global {
  interface Window {
    imageAsks: Array<{ artifactId: string; ask: string }>;
  }
}
window.imageAsks = [];

const image = (n: number) => ({
  kind: "image" as const,
  artifactId: `generated-${n}`,
  name: `lighthouse-${n}.png`,
  mimeType: "image/png",
  size: 4,
});
// Three pictures from one call, posted together after the person's request.
const events: Partial<ProductEvent>[] = [
  {
    type: "thread.message.created",
    payload: {
      messageId: "user-1",
      role: "user",
      blocks: [{ kind: "text", text: "Draw a lighthouse at dusk, three options." }],
    },
  },
  {
    type: "thread.message.created",
    payload: { messageId: "bot-1", role: "bot", blocks: [image(1), image(2), image(3)] },
  },
  { type: "run.completed" },
];

const COLORS = ["#d4d4d4", "#bdbdbd", "#a3a3a3"];
const svg = (n: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320"><rect width="480" height="320" fill="${COLORS[n - 1]}"/><rect x="200" y="60" width="60" height="200" fill="#525252"/><circle cx="230" cy="50" r="24" fill="#f5f5f5"/></svg>`;
const realFetch = window.fetch.bind(window);
// The page has no API: answer the picture read with a drawing per artifact.
window.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href);
  if (url.pathname === "/rpc/artifacts/get") {
    const text = input instanceof Request ? await input.clone().text() : String(init?.body ?? "{}");
    const body = JSON.parse(text || "{}");
    const id = String(body?.json?.artifactId ?? "generated-1");
    return Response.json({
      json: { contentBase64: btoa(svg(Number(id.split("-")[1]) || 1)), mimeType: "image/svg+xml" },
    });
  }
  return realFetch(input, init);
};

const snapshot = reduceThreadEvents(events);
void bootstrapI18n("en").then(() => {
  createRoot(document.getElementById("root")!).render(
    <I18nProvider i18n={i18n}>
      <FixtureTranscript
        messages={snapshot.messages}
        running={false}
        showToolActivity={false}
        onImageAsk={(_message, artifactId, ask) => window.imageAsks.push({ artifactId, ask })}
      />
    </I18nProvider>,
  );
});
