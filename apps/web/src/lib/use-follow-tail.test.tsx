// @vitest-environment jsdom
import { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useFollowTail } from "./use-follow-tail";

function List({ tail, own }: { tail: string; own: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const { atEnd, scrollProps } = useFollowTail(ref, tail, own);
  return (
    <div ref={ref} data-at-end={atEnd} data-testid="list" {...scrollProps}>
      {tail}
    </div>
  );
}

async function setup() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const scrollTo = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { value: scrollTo, configurable: true });
  const render = (tail: string, own = false) =>
    act(async () => root.render(<List tail={tail} own={own} />));
  await render("a");
  const list = host.firstElementChild as HTMLDivElement;
  scrollTo.mockClear();
  const geometry = (top: number) => {
    Object.defineProperty(list, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(list, "clientHeight", { value: 400, configurable: true });
    Object.defineProperty(list, "scrollTop", { value: top, configurable: true, writable: true });
  };
  return { list, scrollTo, geometry, render };
}

it("follows new messages while the reader is at the end", async () => {
  const { scrollTo, geometry, render } = await setup();
  geometry(600);
  await render("b");
  expect(scrollTo).toHaveBeenCalledTimes(1);
});

it("does not jump when the reader scrolled up, and shows the way back", async () => {
  const { list, scrollTo, geometry, render } = await setup();
  geometry(100);
  await act(async () => {
    list.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  expect(list.dataset.atEnd).toBe("false");
  await render("b");
  expect(scrollTo).not.toHaveBeenCalled();
});

it("brings the reader back to the end after they send a message", async () => {
  const { list, scrollTo, geometry, render } = await setup();
  geometry(100);
  await act(async () => {
    list.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await render("b", true);
  expect(scrollTo).toHaveBeenCalledTimes(1);
});
