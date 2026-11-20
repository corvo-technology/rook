import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MessageHoverMetadata } from "./MessageHoverMetadata";

describe("MessageHoverMetadata", () => {
  it("floats the actions over the row's top corner, hidden until pointed at or focused", () => {
    const html = renderToStaticMarkup(
      <MessageHoverMetadata>
        <div data-testid="message-actions" />
      </MessageHoverMetadata>,
    );

    expect(html).toContain('data-testid="message-hover-rail"');
    expect(html).toContain("[@media(hover:hover)_and_(pointer:fine)]:absolute");
    expect(html).toContain("[@media(hover:hover)_and_(pointer:fine)]:-top-3");
    expect(html).toContain("[@media(hover:hover)_and_(pointer:fine)]:opacity-0");
    expect(html).toContain("group-hover/message:opacity-100");
    expect(html).toContain("focus-within:opacity-100");
  });

  it("keeps the rail hidden on touch until the message is tapped", () => {
    const html = renderToStaticMarkup(
      <MessageHoverMetadata>
        <div data-testid="message-actions" />
      </MessageHoverMetadata>,
    );

    expect(html).toContain("[@media(hover:none)]:hidden");
    expect(html).toContain("[@media(hover:none)]:group-data-[actions=open]/message:flex");
  });

  it("drops the rail in-flow below the message on touch", () => {
    const html = renderToStaticMarkup(
      <MessageHoverMetadata>
        <div data-testid="message-actions" />
      </MessageHoverMetadata>,
    );

    expect(html).toContain("[@media(hover:none)]:w-full");
    expect(html).toContain("[@media(hover:none)]:justify-start");
    expect(html).not.toContain("[@media(hover:none)]:absolute");
  });

  it("pins the rail open while a nested menu is active", () => {
    const html = renderToStaticMarkup(
      <MessageHoverMetadata pinned>
        <div data-testid="message-actions" />
      </MessageHoverMetadata>,
    );

    expect(html).toContain("pointer-events-auto opacity-100");
    expect(html).not.toContain("group-hover/message:opacity-100");
  });
});
