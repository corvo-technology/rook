import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/** Stripe's REST wire format, shared by the billing and the Connect adapters. */
export const STRIPE_API_VERSION = "2026-09-30.endive";
const WEBHOOK_TOLERANCE_SECONDS = 300;
const MAX_RETRIES = 2;
const MAX_RETRY_DELAY_MS = 5_000;

export interface StripeHttpConfig {
  secretKey: string;
  fetch?: typeof fetch;
  apiBase?: string;
  sleep?: (ms: number) => Promise<void>;
}

const errorSchema = z.object({
  error: z.object({
    type: z.string().optional(),
    code: z.string().optional(),
    param: z.string().optional(),
    message: z.string().optional(),
  }),
});

export class StripeRequestError extends Error {
  constructor(
    message: string,
    readonly type: string | undefined,
    readonly code?: string,
    readonly param?: string,
  ) {
    super(message);
    this.name = "StripeRequestError";
  }
}

export interface StripeRequestOptions {
  /** Acts on this connected account (a direct charge); sent as `Stripe-Account`. */
  account?: string;
  /** Repeats of one logical call share it; by default each call gets its own. */
  idempotencyKey?: string;
}

export class StripeHttp {
  private readonly fetchImpl: typeof fetch;
  private readonly apiBase: string;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly config: StripeHttpConfig) {
    this.fetchImpl = config.fetch ?? fetch;
    this.apiBase = config.apiBase ?? "https://api.stripe.com";
    this.sleep = config.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async request(
    method: "GET" | "POST" | "DELETE",
    path: string,
    params?: Record<string, unknown> | string,
    options: StripeRequestOptions = {},
  ): Promise<unknown> {
    const body = typeof params === "string" ? params : params && encodeStripeForm(params);
    // One key per call: retries replay the first outcome, a later call starts fresh. Stripe
    // keeps a key's response, even a 500, for 24 hours, so a fixed key would wedge the call.
    const idempotencyKey = method === "POST" ? (options.idempotencyKey ?? randomUUID()) : undefined;
    for (let attempt = 0; ; attempt++) {
      const response = await this.fetchImpl(`${this.apiBase}${path}`, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
        headers: {
          Authorization: `Bearer ${this.config.secretKey}`,
          "Stripe-Version": STRIPE_API_VERSION,
          Accept: "application/json",
          ...(options.account ? { "Stripe-Account": options.account } : {}),
          ...(body === undefined ? {} : { "Content-Type": "application/x-www-form-urlencoded" }),
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        },
        body,
      });
      const json: unknown = await response.json().catch(() => undefined);
      if (response.ok) {
        if (json === undefined) throw new Error("Invalid Stripe response");
        return json;
      }
      if (attempt < MAX_RETRIES && shouldRetry(response)) {
        await this.sleep(retryDelayMs(response, attempt));
        continue;
      }
      const error = errorSchema.safeParse(json).data?.error;
      const message = error?.message?.replaceAll(this.config.secretKey, "[redacted]");
      throw new StripeRequestError(
        `Stripe request failed (${response.status})${message ? `: ${message}` : ""}`,
        error?.type,
        error?.code,
        error?.param,
      );
    }
  }
}

/** Stripe's explicit hint wins; otherwise lock conflicts, rate limits and 5xx are transient. */
function shouldRetry(response: Response): boolean {
  const hint = response.headers.get("stripe-should-retry");
  if (hint === "true") return true;
  if (hint === "false") return false;
  return response.status === 409 || response.status === 429 || response.status >= 500;
}

function retryDelayMs(response: Response, attempt: number): number {
  const retryAfter = Number(response.headers.get("retry-after"));
  const delay = retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt;
  return Math.min(delay, MAX_RETRY_DELAY_MS);
}

/** Stripe's bracketed form encoding: `line_items[0][price]=...`. Undefined values are omitted. */
export function encodeStripeForm(params: Record<string, unknown>): string {
  const form = new URLSearchParams();
  const append = (key: string, value: unknown) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      for (const [i, entry] of value.entries()) append(`${key}[${i}]`, entry);
    } else if (typeof value === "object")
      for (const [k, v] of Object.entries(value)) append(`${key}[${k}]`, v);
    else form.append(key, String(value));
  };
  for (const [key, value] of Object.entries(params)) append(key, value);
  return form.toString();
}

/** `stripe-signature` header value for `body` at `timestamp` (seconds). */
export function signStripeWebhook(secret: string, body: string, timestamp: number): string {
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

/** True when the header carries a current, valid signature of the raw body. */
export function verifyStripeSignature(
  secret: string,
  rawBody: string,
  headers: Headers,
  nowMs: number,
): boolean {
  const parts = (headers.get("stripe-signature") ?? "").split(",").map((part) => part.split("="));
  const timestamp = Number(parts.find(([key]) => key === "t")?.[1]);
  if (!Number.isFinite(timestamp)) return false;
  if (Math.abs(nowMs / 1000 - timestamp) > WEBHOOK_TOLERANCE_SECONDS) return false;
  const expected = Buffer.from(
    createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex"),
  );
  return parts.some(([key, value]) => {
    if (key !== "v1" || !value) return false;
    const candidate = Buffer.from(value);
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  });
}
