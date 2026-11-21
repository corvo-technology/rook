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

  it("puts the initials on the chosen color, in readable ink", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(<PersonAvatar name="Ana Souza" image="#15803D" />);
    const disc = host.querySelector("span > span") as HTMLElement;
    expect(disc.style.backgroundColor).toBe("rgb(21, 128, 61)");
    expect(disc.style.color).toBe("rgb(255, 255, 255)");
    expect(disc.textContent).toBe("AS");
    expect(host.querySelector("img")).toBeNull();
  });

  it("shows a stored picture, and never reads a color as an address", () => {
    const picture = "data:image/webp;base64,UklGRg==";
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(<PersonAvatar name="Ana Souza" image={picture} />);
    expect(host.querySelector("img")?.getAttribute("src")).toBe(picture);
    host.innerHTML = renderToStaticMarkup(<PersonAvatar name="Ana Souza" image="#15803D" />);
    expect(host.querySelector("img")).toBeNull();
  });

  it("wears the quiet default without a choice", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(<PersonAvatar name="Ana Souza" image={null} />);
    const disc = host.querySelector("span > span") as HTMLElement;
    expect(disc.style.backgroundColor).toBe("");
    expect(disc.className).toContain("bg-muted");
  });
});
