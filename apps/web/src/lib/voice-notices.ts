import { toast } from "@corvo/ui-web";
import { t } from "@lingui/core/macro";

const told = new Set<string>();

function megabytes(sizeBytes: number) {
  return Math.max(1, Math.round(sizeBytes / 1_000_000));
}

/** Said once per session: a model is fetched for the first conversation, and that takes a while. */
export function announceLocalDownload(kind: "listen" | "speak", sizeBytes: number) {
  if (told.has(kind)) return;
  told.add(kind);
  const size = megabytes(sizeBytes);
  toast(
    kind === "listen"
      ? t`Getting the speech model ready (${size} MB). This happens once.`
      : t`Getting the voice ready (${size} MB). This happens once.`,
  );
}

/** Said once per session: the selected voice failed and this computer's voice read the reply. */
export function announceLocalFallback() {
  if (told.has("fallback")) return;
  told.add("fallback");
  toast(t`The voice provider failed, so this reply used the voice on this computer.`);
}
