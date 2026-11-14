import type { VoiceTranscribeResult } from "@corvo/adapter-kit";

/**
 * Whether a transcript was heard in a language the person does not speak. Only a provider that
 * says which language it heard can disagree, so one that does not is never retried.
 */
export function heardOutsideSpoken(
  result: VoiceTranscribeResult,
  spoken: readonly string[],
): boolean {
  return spoken.length > 0 && result.language !== undefined && !spoken.includes(result.language);
}

/**
 * Listens a second time, forced into the first language the person speaks, when the first pass
 * was auto-detected as another one. A failed second pass keeps the first transcript.
 */
export async function retryInSpokenLanguage(
  first: VoiceTranscribeResult,
  spoken: readonly string[],
  listen: (language: string) => Promise<VoiceTranscribeResult>,
): Promise<VoiceTranscribeResult> {
  const language = spoken[0];
  if (!language || !heardOutsideSpoken(first, spoken)) return first;
  try {
    return await listen(language);
  } catch {
    return first;
  }
}
