import type { ConsultationAction, ConsultationTurn } from "@corvo/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  type ActionApplyDeps,
  type ActionToolCall,
  actionsInstructions,
  annotateChecks,
  applyActions,
  buildActionsPrompt,
  checkFollowUp,
  localDay,
  parseActions,
  resolveActionTools,
  zonedToIso,
} from "./consultation-actions.js";
import {
  type ConsultationJobDeps,
  type ConsultationRecord,
  type ConsultationStore,
  processConsultation,
  readConsultationResult,
} from "./consultation-job.js";

// Tuesday 1 December 2026, 10:00 in São Paulo (UTC-3, no daylight saving).
const CONSULTED_AT = new Date("2026-12-01T13:00:00.000Z");
const ZONE = "America/Sao_Paulo";
const context = { turnCount: 8, timeZone: ZONE, consultedAt: CONSULTED_AT };
const answer = (...actions: unknown[]) => JSON.stringify({ actions });

describe("zonedToIso", () => {
  it("reads a wall-clock time in the clinic's zone as one exact moment", () => {
    expect(zonedToIso("2026-12-08T14:00", ZONE)).toBe("2026-12-08T14:00:00-03:00");
    expect(zonedToIso("2026-12-08T14:00", "UTC")).toBe("2026-12-08T14:00:00+00:00");
    expect(zonedToIso("2026-12-08T14:30", "Asia/Kolkata")).toBe("2026-12-08T14:30:00+05:30");
  });

  it("follows daylight saving on each side of the change", () => {
    expect(zonedToIso("2026-03-07T12:00", "America/New_York")).toBe("2026-03-07T12:00:00-05:00");
    expect(zonedToIso("2026-03-09T12:00", "America/New_York")).toBe("2026-03-09T12:00:00-04:00");
  });

  it("reads a date alone as its first minute, or its last", () => {
    expect(zonedToIso("2026-12-15", ZONE)).toBe("2026-12-15T00:00:00-03:00");
    expect(zonedToIso("2026-12-15", ZONE, true)).toBe("2026-12-15T23:59:00-03:00");
  });

  it("refuses what is not a real date or time", () => {
    expect(zonedToIso("2026-02-31T10:00", ZONE)).toBeNull();
    expect(zonedToIso("2026-12-08T25:00", ZONE)).toBeNull();
    expect(zonedToIso("next tuesday", ZONE)).toBeNull();
    // The hour a spring-forward change skips never happens on the wall clock.
    expect(zonedToIso("2026-03-08T02:30", "America/New_York")).toBeNull();
  });
});

describe("localDay", () => {
  it("gives the date and weekday on the clinic's clock, not on UTC's", () => {
    expect(localDay(new Date("2026-12-02T01:30:00Z"), ZONE)).toEqual({
      date: "2026-12-01",
      time: "22:30",
      weekday: "Tuesday",
    });
  });
});

describe("the extraction prompt", () => {
  it("anchors relative dates in the consultation date, weekday and zone, and numbers the lines", () => {
    const turns: ConsultationTurn[] = [
      { speaker: "professional", startMs: 0, text: "Volte na terça que vem." },
      { speaker: "patient", startMs: 4000, text: "Combinado." },
    ];
    const prompt = buildActionsPrompt(turns, {
      clientName: "Maria",
      consultedAt: CONSULTED_AT,
      timeZone: ZONE,
    });
    expect(prompt).toContain("Consultation date: 2026-12-01 (Tuesday), 10:00");
    expect(prompt).toContain("America/Sao_Paulo");
    expect(prompt).toContain("[0] Profissional: Volte na terça que vem.");
    expect(prompt).toContain("[1] Paciente: Combinado.");
    expect(actionsInstructions()).toContain("consultation-actions/");
  });
});

describe("parseActions", () => {
  const followUp = {
    kind: "follow_up",
    title: "Retorno",
    detail: "Retorno na terça que vem às 14h.",
    evidence: [2, 3],
    payload: {
      startsAt: "2026-12-08T14:00",
      whenText: "terça que vem às 14h",
      durationMinutes: 30,
      reason: "Revisão do canal",
      professional: "Dra. Lima",
    },
  };

  it("keeps each agreed action with its kind, payload, status and evidence", () => {
    const actions = parseActions(
      answer(
        followUp,
        {
          kind: "prescription",
          title: "Receita",
          detail: "Dipirona.",
          evidence: [4],
          payload: {
            items: [
              { drug: "Dipirona", dose: "500 mg", posology: "de 8 em 8 horas", duration: "3 dias" },
            ],
          },
        },
        {
          kind: "exam_request",
          title: "Exame",
          detail: "",
          evidence: [5],
          payload: { exams: ["Hemograma"], indication: "febre" },
        },
        { kind: "certificate", title: "Atestado", detail: "", evidence: [6], payload: { days: 2 } },
        {
          kind: "patient_message",
          title: "Orientação",
          detail: "",
          evidence: [7],
          payload: { text: "Evite alimentos gelados." },
        },
      ),
      context,
    );
    expect(actions.map((a) => [a.id, a.kind, a.status])).toEqual([
      ["a1", "follow_up", "proposed"],
      ["a2", "prescription", "proposed"],
      ["a3", "exam_request", "proposed"],
      ["a4", "certificate", "proposed"],
      ["a5", "patient_message", "proposed"],
    ]);
    expect(actions[0]?.evidence).toEqual([2, 3]);
    expect(actions[1]?.payload).toEqual({
      items: [
        { drug: "Dipirona", dose: "500 mg", posology: "de 8 em 8 horas", duration: "3 dias" },
      ],
    });
  });

  it("resolves a relative visit to an absolute datetime in the clinic's zone", () => {
    const [action] = parseActions(answer(followUp), context);
    expect(action?.payload).toMatchObject({
      startsAt: "2026-12-08T14:00:00-03:00",
      whenText: "terça que vem às 14h",
      durationMinutes: 30,
    });
  });

  it("keeps a vague date as a range, from the first minute of the first day to the last of the last", () => {
    const [action] = parseActions(
      answer({
        ...followUp,
        payload: { range: { from: "2026-12-14", to: "2026-12-18" }, whenText: "em uns 15 dias" },
      }),
      context,
    );
    expect(action?.payload).toEqual({
      range: { from: "2026-12-14T00:00:00-03:00", to: "2026-12-18T23:59:00-03:00" },
      whenText: "em uns 15 dias",
    });
  });

  it("does not turn a date in the past or a made-up one into a moment", () => {
    const [past] = parseActions(
      answer({
        ...followUp,
        payload: { startsAt: "2026-11-20T10:00", whenText: "semana que vem" },
      }),
      context,
    );
    expect(past?.payload).toEqual({ whenText: "semana que vem" });
    expect(
      parseActions(answer({ ...followUp, payload: { startsAt: "2026-02-31T10:00" } }), context),
    ).toEqual([]);
  });

  it("drops what it cannot trust: unknown kinds, wrong payloads, no evidence, no title", () => {
    const actions = parseActions(
      answer(
        { ...followUp, kind: "refund" },
        { ...followUp, evidence: [] },
        { ...followUp, evidence: [99] },
        { ...followUp, title: "  " },
        { kind: "prescription", title: "Receita", evidence: [1], payload: { items: [] } },
        { kind: "exam_request", title: "Exame", evidence: [1], payload: { exams: "Hemograma" } },
        "not an action",
      ),
      context,
    );
    expect(actions).toEqual([]);
  });

  it("ignores fields a kind does not have instead of passing them on", () => {
    const [action] = parseActions(
      answer({
        kind: "certificate",
        title: "Atestado",
        evidence: [1],
        payload: { days: 3, doctorId: "x", __proto__: { admin: true } },
      }),
      context,
    );
    expect(action?.payload).toEqual({ days: 3 });
  });

  it("answers nothing for an answer without a usable list", () => {
    expect(parseActions(undefined, context)).toEqual([]);
    expect(parseActions("no json here", context)).toEqual([]);
    expect(parseActions('{"actions":"none"}', context)).toEqual([]);
    expect(parseActions('{"actions":[]}', context)).toEqual([]);
  });
});

describe("resolveActionTools", () => {
  const offered = [
    "mcp_clients_get",
    "mcp_appointments_availability",
    "mcp_appointments_conflicts",
    "mcp_appointments_create",
    "mcp_draft_prescription",
    "mcp_draft_exam_request",
    "mcp_draft_certificate",
  ];

  it("finds the tool of each kind by what its name says", () => {
    expect(resolveActionTools(offered)).toEqual({
      availability: "mcp_appointments_availability",
      conflicts: "mcp_appointments_conflicts",
      follow_up: "mcp_appointments_create",
      prescription: "mcp_draft_prescription",
      exam_request: "mcp_draft_exam_request",
      certificate: "mcp_draft_certificate",
    });
  });

  it("lets the template name a tool, over the lookup", () => {
    const tools = resolveActionTools(offered, {
      follow_up: "schedule_visit",
      patient_message: "notify_patient",
    });
    expect(tools.follow_up).toBe("schedule_visit");
    expect(tools.patient_message).toBe("notify_patient");
    expect(tools.prescription).toBe("mcp_draft_prescription");
  });

  it("leaves a kind without a tool out", () => {
    expect(resolveActionTools(["mcp_clients_get"])).toEqual({});
  });
});

describe("checking a follow-up against the agenda", () => {
  const tools = {
    availability: "mcp_appointments_availability",
    conflicts: "mcp_appointments_conflicts",
  };
  const ctx = { clientId: "client-1", timeZone: ZONE };
  const payload = {
    startsAt: "2026-12-08T14:00:00-03:00",
    durationMinutes: 45,
    professional: "Dra. Lima",
  };
  const structured = (data: unknown) => ({ ok: true as const, data: { structuredContent: data } });

  it("says the slot is free, asking both tools for the exact start and the end of the visit", async () => {
    const call = vi.fn<ActionToolCall>(async (tool) =>
      tool === tools.availability ? structured({ available: true }) : structured({ conflicts: [] }),
    );
    expect(await checkFollowUp(call, tools, payload, ctx)).toEqual({ available: true });
    expect(call).toHaveBeenCalledWith(
      "mcp_appointments_availability",
      expect.objectContaining({
        start: "2026-12-08T14:00:00-03:00",
        end: "2026-12-08T17:45:00.000Z",
        durationMinutes: 45,
        professional: "Dra. Lima",
        clientId: "client-1",
      }),
    );
  });

  it("reports a conflict and the agenda's suggestion", async () => {
    const call: ActionToolCall = async (tool) =>
      tool === tools.availability
        ? structured({ available: false, suggestion: "2026-12-08T15:00:00-03:00" })
        : structured({ conflicts: [{ title: "Outro atendimento" }] });
    expect(await checkFollowUp(call, tools, payload, ctx)).toEqual({
      available: false,
      conflict: "Outro atendimento",
      suggestion: "2026-12-08T15:00:00-03:00",
    });
  });

  it("works from one tool alone, and reads JSON text as well as structured content", async () => {
    const onlyConflicts = { conflicts: tools.conflicts };
    const text = async () => ({
      ok: true as const,
      data: { content: [{ type: "text", text: JSON.stringify({ conflict: "Almoço" }) }] },
    });
    expect(await checkFollowUp(text, onlyConflicts, payload, ctx)).toEqual({
      available: false,
      conflict: "Almoço",
    });
    const onlyAvailability = { availability: tools.availability };
    expect(
      await checkFollowUp(
        async () => structured({ available: true }),
        onlyAvailability,
        payload,
        ctx,
      ),
    ).toEqual({ available: true });
  });

  it("leaves the check out when the connector lacks the tools, fails, or answers nothing readable", async () => {
    const call = vi.fn<ActionToolCall>(async () => structured({ available: true }));
    expect(await checkFollowUp(call, {}, payload, ctx)).toBeNull();
    expect(call).not.toHaveBeenCalled();
    expect(await checkFollowUp(async () => ({ ok: false }), tools, payload, ctx)).toBeNull();
    expect(
      await checkFollowUp(
        async () => {
          throw new Error("down");
        },
        tools,
        payload,
        ctx,
      ),
    ).toBeNull();
    expect(
      await checkFollowUp(
        async () => structured({ hello: 1 }),
        { availability: tools.availability },
        payload,
        ctx,
      ),
    ).toBeNull();
    expect(await checkFollowUp(call, tools, { durationMinutes: 30 }, ctx)).toBeNull();
  });

  it("annotates only follow-ups with an exact start", async () => {
    const actions: ConsultationAction[] = [
      {
        id: "a1",
        kind: "follow_up",
        title: "t",
        detail: "",
        payload: payload as never,
        status: "proposed",
        evidence: [0],
      },
      {
        id: "a2",
        kind: "follow_up",
        title: "t",
        detail: "",
        payload: { whenText: "em breve" },
        status: "proposed",
        evidence: [0],
      },
      {
        id: "a3",
        kind: "certificate",
        title: "t",
        detail: "",
        payload: { days: 1 },
        status: "proposed",
        evidence: [0],
      },
    ];
    const out = await annotateChecks(
      actions,
      async () => structured({ available: true }),
      tools,
      ctx,
    );
    expect(out[0]?.check).toEqual({ available: true });
    expect(out[1]?.check).toBeUndefined();
    expect(out[2]?.check).toBeUndefined();
  });
});

describe("applyActions", () => {
  const actions: ConsultationAction[] = [
    {
      id: "a1",
      kind: "follow_up",
      title: "Retorno",
      detail: "",
      payload: { startsAt: "2026-12-08T14:00:00-03:00" },
      status: "proposed",
      evidence: [1],
    },
    {
      id: "a2",
      kind: "prescription",
      title: "Receita",
      detail: "",
      payload: { items: [{ drug: "Dipirona" }] },
      status: "proposed",
      evidence: [2],
    },
    {
      id: "a3",
      kind: "certificate",
      title: "Atestado",
      detail: "",
      payload: { days: 2 },
      status: "proposed",
      evidence: [3],
    },
  ];
  const request = (actionIds: string[], edits: Record<string, Record<string, unknown>> = {}) => ({
    actionIds,
    edits,
    consultationId: "cons-1",
    context: { clientId: "client-1", appointmentId: "appt-1" },
  });

  function harness(options: { tools?: ActionApplyDeps["tools"]; call?: ActionToolCall } = {}) {
    const runs = new Map<string, { status: "applying" | "applied" | "failed" }>();
    const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
    const audits: Array<Parameters<ActionApplyDeps["audit"]>[0]> = [];
    const deps: ActionApplyDeps = {
      tools: options.tools ?? {
        follow_up: "mcp_appointments_create",
        prescription: "mcp_draft_prescription",
      },
      claim: async (id) => {
        const run = runs.get(id);
        if (run?.status === "applied") return "applied";
        if (run?.status === "applying") return "busy";
        runs.set(id, { status: "applying" });
        return "claimed";
      },
      settle: async (id, outcome) => void runs.set(id, { status: outcome.status }),
      call:
        options.call ??
        (async (tool, args) => {
          calls.push({ tool, args });
          return { ok: true, data: { structuredContent: { id: "x" } } };
        }),
      audit: (event) => void audits.push(event),
    };
    return { deps, runs, calls, audits };
  }

  it("runs each approved action through the tool of its kind, with the patient and the idempotency key", async () => {
    const h = harness();
    const out = await applyActions(h.deps, actions, request(["a2", "a1"]));
    expect(out.map((a) => [a.id, a.status])).toEqual([
      ["a2", "applied"],
      ["a1", "applied"],
    ]);
    expect(h.calls.map((c) => c.tool)).toEqual([
      "mcp_draft_prescription",
      "mcp_appointments_create",
    ]);
    expect(h.calls[1]?.args).toMatchObject({
      startsAt: "2026-12-08T14:00:00-03:00",
      clientId: "client-1",
      appointmentId: "appt-1",
      consultationId: "cons-1",
      actionId: "a1",
      idempotencyKey: "cons-1:a1",
    });
  });

  it("never runs an action that was not named", async () => {
    const h = harness();
    await applyActions(h.deps, actions, request(["a1"]));
    expect(h.calls).toHaveLength(1);
  });

  it("uses the person's edit instead of the proposal, and returns it", async () => {
    const h = harness();
    const out = await applyActions(
      h.deps,
      actions,
      request(["a1"], { a1: { startsAt: "2026-12-09T09:00:00-03:00" } }),
    );
    expect(h.calls[0]?.args.startsAt).toBe("2026-12-09T09:00:00-03:00");
    expect(out[0]?.payload).toEqual({ startsAt: "2026-12-09T09:00:00-03:00" });
  });

  it("is idempotent: applying again calls nothing and still says applied", async () => {
    const h = harness();
    await applyActions(h.deps, actions, request(["a1", "a2"]));
    const again = await applyActions(h.deps, actions, request(["a1", "a2", "a1"]));
    expect(h.calls).toHaveLength(2);
    expect(again.map((a) => [a.id, a.status])).toEqual([
      ["a1", "applied"],
      ["a2", "applied"],
    ]);
  });

  it("reports a failure with a code and lets a later call try again", async () => {
    let failing = true;
    const h = harness({
      call: async () =>
        failing
          ? { ok: false, message: "patient Maria Souza has no record" }
          : { ok: true, data: {} },
    });
    const first = await applyActions(h.deps, actions, request(["a2"]));
    expect(first[0]).toMatchObject({ status: "failed", error: "connector_failed" });
    expect(JSON.stringify(first)).not.toContain("Maria Souza");
    expect(h.audits.map((e) => e.type)).toEqual(["consultation.action_failed"]);
    // The failed mark is not "applied", so it may be claimed again; the harness frees it.
    h.runs.delete("a2");
    failing = false;
    const second = await applyActions(h.deps, actions, request(["a2"]));
    expect(second[0]?.status).toBe("applied");
  });

  it("treats a tool that answers with an error, or throws, as a failure and keeps going", async () => {
    const answers = [{ ok: true as const, data: { isError: true } }, "throw" as const];
    const h = harness({
      call: async () => {
        const next = answers.shift();
        if (next === "throw") throw new Error("boom");
        return next ?? { ok: true as const, data: {} };
      },
    });
    const out = await applyActions(h.deps, actions, request(["a1", "a2"]));
    expect(out.map((a) => a.status)).toEqual(["failed", "failed"]);
  });

  it("skips a kind the connector has no tool for, without claiming it", async () => {
    const h = harness({ tools: {} });
    const out = await applyActions(h.deps, actions, request(["a3"]));
    expect(out[0]).toMatchObject({ status: "skipped", error: "no_tool" });
    expect(h.runs.size).toBe(0);
  });

  it("skips an action another call is applying right now", async () => {
    const h = harness();
    h.runs.set("a1", { status: "applying" });
    const out = await applyActions(h.deps, actions, request(["a1"]));
    expect(out[0]).toMatchObject({ status: "skipped", error: "in_progress" });
    expect(h.calls).toHaveLength(0);
  });

  it("audits each execution with identifiers and the outcome, never the content", async () => {
    const h = harness();
    await applyActions(h.deps, actions, request(["a2"]));
    expect(h.audits).toEqual([
      {
        type: "consultation.action_applied",
        actionId: "a2",
        kind: "prescription",
        tool: "mcp_draft_prescription",
        outcome: "applied",
      },
    ]);
    expect(JSON.stringify(h.audits)).not.toContain("Dipirona");
  });
});

describe("processing a consultation also extracts the agreed actions", () => {
  const record = (): ConsultationRecord => ({
    id: "cons-1",
    partnerId: "partner-1",
    tenantId: "tenant-1",
    spaceId: "space-1",
    ownerUserId: "owner-1",
    state: "processing",
    template: "prontu_evolution",
    context: { clientId: "client-1", appointmentId: "appt-1", clientName: "Maria" },
    createdAt: CONSULTED_AT,
    resultArtifactId: null,
    purgedAt: null,
    timezone: ZONE,
  });

  function run(options: {
    complete: ConsultationJobDeps["complete"];
    actionTools?: ConsultationJobDeps["actionTools"];
  }) {
    let current = record();
    const objects = new Map<string, Uint8Array>([["chunk-0", new Uint8Array([1])]]);
    let n = 0;
    const settled: unknown[] = [];
    const store: ConsultationStore = {
      load: async () => current,
      chunks: async () => [{ seq: 0, artifactId: "chunk-0", mimeType: "audio/webm" }],
      setResult: async (_id, artifactId) => {
        current = { ...current, resultArtifactId: artifactId };
        return true;
      },
      settle: async (_id, outcome) => {
        settled.push(outcome);
        return true;
      },
    };
    const toolCalls: string[] = [];
    const deps: ConsultationJobDeps = {
      store,
      artifacts: {
        get: async (id: string) => objects.get(id) as Uint8Array,
        put: async (artifact: { bytes: Uint8Array }) => {
          const id = `result-${++n}`;
          objects.set(id, artifact.bytes);
          return { id, hash: "" };
        },
        remove: async (id: string) => void objects.delete(id),
      },
      transcribe: async () => ({
        status: "transcribed",
        text: "Bom dia. Como está a dor? Vamos marcar o retorno para terça que vem às 14h. Vou prescrever dipirona 500 mg de 8 em 8 horas.",
      }),
      complete: options.complete,
      callTool: async (_record, tool) => {
        toolCalls.push(tool);
        if (tool === "mcp_records_get_by_client") {
          return { ok: true, data: { structuredContent: { recordId: "rec-1" } } };
        }
        if (tool === "mcp_appointments_availability") {
          return {
            ok: true,
            data: {
              structuredContent: { available: false, suggestion: "2026-12-08T15:00:00-03:00" },
            },
          };
        }
        return { ok: true, data: { structuredContent: { entryId: "entry-1" } } };
      },
      ...(options.actionTools ? { actionTools: options.actionTools } : {}),
      audit: () => undefined,
      sleep: async () => undefined,
    };
    return { deps, settled, toolCalls, stored: () => readConsultationResult(deps, current) };
  }

  const actionAnswer = answer(
    {
      kind: "follow_up",
      title: "Retorno",
      detail: "Retorno na terça.",
      evidence: [0],
      payload: { startsAt: "2026-12-08T14:00", whenText: "terça que vem às 14h" },
    },
    {
      kind: "prescription",
      title: "Dipirona",
      detail: "",
      evidence: [0],
      payload: { items: [{ drug: "dipirona", dose: "500 mg", posology: "de 8 em 8 horas" }] },
    },
  );
  const fake: ConsultationJobDeps["complete"] = async (_r, call) => {
    if (call.operation === "consultation-actions") return actionAnswer;
    if (call.tier === "fast") return '["p"]';
    return JSON.stringify({ title: "Consulta", notes: "Dor.", plan: "Retorno" });
  };

  it("seals the proposals with the transcript and note, and checks the follow-up with the agenda", async () => {
    const r = run({
      complete: fake,
      actionTools: async () => ({ availability: "mcp_appointments_availability" }),
    });
    await processConsultation(r.deps, "cons-1");
    expect(r.settled).toEqual([expect.objectContaining({ state: "drafted" })]);
    const stored = await r.stored();
    expect(stored?.actions?.map((a) => [a.kind, a.status])).toEqual([
      ["follow_up", "proposed"],
      ["prescription", "proposed"],
    ]);
    expect(stored?.actions?.[0]).toMatchObject({
      payload: { startsAt: "2026-12-08T14:00:00-03:00" },
      check: { available: false, suggestion: "2026-12-08T15:00:00-03:00" },
    });
    expect(stored?.actions?.[1]?.check).toBeUndefined();
    // Nothing was executed: only the agenda was read, and the draft note filed.
    expect(r.toolCalls).not.toContain("mcp_appointments_create");
  });

  it("omits the check when the connector has no availability tool", async () => {
    const r = run({ complete: fake, actionTools: async () => ({}) });
    await processConsultation(r.deps, "cons-1");
    expect((await r.stored())?.actions?.[0]?.check).toBeUndefined();
  });

  it("uses the cheap tier for the extraction", async () => {
    const complete = vi.fn(fake);
    await processConsultation(run({ complete }).deps, "cons-1");
    const call = complete.mock.calls.find(([, c]) => c.operation === "consultation-actions")?.[1];
    expect(call?.tier).toBe("fast");
  });

  it("still delivers the note when the extraction fails or answers garbage", async () => {
    const broken = run({
      complete: async (_r, call) => {
        if (call.operation === "consultation-actions") throw new Error("model down");
        return fake(_r, call);
      },
    });
    await processConsultation(broken.deps, "cons-1");
    expect(broken.settled).toEqual([expect.objectContaining({ state: "drafted" })]);
    expect((await broken.stored())?.actions).toEqual([]);
    expect((await broken.stored())?.note).toBeDefined();
  });
});
