import { newClientId } from "@corvo/core";
import { useState } from "react";
import { Alert, Platform } from "react-native";
import type { MobileMessage } from "./api";
import { rpc, selectableMobileMessageText } from "./api";
import { useI18n } from "./i18n";
import { errorText } from "./user-error";

/**
 * Edit, regenerate, switch and branch for a chat with one agent. Each asks the server, which owns
 * the rules, then refreshes what is on screen; a refusal reads as an alert.
 */
export function useThreadVersions({
  botId,
  refresh,
  openChat,
}: {
  botId?: string;
  refresh: () => Promise<unknown>;
  openChat: (botId: string, name: string) => void;
}) {
  const { t } = useI18n();
  // Android has no text alert, so the screen shows a dialog for the message being edited.
  const [editing, setEditing] = useState<MobileMessage | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const fail = (title: string) => (error: unknown) =>
    Alert.alert(title, errorText(error, t("Try again.")));
  const submitEdit = (message: MobileMessage, text: string) => {
    if (!botId) return;
    void rpc("threads/edit", { botId, messageId: message.id, text, clientNonce: newClientId() })
      .then(refresh)
      .catch(fail(t("Could not edit message")));
  };
  return {
    editing,
    editDraft,
    setEditDraft,
    cancelEdit: () => setEditing(null),
    saveEdit: (text: string) => {
      const message = editing;
      const next = text.trim();
      setEditing(null);
      if (message && next) submitEdit(message, next);
    },
    edit: (message: MobileMessage) => {
      if (!botId) return;
      if (Platform.OS !== "ios") {
        setEditDraft(selectableMobileMessageText(message));
        return setEditing(message);
      }
      Alert.prompt(
        t("Edit message"),
        undefined,
        [
          { text: t("Cancel"), style: "cancel" },
          {
            text: t("Save"),
            onPress: (next?: string) => next?.trim() && submitEdit(message, next.trim()),
          },
        ],
        "plain-text",
        selectableMobileMessageText(message),
      );
    },
    regenerate: () => {
      if (!botId) return;
      void rpc("threads/regenerate", { botId, clientNonce: newClientId() })
        .then(refresh)
        .catch(fail(t("Could not regenerate reply")));
    },
    switchVersion: (branchId: string | null) => {
      if (!botId) return;
      void rpc("threads/switchBranch", { botId, branchId })
        .then(refresh)
        .catch(fail(t("Could not switch version")));
    },
    fork: (message: MobileMessage) => {
      if (!botId) return;
      void rpc("threads/fork", { botId, messageId: message.id })
        .then((forked) => openChat(forked.botId, forked.name))
        .catch(fail(t("Could not continue in a new thread")));
    },
  };
}
