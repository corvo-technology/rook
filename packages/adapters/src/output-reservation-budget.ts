/** Below this a retry would leave too little room to answer, so the call moves to a backup instead. */
export const MIN_REASONABLE_OUTPUT_TOKENS = 1024;

/**
 * The output size a provider says its payment limit can still cover, read from a 402 error that
 * names both what the call asked for and what it can afford ("requested up to N tokens, but can
 * only afford M"). Gateways that bill by reservation word it this way, whatever the provider.
 * Only a smaller, reasonable size is returned; a key limit, an empty balance, any other status
 * and text a model wrote itself are not budget advice, so those fail over instead.
 */
export function affordableOutputTokens(
  errorMessage: string | undefined,
  currentLimit: number,
): number | undefined {
  if (!errorMessage || errorMessage.length > 16_384) return;
  if (!Number.isSafeInteger(currentLimit) || currentLimit < 1) return;
  if (
    !/(?:^\s*|\b(?:http(?:\s+status)?|status(?:\s+code)?|error\s+code)\s*[:=]?\s*)402\b|"code"\s*:\s*402\b/i.test(
      errorMessage,
    )
  )
    return;
  // A limit on the key itself is not fixed by asking for less.
  if (/key_limit/i.test(errorMessage)) return;
  const match = errorMessage.match(
    /requires more credits, or fewer max_tokens\.\s*You requested up to (\d+) tokens, but can only afford (\d+)/i,
  );
  if (!match) return;
  const requested = Number(match[1]);
  const affordable = Number(match[2]);
  if (!Number.isSafeInteger(requested) || !Number.isSafeInteger(affordable)) return;
  if (affordable < MIN_REASONABLE_OUTPUT_TOKENS) return;
  if (affordable >= requested || affordable >= currentLimit) return;
  return affordable;
}
