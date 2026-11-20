import { BotSecretName, commandVariableName, commandVariableProblem } from "@corvo/contracts";
import { Alert, Platform } from "react-native";

/** How the agent refers to a saved key: the command variable its shell commands receive. */
export function credentialReference(name: string): string {
  return `$${commandVariableName(name)}`;
}

type CredentialRpc = {
  list: (input: { botId: string }) => Promise<Array<{ name: string }>>;
  put: (input: {
    botId: string;
    destination: { name: string; auth: { type: "command" } };
    value: string;
  }) => Promise<unknown>;
};

/**
 * Saves a pasted key as the agent's credential and returns the reference that replaces it in the
 * draft. An existing credential with the same name is kept: the new one gets `-2`, `-3`…
 * The key goes only to the credential store; it is never logged.
 */
export async function saveKeyCredential(input: {
  botId: string;
  name: string;
  value: string;
  rpc: CredentialRpc;
}): Promise<string> {
  const name = input.name.trim();
  if (
    !BotSecretName.safeParse(name).success ||
    commandVariableProblem(commandVariableName(name)) !== undefined
  ) {
    throw new Error("Invalid credential name");
  }
  const taken = new Set((await input.rpc.list({ botId: input.botId })).map((entry) => entry.name));
  let finalName = name;
  for (let n = 2; taken.has(finalName); n++) finalName = `${name.slice(0, 60)}-${n}`;
  await input.rpc.put({
    botId: input.botId,
    destination: { name: finalName, auth: { type: "command" } },
    value: input.value,
  });
  return credentialReference(finalName);
}

/**
 * Asks, with the system alert, whether to save a key found in the draft. iOS also lets the person
 * edit the suggested name; Android's alert has no text field, so it uses the suggestion.
 */
export function askAboutPastedKey(input: {
  title: string;
  save: string;
  sendAnyway: string;
  cancel: string;
  name: string;
  onSave: (name: string) => void;
  onSendAnyway: () => void;
}) {
  if (Platform.OS === "ios") {
    Alert.prompt(
      input.title,
      undefined,
      [
        { text: input.cancel, style: "cancel" },
        { text: input.sendAnyway, onPress: () => input.onSendAnyway() },
        {
          text: input.save,
          onPress: (value?: string) => input.onSave(value?.trim() || input.name),
        },
      ],
      "plain-text",
      input.name,
    );
    return;
  }
  Alert.alert(input.title, undefined, [
    { text: input.cancel, style: "cancel" },
    { text: input.sendAnyway, onPress: () => input.onSendAnyway() },
    { text: input.save, onPress: () => input.onSave(input.name) },
  ]);
}
