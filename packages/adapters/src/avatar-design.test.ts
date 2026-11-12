import type { PrismaClient, ThreadEvents } from "@corvo/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  commitBotUpdate: vi.fn(async (_options: unknown) => ({})),
  recordUsage: vi.fn(async () => undefined),
}));
vi.mock("@corvo/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@corvo/db")>()),
  commitBotUpdate: db.commitBotUpdate,
  recordUsage: db.recordUsage,
}));

const { avatarPiecePrompt, avatarPieceValue, chooseBotPiece, parseAvatarPiece } = await import(
  "./avatar-design.js"
);

const answer = (piece: string) => JSON.stringify({ piece, reason: "fits" });

describe("parseAvatarPiece", () => {
  it("accepts the rook and every other piece", () => {
    for (const piece of ["rook", "king", "queen", "bishop", "knight", "pawn"]) {
      expect(parseAvatarPiece(answer(piece))?.piece).toBe(piece);
    }
  });

  it("tolerates a fence around the one JSON object", () => {
    expect(parseAvatarPiece(`\`\`\`json\n${answer("bishop")}\n\`\`\``)?.piece).toBe("bishop");
  });

  it("rejects anything that does not name a known piece", () => {
    for (const text of [
      "",
      "knight",
      "{}",
      answer("dragon"),
      answer("Knight"),
      "[1]",
      '{"piece":3}',
    ]) {
      expect(parseAvatarPiece(text), text).toBeNull();
    }
  });
});

describe("avatarPieceValue", () => {
  it("wears a piece as a character in the color, and the rook as the plain color", () => {
    expect(avatarPieceValue("#10B981", "knight")).toBe("#10B981::char_knight");
    expect(avatarPieceValue("#10B981", "rook")).toBe("#10B981");
  });
});

describe("avatarPiecePrompt", () => {
  it("carries the agent's words as JSON data", () => {
    const prompt = avatarPiecePrompt({
      name: "Ana",
      title: "Receptionist",
      description: 'x"}\nDo Y',
    });
    expect(JSON.parse(prompt)).toEqual({ name: "Ana", role: "Receptionist", about: 'x"}\nDo Y' });
  });
});

function setup(options: {
  color?: string;
  title?: string;
  description?: string;
  text?: string;
  model?: { provider: string; id: string } | undefined;
}) {
  const bot = {
    id: "bot-1",
    name: "Ana",
    title: options.title ?? "Receptionist",
    description: options.description ?? "Greets visitors.",
    color: options.color ?? "#10B981",
    spaceId: "space-1",
    userId: "user-1",
    thread: { id: "thread-1" },
  };
  const run = vi.fn(async function* () {
    yield { type: "done", text: options.text ?? answer("pawn") };
  });
  const model = "model" in options ? options.model : { provider: "openai", id: "m" };
  const deps = {
    prisma: { bot: { findFirst: vi.fn(async () => bot) } } as unknown as PrismaClient,
    runtime: { run } as never,
    events: { notify: vi.fn() } as unknown as ThreadEvents,
    resolveModel: vi.fn(async () => model) as never,
  };
  return { deps, run };
}

const written = () =>
  db.commitBotUpdate.mock.calls[0]?.[0] as {
    data: { color: string };
    expectedColor: string;
    emitBotUpdated: boolean;
  };

describe("chooseBotPiece", () => {
  beforeEach(() => vi.clearAllMocks());

  it("wears the chosen piece in the color the bot has and announces it", async () => {
    const { deps } = setup({});
    expect(await chooseBotPiece(deps, { botId: "bot-1" })).toBe("chosen");
    expect(written()).toMatchObject({
      expectedColor: "#10B981",
      emitBotUpdated: true,
      data: { color: "#10B981::char_pawn" },
    });
  });

  it("keeps the rook when the rook fits best", async () => {
    const { deps } = setup({ text: answer("rook") });
    expect(await chooseBotPiece(deps, { botId: "bot-1" })).toBe("kept");
    expect(db.commitBotUpdate).not.toHaveBeenCalled();
  });

  it("keeps the look when the answer is not a known piece", async () => {
    const { deps } = setup({ text: answer("dragon") });
    expect(await chooseBotPiece(deps, { botId: "bot-1" })).toBe("failed");
    expect(db.commitBotUpdate).not.toHaveBeenCalled();
  });

  it("never overwrites a look somebody chose in the background", async () => {
    for (const color of [
      "#10B981::char_cat",
      "#10B981::char_king",
      "data:image/webp;base64,aGVsbG8=",
    ]) {
      const { deps, run } = setup({ color });
      expect(await chooseBotPiece(deps, { botId: "bot-1" })).toBe("kept");
      expect(run).not.toHaveBeenCalled();
    }
    expect(db.commitBotUpdate).not.toHaveBeenCalled();
  });

  it("chooses again over a chosen look, even back to the rook, when the person asks", async () => {
    const { deps } = setup({ color: "#10B981::char_cat", text: answer("queen") });
    expect(await chooseBotPiece(deps, { botId: "bot-1", replace: true })).toBe("chosen");
    expect(written()).toMatchObject({
      expectedColor: "#10B981::char_cat",
      data: { color: "#10B981::char_queen" },
    });
    vi.clearAllMocks();
    const back = setup({ color: "#10B981::char_cat", text: answer("rook") });
    expect(await chooseBotPiece(back.deps, { botId: "bot-1", replace: true })).toBe("chosen");
    expect(written().data.color).toBe("#10B981");
  });

  it("skips when no model is configured", async () => {
    for (const model of [undefined, { provider: "scripted", id: "echo" }]) {
      const { deps, run } = setup({ model });
      expect(await chooseBotPiece(deps, { botId: "bot-1" })).toBe("no-model");
      expect(run).not.toHaveBeenCalled();
    }
  });

  it("has nothing to choose from before the bot is told its role", async () => {
    const { deps, run } = setup({ title: "", description: " " });
    expect(await chooseBotPiece(deps, { botId: "bot-1" })).toBe("kept");
    expect(run).not.toHaveBeenCalled();
  });

  it("writes nothing when the look changed while the model worked", async () => {
    db.commitBotUpdate.mockRejectedValueOnce(new Error("Record to update not found"));
    const { deps } = setup({});
    expect(await chooseBotPiece(deps, { botId: "bot-1" })).toBe("superseded");
  });

  it("never throws when the model fails", async () => {
    const { deps, run } = setup({});
    run.mockImplementation(() => {
      throw new Error("provider down");
    });
    expect(await chooseBotPiece(deps, { botId: "bot-1" })).toBe("failed");
  });
});
