import type { VoiceAccountErrorCode } from "@corvo/contracts";

/** The user's voice provider account is out of credit or rejected the key; not a server fault. */
export class VoiceAccountError extends Error {
  constructor(
    readonly code: VoiceAccountErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "VoiceAccountError";
  }
}

/**
 * A voice provider answered with a failure. `status` lets callers tell a passing fault (timeout,
 * 429, 5xx) from a refusal; `detail` is the provider's own reason, already stripped of secrets.
 */
export class VoiceProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "VoiceProviderError";
  }
}
