import { Unzip, UnzipInflate } from "fflate";
import { SaxesParser, type SaxesTagPlain } from "saxes";
import { DocumentTextError } from "./document-text.js";

/**
 * Text from Word, spreadsheet and OpenDocument files, read inside this process: no Office, no
 * macros, no computer and no model. These are untrusted zip files of XML, so everything that can
 * grow is bounded before it is read (entries, uncompressed bytes, sheets, rows, columns, time), and
 * nothing in them is run or followed: formulas are not evaluated, links are not opened, external
 * entities are never resolved.
 */

export type OfficeKind = "docx" | "xlsx" | "odt" | "ods";

/** A piece of a file with a name a quote can cite: "section 2" of a document, "Sheet1, rows 2-40". */
export type OfficeSection = { label: string; text: string };

export type OfficeText = {
  sections: OfficeSection[];
  /** What was left out because of a limit, in words the person can read. */
  notes: string[];
};

export const OFFICE_LIMITS = {
  /** Entries in the zip; a real file has dozens. */
  entries: 2_000,
  /** Uncompressed bytes of any one XML part. */
  entryBytes: 24 * 1024 * 1024,
  /** Uncompressed bytes of all the XML parts read together. */
  totalBytes: 48 * 1024 * 1024,
  sheets: 20,
  rowsPerSheet: 20_000,
  columns: 50,
  cellsPerFile: 400_000,
  /** Characters of one cell kept. */
  cellChars: 500,
  timeoutMs: 30_000,
} as const;

/** A table or section is cut into pieces of about this many characters, each citing its own place. */
const SECTION_CHARS = 5_000;

const unreadable = (kind: OfficeKind) =>
  new DocumentTextError(
    `That file is not a readable ${
      { docx: "Word", xlsx: "Excel", odt: "OpenDocument text", ods: "OpenDocument spreadsheet" }[
        kind
      ]
    } file.`,
  );

type Limits = { signal: AbortSignal };

/** Reads the named XML parts of a zip, stopping the moment a limit is crossed. */
function unzipParts(
  bytes: Uint8Array,
  wanted: (name: string) => boolean,
  kind: OfficeKind,
  { signal }: Limits,
): Map<string, string> {
  const chunks = new Map<string, Uint8Array[]>();
  const sizes = new Map<string, number>();
  let entries = 0;
  let total = 0;
  const unzip = new Unzip((file) => {
    entries += 1;
    if (entries > OFFICE_LIMITS.entries)
      throw new DocumentTextError("This file has too many parts inside it to be read safely.");
    if (!wanted(file.name)) return;
    chunks.set(file.name, []);
    sizes.set(file.name, 0);
    file.ondata = (error, chunk) => {
      if (error) throw error;
      signal.throwIfAborted();
      const size = (sizes.get(file.name) ?? 0) + chunk.length;
      total += chunk.length;
      if (size > OFFICE_LIMITS.entryBytes || total > OFFICE_LIMITS.totalBytes)
        throw new DocumentTextError("This file is too large once opened to be read safely.");
      sizes.set(file.name, size);
      chunks.get(file.name)?.push(chunk);
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  try {
    unzip.push(bytes, true);
  } catch (error) {
    if (error instanceof DocumentTextError || signal.aborted) throw error;
    throw unreadable(kind);
  }
  const decoder = new TextDecoder("utf-8");
  const parts = new Map<string, string>();
  for (const [name, list] of chunks) {
    const whole = new Uint8Array(sizes.get(name) ?? 0);
    let at = 0;
    for (const chunk of list) {
      whole.set(chunk, at);
      at += chunk.length;
    }
    parts.set(name, decoder.decode(whole));
  }
  return parts;
}

type Tag = SaxesTagPlain;

/**
 * Walks an XML part. A DOCTYPE is never processed, so an entity the file declares is an error and
 * nothing outside the file is fetched.
 */
function walk(
  xml: string,
  kind: OfficeKind,
  { signal }: Limits,
  handlers: {
    open?: (tag: Tag) => void;
    close?: (name: string) => void;
    text?: (text: string) => void;
  },
): void {
  const parser = new SaxesParser({ xmlns: false });
  parser.on("opentag", (tag) => handlers.open?.(tag as Tag));
  parser.on("closetag", (tag) => handlers.close?.((tag as Tag).name));
  parser.on("text", (text) => handlers.text?.(text));
  parser.on("cdata", (text) => handlers.text?.(text));
  parser.on("error", (error) => {
    throw error;
  });
  try {
    for (let at = 0; at < xml.length; at += 65_536) {
      signal.throwIfAborted();
      parser.write(xml.slice(at, at + 65_536));
    }
    parser.close();
  } catch (error) {
    if (error instanceof DocumentTextError || signal.aborted) throw error;
    throw unreadable(kind);
  }
}

const clean = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, OFFICE_LIMITS.cellChars);

const escapeCell = (text: string) => clean(text).replace(/\|/g, "\\|");

/** Rows as a Markdown table whose first row is the header. */
function markdownTable(rows: readonly (readonly string[])[], header: readonly string[]): string {
  const width = Math.max(header.length, ...rows.map((row) => row.length), 1);
  const line = (cells: readonly string[]) =>
    `| ${Array.from({ length: width }, (_, index) => escapeCell(cells[index] ?? "")).join(" | ")} |`;
  return [
    line(header),
    `| ${Array.from({ length: width }, () => "---").join(" | ")} |`,
    ...rows.map(line),
  ].join("\n");
}

type SheetRow = { number: number; cells: string[] };

/**
 * One sheet or table as sections of Markdown tables: the header row (the first row with anything in
 * it) is kept at the top of every piece, and each piece cites the rows it holds.
 */
function sheetSections(name: string, rows: readonly SheetRow[]): OfficeSection[] {
  const filled = rows.filter((row) => row.cells.some((cell) => cell.trim()));
  if (!filled.length) return [];
  const [head, ...body] = filled as [SheetRow, ...SheetRow[]];
  const title = name.replace(/[\r\n"]+/g, " ").trim() || "Sheet";
  const sections: OfficeSection[] = [];
  let held: SheetRow[] = [];
  let length = 0;
  const flush = () => {
    if (!held.length) return;
    const first = held[0]!.number;
    const last = held.at(-1)!.number;
    sections.push({
      label: `${title}, rows ${first}-${last}`,
      text: `### ${title}\n${markdownTable(
        held.map((row) => row.cells),
        head.cells,
      )}`,
    });
    held = [];
    length = 0;
  };
  for (const row of body) {
    const size = row.cells.reduce((sum, cell) => sum + Math.min(cell.length, 80) + 3, 0);
    if (held.length && length + size > SECTION_CHARS) flush();
    held.push(row);
    length += size;
  }
  if (!held.length) {
    // A sheet with only a header row still says what it is.
    sections.push({
      label: `${title}, rows ${head.number}-${head.number}`,
      text: `### ${title}\n${markdownTable([], head.cells)}`,
    });
  } else flush();
  return sections;
}

/** Counts cells across a whole file and says when a limit cut the read short. */
class Budget {
  cells = 0;
  notes = new Set<string>();
  spend(count: number): boolean {
    this.cells += count;
    if (this.cells <= OFFICE_LIMITS.cellsPerFile) return true;
    this.notes.add(
      `Only the first ${OFFICE_LIMITS.cellsPerFile.toLocaleString("en")} cells were read.`,
    );
    return false;
  }
}

/** Collects the rows of one sheet, within the limits. */
class SheetBuilder {
  rows: SheetRow[] = [];
  constructor(
    readonly name: string,
    private readonly budget: Budget,
  ) {}
  add(number: number, cells: string[]): void {
    if (this.rows.length >= OFFICE_LIMITS.rowsPerSheet) {
      this.budget.notes.add(
        `Only the first ${OFFICE_LIMITS.rowsPerSheet.toLocaleString("en")} rows of "${this.name}" were read.`,
      );
      return;
    }
    if (cells.length > OFFICE_LIMITS.columns) {
      this.budget.notes.add(
        `Only the first ${OFFICE_LIMITS.columns} columns of "${this.name}" were read.`,
      );
      cells = cells.slice(0, OFFICE_LIMITS.columns);
    }
    while (cells.length && !cells.at(-1)?.trim()) cells.pop();
    if (!cells.length) return;
    if (!this.budget.spend(cells.length)) return;
    this.rows.push({ number, cells });
  }
}

/** Sheets as sections; any sheet past the limit is left out and said so. */
function sheetsToText(
  sheets: readonly { name: string; build: (budget: Budget) => SheetRow[] }[],
  budget: Budget,
): OfficeText {
  const sections: OfficeSection[] = [];
  for (const [index, sheet] of sheets.entries()) {
    if (index >= OFFICE_LIMITS.sheets) {
      budget.notes.add(`Only the first ${OFFICE_LIMITS.sheets} sheets were read.`);
      break;
    }
    sections.push(...sheetSections(sheet.name, sheet.build(budget)));
  }
  return { sections, notes: [...budget.notes] };
}

// ---------------------------------------------------------------------------------------------
// Word (.docx)

const wordHeadingLevel = (styleName: string): number => {
  if (/^title$/i.test(styleName)) return 1;
  const match = /^heading (\d)$/i.exec(styleName);
  return match ? Number(match[1]) : 0;
};

/** Cuts a document into sections at its headings (levels 1-2) and when a section grows long. */
class DocumentBuilder {
  sections: OfficeSection[] = [];
  private lines: string[] = [];
  private length = 0;
  push(line: string, startsSection = false): void {
    if (startsSection || (this.length > SECTION_CHARS && !line.startsWith("-"))) this.flush();
    this.lines.push(line);
    this.length += line.length + 2;
  }
  private flush(): void {
    const text = this.lines.join("\n\n").trim();
    if (text) this.sections.push({ label: `section ${this.sections.length + 1}`, text });
    this.lines = [];
    this.length = 0;
  }
  finish(): OfficeSection[] {
    this.flush();
    return this.sections;
  }
}

type DocTable = { rows: string[][]; row: string[] | null; cell: string[] | null };

const tableToMarkdown = (rows: string[][]): string => {
  const [head = [], ...body] = rows.filter((row) => row.some((cell) => cell.trim()));
  return markdownTable(body, head);
};

function docxText(files: Map<string, string>, limits: Limits): OfficeText {
  const body = files.get("word/document.xml");
  if (body === undefined) throw unreadable("docx");
  const styleNames = new Map<string, string>();
  const styles = files.get("word/styles.xml");
  if (styles) {
    let styleId = "";
    walk(styles, "docx", limits, {
      open: (tag) => {
        if (tag.name === "w:style") styleId = String(tag.attributes["w:styleId"] ?? "");
        else if (tag.name === "w:name" && styleId)
          styleNames.set(styleId, String(tag.attributes["w:val"] ?? ""));
      },
      close: (name) => {
        if (name === "w:style") styleId = "";
      },
    });
  }

  const builder = new DocumentBuilder();
  const budget = new Budget();
  type Paragraph = { style: string; list: number; text: string };
  const paragraphs: Paragraph[] = [];
  const tables: DocTable[] = [];
  let inText = false;
  let fallback = 0;
  let deleted = 0;

  const finishParagraph = () => {
    const paragraph = paragraphs.pop();
    if (!paragraph) return;
    const text = paragraph.text
      .replace(/[ \t]+/g, " ")
      .replace(/ ?\n ?/g, "\n")
      .trim();
    const cell = tables.at(-1)?.cell;
    if (cell) {
      if (text) cell.push(text.replace(/\s*\n\s*/g, " "));
      return;
    }
    if (!text) return;
    const level = wordHeadingLevel(styleNames.get(paragraph.style) ?? "");
    if (level) {
      builder.push(`${"#".repeat(Math.min(level, 6))} ${text}`, level <= 2);
    } else if (paragraph.list >= 0) {
      builder.push(`${"  ".repeat(Math.min(paragraph.list, 6))}- ${text.replace(/\n/g, " ")}`);
    } else builder.push(text);
  };

  walk(body, "docx", limits, {
    open: (tag) => {
      const value = String(tag.attributes["w:val"] ?? "");
      switch (tag.name) {
        case "mc:Fallback":
          fallback += 1;
          break;
        case "w:del":
          deleted += 1;
          break;
        case "w:p":
          paragraphs.push({ style: "", list: -1, text: "" });
          break;
        case "w:pStyle":
          if (paragraphs.length) paragraphs.at(-1)!.style = value;
          break;
        case "w:ilvl": {
          const paragraph = paragraphs.at(-1);
          if (paragraph) paragraph.list = Math.max(Number(value) || 0, 0);
          break;
        }
        case "w:numId": {
          const paragraph = paragraphs.at(-1);
          if (paragraph) {
            if (value === "0") paragraph.list = -1;
            else if (paragraph.list < 0) paragraph.list = 0;
          }
          break;
        }
        case "w:t":
          inText = true;
          break;
        case "w:tab":
          if (paragraphs.length && !fallback) paragraphs.at(-1)!.text += " ";
          break;
        case "w:br":
        case "w:cr":
          if (paragraphs.length && !fallback) paragraphs.at(-1)!.text += "\n";
          break;
        case "w:tbl":
          tables.push({ rows: [], row: null, cell: null });
          break;
        case "w:tr":
          if (tables.length) tables.at(-1)!.row = [];
          break;
        case "w:tc":
          if (tables.length) tables.at(-1)!.cell = [];
          break;
      }
    },
    text: (text) => {
      if (inText && paragraphs.length && !fallback && !deleted) {
        const paragraph = paragraphs.at(-1)!;
        if (paragraph.text.length < 200_000) paragraph.text += text;
      }
    },
    close: (name) => {
      switch (name) {
        case "w:t":
          inText = false;
          break;
        case "mc:Fallback":
          fallback -= 1;
          break;
        case "w:del":
          deleted -= 1;
          break;
        case "w:p":
          if (!fallback) finishParagraph();
          else paragraphs.pop();
          break;
        case "w:tc": {
          const table = tables.at(-1);
          if (table?.row && table.cell) {
            table.row.push(table.cell.join(" "));
            table.cell = null;
          }
          break;
        }
        case "w:tr": {
          const table = tables.at(-1);
          if (table?.row) {
            if (table.rows.length < OFFICE_LIMITS.rowsPerSheet && budget.spend(table.row.length))
              table.rows.push(table.row.slice(0, OFFICE_LIMITS.columns));
            table.row = null;
          }
          break;
        }
        case "w:tbl": {
          const table = tables.pop();
          if (!table?.rows.length) break;
          const outer = tables.at(-1)?.cell;
          if (outer)
            outer.push(table.rows.map((row) => row.filter(Boolean).join("; ")).join(" / "));
          else builder.push(tableToMarkdown(table.rows));
          break;
        }
      }
    },
  });
  return { sections: builder.finish(), notes: [...budget.notes] };
}

// ---------------------------------------------------------------------------------------------
// Excel (.xlsx)

const columnIndex = (reference: string): number => {
  let index = 0;
  for (const char of reference.replace(/[^A-Za-z]/g, "").toUpperCase())
    index = index * 26 + char.charCodeAt(0) - 64;
  return Math.max(index - 1, 0);
};

/** Built-in number formats that show a date or a time. */
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
const isDateFormat = (code: string) =>
  /[dmyhs]/i.test(code.replace(/"[^"]*"|\\.|\[[^\]]*\]|_.|\*./g, ""));

/** A spreadsheet serial number as an ISO date, with the time when it has one. */
function serialDate(value: string): string {
  const serial = Number(value);
  if (!Number.isFinite(serial) || serial < 0 || serial > 2_958_465) return value;
  const date = new Date(Math.round((serial - 25_569) * 86_400_000));
  const iso = date.toISOString();
  return serial % 1 === 0 ? iso.slice(0, 10) : iso.slice(0, 16).replace("T", " ");
}

function xlsxText(files: Map<string, string>, limits: Limits): OfficeText {
  const workbook = files.get("xl/workbook.xml");
  if (workbook === undefined) throw unreadable("xlsx");
  const sheetRefs: { name: string; rid: string }[] = [];
  walk(workbook, "xlsx", limits, {
    open: (tag) => {
      if (tag.name === "sheet")
        sheetRefs.push({
          name: String(tag.attributes.name ?? ""),
          rid: String(tag.attributes["r:id"] ?? ""),
        });
    },
  });
  const targets = new Map<string, string>();
  const rels = files.get("xl/_rels/workbook.xml.rels");
  if (rels)
    walk(rels, "xlsx", limits, {
      open: (tag) => {
        if (tag.name !== "Relationship") return;
        const target = String(tag.attributes.Target ?? "");
        // Only parts inside the file; a link to anywhere else is never followed.
        const path = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
        if (!/^xl\/[^:]*$/.test(path) || path.includes("..")) return;
        targets.set(String(tag.attributes.Id ?? ""), path);
      },
    });

  const shared: string[] = [];
  const strings = files.get("xl/sharedStrings.xml");
  if (strings) {
    let item: string | null = null;
    let inText = false;
    walk(strings, "xlsx", limits, {
      open: (tag) => {
        if (tag.name === "si") item = "";
        else if (tag.name === "t") inText = true;
      },
      text: (text) => {
        if (inText && item !== null && item.length < OFFICE_LIMITS.cellChars) item += text;
      },
      close: (name) => {
        if (name === "t") inText = false;
        else if (name === "si") {
          shared.push(item ?? "");
          item = null;
        }
      },
    });
  }

  // Which cell styles show a date, so a serial number is read as the date it stands for.
  const dateStyles = new Set<number>();
  const styles = files.get("xl/styles.xml");
  if (styles) {
    const custom = new Map<number, string>();
    const formats: number[] = [];
    let inCellXfs = false;
    walk(styles, "xlsx", limits, {
      open: (tag) => {
        if (tag.name === "numFmt")
          custom.set(Number(tag.attributes.numFmtId), String(tag.attributes.formatCode ?? ""));
        else if (tag.name === "cellXfs") inCellXfs = true;
        else if (tag.name === "xf" && inCellXfs) formats.push(Number(tag.attributes.numFmtId));
      },
      close: (name) => {
        if (name === "cellXfs") inCellXfs = false;
      },
    });
    for (const [style, id] of formats.entries()) {
      const code = custom.get(id);
      if (code === undefined ? BUILTIN_DATE_FORMATS.has(id) : isDateFormat(code))
        dateStyles.add(style);
    }
  }

  const budget = new Budget();
  const sheets = sheetRefs.flatMap((ref) => {
    const path = targets.get(ref.rid);
    const xml = path ? files.get(path) : undefined;
    return xml === undefined ? [] : [{ name: ref.name, xml }];
  });
  return sheetsToText(
    sheets.map(({ name, xml }) => ({
      name,
      build: (spend) => {
        const sheet = new SheetBuilder(name, spend);
        let rowNumber = 0;
        let cells: string[] = [];
        let cell: { column: number; type: string; style: number; value: string } | null = null;
        let capture: "v" | "t" | null = null;
        walk(xml, "xlsx", limits, {
          open: (tag) => {
            if (tag.name === "row") {
              rowNumber = Number(tag.attributes.r) || rowNumber + 1;
              cells = [];
            } else if (tag.name === "c") {
              cell = {
                column: columnIndex(String(tag.attributes.r ?? "")),
                type: String(tag.attributes.t ?? "n"),
                style: Number(tag.attributes.s ?? 0),
                value: "",
              };
            } else if (cell && (tag.name === "v" || tag.name === "t")) capture = tag.name;
          },
          text: (text) => {
            if (cell && capture && cell.value.length < OFFICE_LIMITS.cellChars) cell.value += text;
          },
          close: (closed) => {
            if (closed === "v" || closed === "t") capture = null;
            else if (closed === "c" && cell) {
              const { column, type, style, value } = cell;
              cell = null;
              if (column >= OFFICE_LIMITS.columns + 50 || !value) return;
              let shown = value;
              if (type === "s") shown = shared[Number(value)] ?? "";
              else if (type === "b") shown = value === "1" ? "TRUE" : "FALSE";
              else if (type === "n" && dateStyles.has(style)) shown = serialDate(value);
              while (cells.length < column) cells.push("");
              cells[column] = shown;
            } else if (closed === "row") sheet.add(rowNumber, cells);
          },
        });
        return sheet.rows;
      },
    })),
    budget,
  );
}

// ---------------------------------------------------------------------------------------------
// OpenDocument (.odt, .ods)

/** Both OpenDocument kinds in one walk: tables are sheets in a spreadsheet and Markdown in text. */
function odfText(files: Map<string, string>, kind: "odt" | "ods", limits: Limits): OfficeText {
  const xml = files.get("content.xml");
  if (xml === undefined) throw unreadable(kind);
  const budget = new Budget();
  const builder = new DocumentBuilder();
  const sheets: SheetBuilder[] = [];

  type Block = { heading: number; list: number; text: string };
  type Grid = { sheet: SheetBuilder; row: string[] | null; rowNumber: number; repeat: number };
  type Cell = { text: string[]; repeat: number; value: string };
  const blocks: Block[] = [];
  const grids: Grid[] = [];
  const cells: Cell[] = [];
  let listDepth = 0;
  let skip = 0;

  walk(xml, kind, limits, {
    open: (tag) => {
      if (skip || tag.name === "office:annotation" || tag.name === "office:forms") {
        skip += 1;
        return;
      }
      switch (tag.name) {
        case "table:table":
          grids.push({
            sheet: new SheetBuilder(String(tag.attributes["table:name"] ?? ""), budget),
            row: null,
            rowNumber: 0,
            repeat: 1,
          });
          break;
        case "table:table-row": {
          const grid = grids.at(-1);
          if (grid) {
            grid.row = [];
            grid.rowNumber += 1;
            grid.repeat = Math.max(
              Math.min(Number(tag.attributes["table:number-rows-repeated"] ?? 1) || 1, 50),
              1,
            );
          }
          break;
        }
        case "table:table-cell":
        case "table:covered-table-cell": {
          const repeat = Number(tag.attributes["table:number-columns-repeated"] ?? 1) || 1;
          const raw =
            tag.attributes["office:value"] ??
            tag.attributes["office:date-value"] ??
            tag.attributes["office:boolean-value"] ??
            "";
          cells.push({
            text: [],
            repeat: Math.min(repeat, OFFICE_LIMITS.columns),
            value: String(raw),
          });
          break;
        }
        case "text:list":
          listDepth += 1;
          break;
        case "text:h":
        case "text:p":
          blocks.push({
            heading: tag.name === "text:h" ? Number(tag.attributes["text:outline-level"] ?? 1) : 0,
            list: listDepth - 1,
            text: "",
          });
          break;
        case "text:tab":
        case "text:s":
          if (blocks.length) blocks.at(-1)!.text += " ";
          break;
        case "text:line-break":
          if (blocks.length) blocks.at(-1)!.text += "\n";
          break;
      }
    },
    text: (text) => {
      if (!skip && blocks.length && blocks.at(-1)!.text.length < 200_000)
        blocks.at(-1)!.text += text;
    },
    close: (name) => {
      if (skip) {
        skip -= 1;
        return;
      }
      switch (name) {
        case "text:list":
          listDepth -= 1;
          break;
        case "text:h":
        case "text:p": {
          const block = blocks.pop();
          if (!block) break;
          const text = block.text
            .replace(/[ \t]+/g, " ")
            .replace(/ ?\n ?/g, "\n")
            .trim();
          const cell = cells.at(-1);
          if (cell) {
            if (text) cell.text.push(text.replace(/\n/g, " "));
          } else if (text && kind === "odt") {
            if (block.heading)
              builder.push(`${"#".repeat(Math.min(block.heading, 6))} ${text}`, block.heading <= 2);
            else if (block.list >= 0)
              builder.push(`${"  ".repeat(Math.min(block.list, 6))}- ${text.replace(/\n/g, " ")}`);
            else builder.push(text);
          }
          break;
        }
        case "table:table-cell":
        case "table:covered-table-cell": {
          const cell = cells.pop();
          const row = grids.at(-1)?.row;
          if (cell && row) {
            const shown = cell.text.join(" ") || cell.value;
            if (shown || row.length < OFFICE_LIMITS.columns)
              for (let index = 0; index < cell.repeat; index += 1) row.push(shown);
          }
          break;
        }
        case "table:table-row": {
          const grid = grids.at(-1);
          if (grid?.row) {
            const row = grid.row;
            grid.row = null;
            if (row.some((value) => value.trim()))
              for (let index = 0; index < grid.repeat; index += 1)
                grid.sheet.add(grid.rowNumber + index, [...row]);
            grid.rowNumber += grid.repeat - 1;
          }
          break;
        }
        case "table:table": {
          const grid = grids.pop();
          if (!grid) break;
          if (kind === "ods") sheets.push(grid.sheet);
          else if (grid.sheet.rows.length) {
            const [head, ...body] = grid.sheet.rows.map((row) => row.cells);
            const outer = cells.at(-1);
            if (outer)
              outer.text.push(grid.sheet.rows.map((row) => row.cells.join("; ")).join(" / "));
            else builder.push(markdownTable(body, head ?? []));
          }
          break;
        }
      }
    },
  });

  if (kind === "odt") return { sections: builder.finish(), notes: [...budget.notes] };
  return sheetsToText(
    sheets.map((sheet) => ({ name: sheet.name, build: () => sheet.rows })),
    budget,
  );
}

// ---------------------------------------------------------------------------------------------

/** What kind of Office file this is, by its type or its name; undefined for anything else. */
export function officeKind(name: string, mimeType: string): OfficeKind | undefined {
  const type = mimeType.toLowerCase();
  if (
    type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    /\.docx$/i.test(name)
  )
    return "docx";
  if (
    type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    /\.xlsx$/i.test(name)
  )
    return "xlsx";
  if (type === "application/vnd.oasis.opendocument.text" || /\.odt$/i.test(name)) return "odt";
  if (type === "application/vnd.oasis.opendocument.spreadsheet" || /\.ods$/i.test(name))
    return "ods";
  return undefined;
}

/** Older binary Office files, which have no readable XML inside. */
export const isLegacyOfficeFile = (name: string, mimeType: string): boolean =>
  /\.(doc|xls|ppt|pptx|rtf)$/i.test(name) ||
  ["application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint"].includes(
    mimeType.toLowerCase(),
  );

const WANTED: Record<OfficeKind, (name: string) => boolean> = {
  docx: (name) => name === "word/document.xml" || name === "word/styles.xml",
  xlsx: (name) =>
    /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|styles\.xml|worksheets\/[^/]+\.xml)$/.test(
      name,
    ),
  odt: (name) => name === "content.xml",
  ods: (name) => name === "content.xml",
};

/**
 * The text of a Word, Excel or OpenDocument file as sections that name where each came from. Runs
 * synchronously in bounded steps and checks `signal` and its own timeout between them.
 */
export function extractOfficeText(
  bytes: Uint8Array,
  kind: OfficeKind,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): OfficeText {
  const signal = AbortSignal.any([
    AbortSignal.timeout(options.timeoutMs ?? OFFICE_LIMITS.timeoutMs),
    ...(options.signal ? [options.signal] : []),
  ]);
  const limits = { signal };
  const files = unzipParts(bytes, WANTED[kind], kind, limits);
  if (kind === "docx") return docxText(files, limits);
  if (kind === "xlsx") return xlsxText(files, limits);
  return odfText(files, kind, limits);
}
