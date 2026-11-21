// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SpaceAvatar } from "./SpaceAvatar";

function render(props: Parameters<typeof SpaceAvatar>[0]) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<SpaceAvatar {...props} />);
  return host.firstElementChild as HTMLElement;
}

describe("SpaceAvatar", () => {
  it("is the initial on ink until a color is chosen", () => {
    const mark = render({ name: "  greenflow", logo: null });
    expect(mark.textContent).toBe("G");
    expect(mark.className).toContain("bg-primary");
    expect(mark.style.backgroundColor).toBe("");
  });

  it("wears the chosen color in readable ink", () => {
    const mark = render({ name: "Greenflow", logo: "#B45309" });
    expect(mark.style.backgroundColor).toBe("rgb(180, 83, 9)");
    expect(mark.style.color).toBe("rgb(255, 255, 255)");
    expect(mark.textContent).toBe("G");
  });

  it("shows a stored picture instead of the initial", () => {
    const picture = "data:image/webp;base64,UklGRg==";
    const mark = render({ name: "Greenflow", logo: picture });
    expect(mark.querySelector("img")?.getAttribute("src")).toBe(picture);
    expect(mark.textContent).toBe("");
  });

  it("is a rounded square, not a circle", () => {
    const mark = render({ name: "Greenflow", size: 40 });
    expect(mark.style.borderRadius).toBe("12px");
    expect(mark.className).not.toContain("rounded-full");
  });
});
