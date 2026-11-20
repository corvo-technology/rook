// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PersonAvatar, personInitials } from "./PersonAvatar";

describe("PersonAvatar", () => {
  it("is a block of its own size, so a tall message row cannot stretch it", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(<PersonAvatar name="Ana Souza" size={32} />);
    const root = host.firstElementChild as HTMLElement;
    expect(root.className.split(" ")).toContain("block");
    expect(root.style.width).toBe("32px");
    expect(root.style.height).toBe("32px");
  });

  it("shows two initials", () => {
    expect(personInitials("Ana Souza")).toBe("AS");
  });
});
