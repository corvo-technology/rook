const TAB_WIDTH = 8;

type Mode = "text" | "escape" | "csi" | "osc" | "osc-escape" | "charset";

/**
 * A small terminal screen: enough to show a CLI's sign-in prompt as plain text lines. It
 * handles CR, LF, BS and TAB, cursor moves, erase in line and in display, and drops colour,
 * hyperlink and every other sequence it does not know.
 */
export class VtScreen {
  readonly #cols: number;
  readonly #rows: number;
  #grid: string[][];
  #row = 0;
  #col = 0;
  #mode: Mode = "text";
  #params = "";

  constructor(cols: number, rows: number) {
    this.#cols = Math.max(1, cols);
    this.#rows = Math.max(1, rows);
    this.#grid = Array.from({ length: this.#rows }, () => this.#blank());
  }

  write(text: string): void {
    for (const char of text) this.#feed(char);
  }

  /** The screen as text, with trailing spaces and trailing empty lines removed. */
  lines(): string[] {
    const lines = this.#grid.map((row) => row.join("").trimEnd());
    while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    return lines;
  }

  #blank(): string[] {
    return Array.from({ length: this.#cols }, () => " ");
  }

  #feed(char: string): void {
    switch (this.#mode) {
      case "escape":
        this.#escape(char);
        return;
      case "csi":
        this.#csi(char);
        return;
      case "osc":
        // OSC ends at BEL or at ESC followed by a backslash; its content is dropped.
        if (char === "\u0007") this.#mode = "text";
        else if (char === "\u001b") this.#mode = "osc-escape";
        return;
      case "osc-escape":
        this.#mode = char === "\\" ? "text" : "osc";
        return;
      case "charset":
        this.#mode = "text";
        return;
      default:
        this.#text(char);
    }
  }

  #escape(char: string): void {
    if (char === "[") {
      this.#mode = "csi";
      this.#params = "";
    } else if (char === "]") this.#mode = "osc";
    else if (char === "(" || char === ")" || char === "#") this.#mode = "charset";
    else this.#mode = "text";
  }

  #csi(char: string): void {
    // Parameter and intermediate bytes accumulate; a final byte (0x40 to 0x7e) runs the command.
    if (char >= "@" && char <= "~") {
      this.#mode = "text";
      this.#run(char, this.#params);
    } else if (this.#params.length < 64) this.#params += char;
  }

  #run(final: string, raw: string): void {
    const numbers = raw
      .replace(/^[?<=>]/, "")
      .split(";")
      .map((part) => (part === "" ? Number.NaN : Number(part)));
    const first = Number.isFinite(numbers[0]) ? (numbers[0] as number) : undefined;
    const count = Math.max(1, first ?? 1);
    switch (final) {
      case "A":
        this.#row = Math.max(0, this.#row - count);
        return;
      case "B":
        this.#row = Math.min(this.#rows - 1, this.#row + count);
        return;
      case "C":
        this.#col = Math.min(this.#cols - 1, this.#col + count);
        return;
      case "D":
        this.#col = Math.max(0, this.#col - count);
        return;
      case "G":
        this.#col = Math.min(this.#cols - 1, Math.max(0, count - 1));
        return;
      case "H":
      case "f": {
        const second = Number.isFinite(numbers[1]) ? (numbers[1] as number) : 1;
        this.#row = Math.min(this.#rows - 1, Math.max(0, count - 1));
        this.#col = Math.min(this.#cols - 1, Math.max(0, Math.max(1, second) - 1));
        return;
      }
      case "J":
        this.#eraseDisplay(first ?? 0);
        return;
      case "K":
        this.#eraseLine(first ?? 0);
        return;
      default:
    }
  }

  #eraseLine(mode: number): void {
    const row = this.#grid[this.#row] as string[];
    const from = mode === 0 ? this.#col : 0;
    const to = mode === 1 ? this.#col : this.#cols - 1;
    for (let i = from; i <= to; i++) row[i] = " ";
  }

  #eraseDisplay(mode: number): void {
    if (mode === 0) {
      this.#eraseLine(0);
      for (let r = this.#row + 1; r < this.#rows; r++) this.#grid[r] = this.#blank();
    } else if (mode === 1) {
      this.#eraseLine(1);
      for (let r = 0; r < this.#row; r++) this.#grid[r] = this.#blank();
    } else {
      this.#grid = Array.from({ length: this.#rows }, () => this.#blank());
    }
  }

  #lineFeed(): void {
    if (this.#row < this.#rows - 1) {
      this.#row++;
      return;
    }
    this.#grid.shift();
    this.#grid.push(this.#blank());
  }

  #text(char: string): void {
    switch (char) {
      case "\u001b":
        this.#mode = "escape";
        return;
      case "\r":
        this.#col = 0;
        return;
      case "\n":
        this.#lineFeed();
        return;
      case "\b":
        this.#col = Math.max(0, this.#col - 1);
        return;
      case "\t":
        this.#col = Math.min(this.#cols - 1, (Math.floor(this.#col / TAB_WIDTH) + 1) * TAB_WIDTH);
        return;
      default:
    }
    if (char < " " || char === "\u007f") return;
    if (this.#col >= this.#cols) {
      this.#col = 0;
      this.#lineFeed();
    }
    (this.#grid[this.#row] as string[])[this.#col] = char;
    this.#col++;
  }
}
