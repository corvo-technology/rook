import { describe, expect, it } from "vitest";
import { VtScreen } from "./vt-screen.js";

describe("VtScreen", () => {
  it("renders cursor moves and line erase", () => {
    const screen = new VtScreen(20, 5);
    screen.write("first\r\nsecond\r\n");
    screen.write("\u001b[2Athird"); // up two lines, overwrite the first line
    screen.write("\u001b[1B\u001b[1G\u001b[2K"); // down, column one, erase that line
    screen.write("\u001b[3;1Hlast");
    expect(screen.lines()).toEqual(["third", "", "last"]);
  });

  it("erases the rest of a line and the display", () => {
    const screen = new VtScreen(20, 4);
    screen.write("abcdef\u001b[3D\u001b[K\r\nkeep");
    expect(screen.lines()).toEqual(["abc", "keep"]);
    screen.write("\u001b[2J");
    expect(screen.lines()).toEqual([]);
  });

  it("drops colours and hyperlinks but keeps the text", () => {
    const screen = new VtScreen(40, 3);
    screen.write("\u001b[1;31mred\u001b[0m \u001b]8;;https://x.test\u0007link\u001b]8;;\u0007 ok");
    screen.write("\u001b(B\u001b[?25l");
    expect(screen.lines()).toEqual(["red link ok"]);
  });

  it("wraps at the column limit", () => {
    const screen = new VtScreen(5, 3);
    screen.write("abcdefgh");
    expect(screen.lines()).toEqual(["abcde", "fgh"]);
  });

  it("scrolls when the screen is full and handles backspace and tab", () => {
    const screen = new VtScreen(10, 2);
    screen.write("one\r\ntwo\r\nthree");
    expect(screen.lines()).toEqual(["two", "three"]);
    screen.write("\b\bXY\tZ");
    expect(screen.lines()).toEqual(["two", "thrXY   Z"]);
  });
});
