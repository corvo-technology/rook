import type { MessageBlock } from "@corvo/contracts";

export function researchBlockFromPayload(
  payload: Record<string, unknown>,
): Extract<MessageBlock, { kind: "research" }> {
  const status = payload.status;
  return {
    kind: "research",
    researchId: String(payload.researchId ?? ""),
    question: String(payload.question ?? ""),
    status:
      status === "finished" || status === "failed" || status === "cancelled" ? status : "running",
  };
}
