import type { AgentUsage } from "@corvo/adapter-kit";
import type { Api, Model } from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { describe, expect, it } from "vitest";
import { cacheReturnFor, routineGapMinutes, runCacheRetention } from "./cache-retention-policy.js";
import { observedPiStream } from "./pi-usage.js";

const anthropic = { api: "anthropic-messages" } as Pick<Model<Api>, "api" | "compat">;
const responsesWithoutLong = { api: "openai-responses" } as Pick<Model<Api>, "api" | "compat">;
const responsesWithLong = {
  api: "openai-responses",
  compat: { supportsLongCacheRetention: true },
} as Pick<Model<Api>, "api" | "compat">;

describe("cacheReturnFor", () => {
  it("keeps an interactive run on the short cache", () => {
    expect(cacheReturnFor({})).toBe("soon");
  });

  it("holds the long cache for resumed runs and ticket continuations", () => {
    expect(cacheReturnFor({ resumed: true })).toBe("later");
    expect(cacheReturnFor({ ticket: true })).toBe("later");
  });

  it("uses the long cache only for routines that return between five and sixty minutes", () => {
    expect(cacheReturnFor({ routineGapMinutes: 4 })).toBe("soon");
    expect(cacheReturnFor({ routineGapMinutes: 5 })).toBe("later");
    expect(cacheReturnFor({ routineGapMinutes: 30 })).toBe("later");
    expect(cacheReturnFor({ routineGapMinutes: 60 })).toBe("later");
    expect(cacheReturnFor({ routineGapMinutes: 61 })).toBe("soon");
    expect(cacheReturnFor({ routineGapMinutes: 24 * 60 })).toBe("soon");
  });
});

describe("routineGapMinutes", () => {
  const from = new Date("2027-03-01T10:00:00Z");

  it("reads a watch interval directly", () => {
    expect(routineGapMinutes({ watchEveryMinutes: 15 }, from)).toBe(15);
  });

  it("derives the gap between two firings of a cron schedule", () => {
    expect(routineGapMinutes({ crons: ["*/30 * * * *"] }, from)).toBe(30);
    expect(routineGapMinutes({ crons: ["0 8 * * *"], timezone: "UTC" }, from)).toBe(24 * 60);
  });

  it("has no gap for one-shot or missing schedules", () => {
    expect(routineGapMinutes({ crons: ["@once"] }, from)).toBeUndefined();
    expect(routineGapMinutes({}, from)).toBeUndefined();
  });
});

describe("runCacheRetention", () => {
  it("never overrides a retention the connection declares", () => {
    expect(runCacheRetention(anthropic, "short", "later")).toBe("short");
    expect(runCacheRetention(anthropic, "none", "later")).toBe("none");
    expect(runCacheRetention(anthropic, "long", "soon")).toBe("long");
  });

  it("leaves the default alone when the run comes back soon", () => {
    expect(runCacheRetention(anthropic, undefined, "soon")).toBeUndefined();
    expect(runCacheRetention(anthropic, undefined, undefined)).toBeUndefined();
  });

  it("asks for the long cache when the run comes back later and the protocol allows it", () => {
    expect(runCacheRetention(anthropic, undefined, "later")).toBe("long");
    expect(runCacheRetention(responsesWithLong, undefined, "later")).toBe("long");
  });

  it("falls back to the default instead of failing when the protocol has no long cache", () => {
    expect(runCacheRetention(responsesWithoutLong, undefined, "later")).toBeUndefined();
    expect(
      runCacheRetention(
        {
          api: "anthropic-messages",
          compat: { supportsLongCacheRetention: false },
        },
        undefined,
        "later",
      ),
    ).toBeUndefined();
  });

  it("gives every call of a run the same answer", () => {
    const answers = new Set(
      Array.from({ length: 5 }, () => runCacheRetention(anthropic, undefined, "later")),
    );
    expect(answers.size).toBe(1);
  });
});

describe("cache writes by lifetime", () => {
  it("reports the one-hour share of the cache writes", async () => {
    const model = {
      provider: "anthropic",
      id: "fixture",
      name: "Fixture",
      api: "anthropic-messages",
      baseUrl: "https://model.example.test",
      reasoning: false,
      input: ["text"],
      cost: { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 1.25 },
      contextWindow: 8192,
      maxTokens: 256,
    } as Model<Api>;
    let reported: AgentUsage | null = null;
    const events = [
      {
        type: "message_start",
        message: {
          id: "fixture",
          type: "message",
          role: "assistant",
          model: "fixture",
          content: [],
          stop_reason: null,
          usage: {
            input_tokens: 10,
            output_tokens: 0,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 300,
            cache_creation: {
              ephemeral_5m_input_tokens: 100,
              ephemeral_1h_input_tokens: 200,
            },
          },
        },
      },
      {
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 1 },
      },
      { type: "message_stop" },
    ];
    const stream = observedPiStream(
      {
        streamSimple: anthropicMessagesApi().streamSimple,
      } as unknown as Parameters<typeof observedPiStream>[0],
      model,
      {
        systemPrompt: "Stable guidance",
        messages: [{ role: "user", content: "Hello", timestamp: 0 }],
      } as Parameters<typeof observedPiStream>[2],
      {
        apiKey: "fake-fixture-key",
        cacheRetention: "long",
        fetch: async () =>
          new Response(
            events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(""),
            { headers: { "content-type": "text/event-stream" } },
          ),
      },
      () => {},
      {
        beforeCall: () => "reservation",
        afterCall: (_id, usage) => {
          reported = usage;
        },
      },
    );
    for await (const _ of stream) void _;
    expect(reported).toMatchObject({
      cacheWriteTokens: 300,
      cacheWrite1hTokens: 200,
    });
  });
});
