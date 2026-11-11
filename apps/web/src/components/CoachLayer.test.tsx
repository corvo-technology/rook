// @vitest-environment jsdom
import type { TourState } from "@corvo/contracts";
import type { TourFacts } from "@corvo/core";
import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.hoisted(() => ({
  onboarding: { tourDone: vi.fn(), tourSkip: vi.fn() },
}));
vi.mock("../lib/rpc", () => ({ rpc: rpcMock }));
vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
  useLingui: () => ({
    t: (strings: TemplateStringsArray, ...values: unknown[]) => String.raw(strings, ...values),
  }),
}));

import { CoachLayer, findCoachAnchor } from "./CoachLayer";

const none: TourFacts = {
  draftWaiting: false,
  personSent: false,
  replied: false,
  askWaiting: false,
  hasChief: false,
  inChiefChat: false,
  missionsListed: false,
};
const fresh: TourState = { done: [], skipped: false };
const FIRST = "This isn't sent yet. Edit it or send it.";
const ASK = "When an agent needs you, it asks here and waits.";
const MISSIONS = "Each one checks itself off when you do it.";

let host: HTMLDivElement;
let root: Root;
let onTourChange: Mock<(next: TourState) => void>;
const anchors: HTMLElement[] = [];

function addAnchor(mark: string, visible = true, tag = "div") {
  const element = document.createElement(tag);
  element.dataset.coach = mark;
  element.getClientRects = () => (visible ? ([{}] as unknown as DOMRectList) : ([] as never));
  document.body.append(element);
  anchors.push(element);
  return element;
}

async function render(tour: TourState | null | undefined, over: Partial<TourFacts> = {}) {
  await act(async () => {
    root.render(
      <CoachLayer tour={tour} facts={{ ...none, ...over }} onTourChange={onTourChange} />,
    );
  });
}

const button = (name: string) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent === name) as HTMLElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  rpcMock.onboarding.tourDone.mockReset().mockResolvedValue({ ok: true });
  rpcMock.onboarding.tourSkip.mockReset().mockResolvedValue({ ok: true });
  onTourChange = vi.fn();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  for (const element of anchors.splice(0)) element.remove();
  vi.unstubAllGlobals();
});

describe("CoachLayer", () => {
  it("renders nothing without a tour", async () => {
    addAnchor("first");
    await render(null, { draftWaiting: true });
    expect(document.body.textContent).not.toContain(FIRST);
  });

  it("shows the due mark with both buttons", async () => {
    addAnchor("first");
    await render(fresh, { draftWaiting: true });
    expect(document.body.textContent).toContain(FIRST);
    expect(button("Got it")).toBeTruthy();
    expect(button("Skip tour")).toBeTruthy();
  });

  it("waits for a visible anchor without recording anything", async () => {
    addAnchor("first", false);
    await render(fresh, { draftWaiting: true });
    expect(document.body.textContent).not.toContain(FIRST);
    expect(rpcMock.onboarding.tourDone).not.toHaveBeenCalled();
    expect(findCoachAnchor("first")).toBeNull();
  });

  it("ends one mark with Got it", async () => {
    addAnchor("first");
    await render(fresh, { draftWaiting: true });
    await act(async () => button("Got it").click());
    expect(rpcMock.onboarding.tourDone).toHaveBeenCalledTimes(1);
    expect(rpcMock.onboarding.tourDone).toHaveBeenCalledWith({ mark: "first" });
    expect(onTourChange).toHaveBeenCalledWith({ done: ["first"], skipped: false });
    expect(document.body.textContent).not.toContain(FIRST);
  });

  it("shows the missions mark after the Chief one and records it when the list is clicked", async () => {
    const anchor = addAnchor("missions");
    await render({ done: ["chief"], skipped: false }, { missionsListed: true, replied: true });
    expect(document.body.textContent).toContain(MISSIONS);
    await act(async () => {
      anchor.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(rpcMock.onboarding.tourDone).toHaveBeenCalledTimes(1);
    expect(rpcMock.onboarding.tourDone).toHaveBeenCalledWith({ mark: "missions" });
  });

  it("ends the whole tour with Skip tour", async () => {
    addAnchor("first");
    await render(fresh, { draftWaiting: true });
    await act(async () => button("Skip tour").click());
    expect(rpcMock.onboarding.tourSkip).toHaveBeenCalledTimes(1);
    expect(onTourChange).toHaveBeenCalledWith({ done: [], skipped: true });
    expect(document.body.textContent).not.toContain(FIRST);
  });

  it("records first when the person sends before it ever showed", async () => {
    await render(fresh, { draftWaiting: true, personSent: true });
    expect(rpcMock.onboarding.tourDone).toHaveBeenCalledWith({ mark: "first" });
  });

  it("records ask only after it showed and no ask is left", async () => {
    addAnchor("ask");
    await render(fresh, { askWaiting: true });
    expect(document.body.textContent).toContain(ASK);
    await render(fresh, { askWaiting: false });
    expect(rpcMock.onboarding.tourDone).toHaveBeenCalledTimes(1);
    expect(rpcMock.onboarding.tourDone).toHaveBeenCalledWith({ mark: "ask" });
  });

  it("does not record an ask that never showed", async () => {
    await render(fresh, { askWaiting: false });
    expect(rpcMock.onboarding.tourDone).not.toHaveBeenCalled();
  });

  it("ignores Escape and outside clicks", async () => {
    addAnchor("first");
    await render(fresh, { draftWaiting: true });
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(document.body.textContent).toContain(FIRST);
    expect(rpcMock.onboarding.tourDone).not.toHaveBeenCalled();
    expect(onTourChange).not.toHaveBeenCalled();
  });

  it("leaves focus in the composer when the mark appears", async () => {
    const textarea = document.createElement("textarea");
    document.body.append(textarea);
    anchors.push(textarea);
    textarea.focus();
    addAnchor("first");
    await render(fresh, { draftWaiting: true });
    expect(document.body.textContent).toContain(FIRST);
    expect(document.activeElement).toBe(textarea);
  });

  it("swallows a failed call and keeps the mark hidden", async () => {
    rpcMock.onboarding.tourDone.mockRejectedValue(new Error("offline"));
    addAnchor("first");
    await render(fresh, { draftWaiting: true });
    await act(async () => button("Got it").click());
    expect(document.body.textContent).not.toContain(FIRST);
  });

  it("never shows a mark when there is no draft waiting", async () => {
    addAnchor("first");
    await render(fresh, { draftWaiting: false });
    expect(document.body.textContent).not.toContain(FIRST);
  });
});
