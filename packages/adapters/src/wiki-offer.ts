import { builtinOffered } from "./run-instructions.js";

/**
 * A file the agent can read the words of: a PDF, or a plain text file. A file can arrive without a
 * type or a name, and this runs while the prompt is built, so it must never throw.
 */
const isDocument = (file: { name?: string; mimeType?: string }) => {
  const type = file.mimeType ?? "";
  return (
    type === "application/pdf" ||
    /\.pdf$/i.test(file.name ?? "") ||
    type.startsWith("text/") ||
    type === "application/json"
  );
};

/**
 * What an agent is told about keeping an attached document in the wiki: offer it, ask first, and
 * save only after a yes. The wiki is the team's shared knowledge, so what goes in it is readable by
 * everyone in the Space; that is why the person is asked rather than assumed. It holds whether or
 * not the wiki has pages, because an empty wiki is exactly where the first document belongs.
 * Nothing is said where the agent cannot ask, cannot save, or has nobody to answer.
 */
export function wikiOfferInstruction(
  files: readonly { name?: string; mimeType?: string }[],
  options: {
    disabled: ReadonlySet<string> | undefined;
    messagingChannelRun: boolean;
    background: boolean;
  },
): string {
  if (options.messagingChannelRun || options.background) return "";
  if (!files.some(isDocument)) return "";
  if (!["ask_user", "save_shared_memory"].every((name) => builtinOffered(options.disabled, name)))
    return "";
  return [
    "If an attached document holds knowledge the team will want again (a contract, policy, manual or specification, not a casual file), then after you have answered, offer to keep it in the wiki with ask_user: say the wiki is where the team keeps what it knows, and that everyone in this space can read it.",
    "Keep it only after a yes, with save_shared_memory and the file's name as file: the wiki reads the whole file part by part and cites its pages. Do not ask again about the same file, or after a no.",
  ].join(" ");
}
