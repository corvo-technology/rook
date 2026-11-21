import { useEffect } from "react";
import {
  applyEmbedAccent,
  exchangeEmbedCode,
  installEmbedToken,
  isCompactEmbed,
  parseEmbedMessage,
  scheduleEmbedRefresh,
  tellParent,
} from "../lib/embed";
import { setEmbedBrand } from "../lib/embed-brand";
import { answerHostAction, hostAsk, setHostActions, setHostContext } from "../lib/embed-host";
import { activateUiLocale } from "../lib/i18n";
import { applyUiAppearance } from "../lib/ui-appearance";

/**
 * Listens to the partner's page for the few things it may say: a new look, a new accent, a new
 * language, where the person is, the actions it offers, how an action went, and a fresh code when
 * the frame asked for one. Only the page that frames this one is heard, and nothing it sends can
 * reach the session.
 */
export function EmbedBridge() {
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      const message = parseEmbedMessage(event.data);
      if (!message) return;
      if (message.type === "config") {
        if (message.theme) applyUiAppearance(message.theme === "auto" ? "system" : message.theme);
        if (message.locale) void activateUiLocale(message.locale);
        applyEmbedAccent(message.accent);
        setEmbedBrand(message.brand);
        return;
      }
      if (message.type === "context") return setHostContext(message.context);
      if (message.type === "actions") return setHostActions(message.actions);
      if (message.type === "ask") return hostAsk(message.text);
      if (message.type === "action-result") {
        return answerHostAction(message.id, {
          ok: message.ok,
          result: message.result ?? undefined,
        });
      }
      void exchangeEmbedCode(message.code).then((session) => {
        if (!session) return tellParent({ type: "corvo:expired" });
        installEmbedToken(session.token);
        scheduleEmbedRefresh(session.expiresAt);
      });
    };
    // Focus inside the frame keeps the page from seeing Escape, so the launcher's panel asks here.
    // A menu or dialog that took the key already handled it.
    const onKey = (event: KeyboardEvent) => {
      if (isCompactEmbed() && event.key === "Escape" && !event.defaultPrevented) {
        tellParent({ type: "corvo:escape" });
      }
    };
    window.addEventListener("message", onMessage);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  return null;
}
