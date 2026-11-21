// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import source from "../../public/sdk.js?raw";

const ORIGIN = "https://app.corvo.test";

type Panel = HTMLElement & {
  setContext(context: unknown): void;
  setConsultation(options: unknown): void;
  resolveConsultation(link: unknown): void;
  open(): void;
};

class FakeRecorder {
  static instances: FakeRecorder[] = [];
  static isTypeSupported = () => true;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeRecorder.instances.push(this);
  }
  start() {}
  pause() {}
  resume() {}
  stop() {
    this.ondataavailable?.({ data: new Blob([new Uint8Array([1])], { type: "audio/webm" }) });
    this.onstop?.();
  }
}

interface Call {
  method: string;
  path: string;
  body: unknown;
}
let calls: Call[];
let getUserMedia: ReturnType<typeof vi.fn>;

const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

function mount(attributes: Record<string, string> = { consultations: "" }): Panel {
  const element = document.createElement("corvo-assistant") as Panel;
  element.setAttribute("mode", "launcher");
  element.setAttribute("session-url", "/corvo/session");
  element.setAttribute("origin", ORIGIN);
  element.setAttribute("locale", "en");
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  document.body.append(element);
  return element;
}
const bar = (element: Element) => element.shadowRoot?.querySelector(".rec") as HTMLElement;
const buttons = (element: Element) =>
  [...bar(element).querySelectorAll("button")] as HTMLButtonElement[];
const press = (element: Element, label: string) => {
  const found = buttons(element).find((button) => button.textContent === label);
  if (!found) throw new Error(`no "${label}" in "${bar(element).textContent}"`);
  found.click();
};
const frameSrc = (element: Element) =>
  ((element.shadowRoot as ShadowRoot).querySelector("iframe") as HTMLIFrameElement).src;
const patient = { entities: [{ type: "patient", id: "p-1", label: "Maria Souza" }] };

beforeEach(() => {
  calls = [];
  FakeRecorder.instances = [];
  getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] }));
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  vi.stubGlobal("navigator", { ...navigator, mediaDevices: { getUserMedia } });
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = url.startsWith(ORIGIN) ? url.slice(ORIGIN.length) : url;
      const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ method: init.method ?? "GET", path, body });
      if (path === "/corvo/session") return Response.json({ code: "code" });
      if (path === "/api/partner/embed/exchange") return Response.json({ token: "token" });
      if (path === "/api/partner/embed/consultations") {
        return Response.json({ consultationId: "cons-1" });
      }
      if (path.endsWith("/finish")) return Response.json({ state: "processing" });
      if (init.method === "PUT" || init.method === "DELETE") return Response.json({ ok: true });
      return Response.json({
        state: "drafted",
        transcript: [{ speaker: "professional", startMs: 0, text: "Bom dia." }],
        note: { chiefComplaint: "Dor" },
      });
    }),
  );
  // biome-ignore lint/security/noGlobalEval: loads the built widget script the way a page would
  if (!customElements.get("corvo-assistant")) (0, eval)(source);
});
afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("the recording bar in the launcher's panel", () => {
  it("is absent unless the page turns consultations on and names a patient", () => {
    const off = mount({});
    off.setContext(patient);
    expect(bar(off).hidden).toBe(true);
    off.remove();
    const noPatient = mount();
    noPatient.setContext({ page: "/agenda" });
    expect(bar(noPatient).hidden).toBe(true);
  });

  it("offers Record consultation for the patient the page is on", () => {
    const element = mount();
    element.setContext(patient);
    expect(bar(element).hidden).toBe(false);
    expect(buttons(element).map((button) => button.textContent)).toEqual(["Record consultation"]);
    expect(bar(element).textContent).toContain("Maria Souza");
  });

  it("asks for the patient's consent first, and records nothing until it is given", async () => {
    const element = mount();
    element.setContext(patient);
    press(element, "Record consultation");
    expect(bar(element).textContent).toContain("Did the patient agree to be recorded?");
    expect(buttons(element).map((button) => button.textContent)).toEqual([
      "Yes, verbally",
      "Yes, in writing",
      "Cancel",
    ]);
    await settle();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(calls.some((call) => call.path.includes("/consultations"))).toBe(false);

    press(element, "Cancel");
    expect(buttons(element).map((button) => button.textContent)).toEqual(["Record consultation"]);
    await settle();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("records with the consent method and the patient, appointment and professional it was given", async () => {
    const element = mount();
    element.setContext({
      entities: [...patient.entities, { type: "appointment", id: "a-9", label: "10:00" }],
    });
    element.setConsultation({ professionalName: "Dra. Ana", preset: "evolution" });
    press(element, "Record consultation");
    press(element, "Yes, in writing");
    await settle();

    const created = calls.find((call) => call.path === "/api/partner/embed/consultations");
    expect(created?.body).toMatchObject({
      context: {
        clientId: "p-1",
        appointmentId: "a-9",
        clientName: "Maria Souza",
        professionalName: "Dra. Ana",
        output: { preset: "evolution" },
      },
      consent: { obtained: true, method: "written" },
    });
    expect(bar(element).dataset.phase).toBe("recording");
    expect(bar(element).textContent).toMatch(/00:0\d/);
    expect(buttons(element).map((button) => button.textContent)).toEqual(["Pause", "Stop"]);
    press(element, "Pause");
    expect(bar(element).dataset.phase).toBe("paused");
    press(element, "Resume");
    expect(bar(element).dataset.phase).toBe("recording");
  });

  it("generates the draft, tells the page, and links to where the page saved it", async () => {
    const element = mount();
    const drafted = vi.fn();
    const navigate = vi.fn();
    element.addEventListener("corvo-consultation", (event) => {
      drafted((event as CustomEvent).detail);
      // The page usually answers inside the event, before the panel has settled on "done".
      element.resolveConsultation({ path: "/records/7/draft" });
    });
    element.addEventListener("corvo-navigate", (event) => navigate((event as CustomEvent).detail));
    element.setContext(patient);
    press(element, "Record consultation");
    press(element, "Yes, verbally");
    await settle();
    press(element, "Stop");
    await settle();

    expect(drafted).toHaveBeenCalledWith(
      expect.objectContaining({
        consultationId: "cons-1",
        clientId: "p-1",
        note: { chiefComplaint: "Dor" },
      }),
    );
    expect(bar(element).textContent).toContain("Draft ready");
    press(element, "Open draft");
    expect(navigate).toHaveBeenCalledWith({ path: "/records/7/draft" });
  });

  it("says Generating draft while the draft is made, in the page's language", async () => {
    const element = mount({ consultations: "", locale: "pt-BR" });
    element.setContext(patient);
    press(element, "Gravar consulta");
    expect(bar(element).textContent).toContain("O paciente autorizou a gravação?");
    press(element, "Sim, verbalmente");
    await settle();
    expect(bar(element).dataset.phase).toBe("recording");
    press(element, "Parar");
    expect(bar(element).textContent).toContain("Gerando rascunho…");
  });

  it("asks for the microphone only after consent, and says when it is blocked", async () => {
    getUserMedia.mockRejectedValueOnce(new Error("NotAllowedError"));
    const element = mount();
    element.setContext(patient);
    press(element, "Record consultation");
    press(element, "Yes, verbally");
    await settle();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(bar(element).textContent).toContain("Allow the microphone to record.");
    expect(calls.some((call) => call.path === "/api/partner/embed/consultations")).toBe(false);
    expect(buttons(element).map((button) => button.textContent)).toEqual(["Try again"]);
  });
});

describe("the assistant's name, icon and the person's name", () => {
  it("reach the frame in its launch fragment and never include Rook's own", async () => {
    const element = mount({
      mode: "launcher",
      name: "Assistente",
      icon: "https://cdn.example.test/i.png",
      "user-name": "Maria Silva",
    });
    element.open();
    await settle();
    const params = new URLSearchParams(new URL(frameSrc(element)).hash.slice(1));
    expect(params.get("assistant")).toBe("Assistente");
    expect(params.get("icon")).toBe("https://cdn.example.test/i.png");
    expect(params.get("user")).toBe("Maria Silva");
  });

  it("drop an icon that is not https", async () => {
    const element = mount({ icon: "javascript:alert(1)" });
    element.open();
    await settle();
    expect(new URLSearchParams(new URL(frameSrc(element)).hash.slice(1)).has("icon")).toBe(false);
  });
});
