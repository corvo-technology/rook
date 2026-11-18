import { describe, expect, it } from "vitest";
import {
  buildScribePrompt,
  draftContent,
  mergeTurns,
  parseLabels,
  parseNote,
  scribeInstructions,
  transcriptUnits,
} from "./consultation-scribe.js";

describe("transcriptUnits", () => {
  it("splits sentences, joins very short ones and dates each by its share of the segment", () => {
    const text =
      "Bom dia, doutora. Sim. Estou com dor de cabeça desde segunda-feira. Tomei dipirona.";
    const units = transcriptUnits({ text, startMs: 60_000, durationMs: 40_000 });
    expect(units.map((u) => u.text).join(" ")).toBe(text);
    expect(units.length).toBeGreaterThan(1);
    expect(units[0]?.startMs).toBe(60_000);
    for (let i = 1; i < units.length; i++) {
      expect(units[i]?.startMs).toBeGreaterThan(units[i - 1]?.startMs ?? 0);
      expect(units[i]?.startMs).toBeLessThan(100_000);
    }
  });

  it("returns nothing for silence", () => {
    expect(transcriptUnits({ text: "  ", startMs: 0, durationMs: 1000 })).toEqual([]);
  });
});

describe("parseLabels and mergeTurns", () => {
  it("maps letters to speakers, pads and unknown-fills what it cannot read", () => {
    expect(parseLabels('Claro: ["p","C","x"]', 5)).toEqual([
      "professional",
      "patient",
      "unknown",
      "unknown",
      "unknown",
    ]);
    expect(parseLabels("sem json", 2)).toEqual(["unknown", "unknown"]);
    expect(parseLabels("[1,2", 1)).toEqual(["unknown"]);
    expect(parseLabels(undefined, 1)).toEqual(["unknown"]);
  });

  it("merges neighbouring lines of the same speaker into one turn", () => {
    const turns = mergeTurns(
      [
        { startMs: 0, text: "Olá." },
        { startMs: 1000, text: "Tudo bem?" },
        { startMs: 2000, text: "Tudo." },
      ],
      ["professional", "professional", "patient"],
    );
    expect(turns).toEqual([
      { speaker: "professional", startMs: 0, text: "Olá. Tudo bem?" },
      { speaker: "patient", startMs: 2000, text: "Tudo." },
    ]);
  });
});

describe("parseNote", () => {
  it("reads the template's fields from an answer wrapped in prose or a code fence", () => {
    const answer =
      'Aqui está:\n```json\n{"title":"Consulta","notes":"Paciente com cefaleia.","prescriptions":["Dipirona 500 mg"],"extra":"x"}\n```';
    expect(parseNote("prontu_evolution", answer)).toEqual({
      title: "Consulta",
      notes: "Paciente com cefaleia.",
      chiefComplaint: "",
      history: "",
      exam: "",
      assessment: "",
      plan: "",
      prescriptions: ["Dipirona 500 mg"],
      followUp: "",
    });
  });

  it("refuses an answer with no JSON, malformed JSON or an empty note", () => {
    expect(parseNote("prontu_evolution", "não sei")).toBeNull();
    expect(parseNote("prontu_evolution", "{ quebrado")).toBeNull();
    expect(parseNote("salon_service_record", '{"title":"","notes":""}')).toBeNull();
    expect(parseNote("salon_service_record", undefined)).toBeNull();
  });

  it("types the salon template's fields as text", () => {
    const note = parseNote(
      "salon_service_record",
      '{"servicesDone":"Corte","nextVisit":"em 30 dias"}',
    );
    expect(note).toMatchObject({
      servicesDone: "Corte",
      nextVisit: "em 30 dias",
      productsUsed: "",
    });
  });
});

describe("prompts and draft content", () => {
  it("versions both prompts, treats the transcript as untrusted and never asks to sign", () => {
    const instructions = scribeInstructions("prontu_evolution");
    expect(instructions).toContain("escriba/2026-12-v1");
    expect(instructions).toMatch(/untrusted/i);
    expect(instructions).toMatch(/never sign/i);
  });

  it("puts speaker names into the transcript prompt", () => {
    const prompt = buildScribePrompt([{ speaker: "patient", startMs: 0, text: "Dói aqui." }], {
      professionalName: "Dr. Lima",
    });
    expect(prompt).toContain("Profissional: Dr. Lima");
    expect(prompt).toContain("Paciente: Dói aqui.");
  });

  it("puts the whole note into notes as readable sections", () => {
    const content = draftContent({
      template: "prontu_evolution",
      note: { title: "T", notes: "Resumo.", chiefComplaint: "Dor", prescriptions: ["A", "B"] },
      appointmentId: "a1",
    });
    expect(content).toEqual({
      schemaVersion: 1,
      title: "T",
      notes: "Resumo.\n\nQueixa principal:\nDor\n\nPrescrições:\n- A\n- B",
      chiefComplaint: "Dor",
      prescriptions: ["A", "B"],
      appointmentId: "a1",
    });
  });
});
