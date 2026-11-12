import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { DocumentTextError, documentKind, readableDocumentText } from "./document-text.js";
import { extractOfficeText, OFFICE_LIMITS } from "./office-text.js";

const zip = (files: Record<string, string>) =>
  zipSync(Object.fromEntries(Object.entries(files).map(([name, xml]) => [name, strToU8(xml)])));

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const para = (text: string, style = "", list = false) =>
  `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}${
    list ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : ""
  }</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const docx = (body: string) =>
  zip({
    "word/document.xml": `<?xml version="1.0"?><w:document ${W}><w:body>${body}</w:body></w:document>`,
    "word/styles.xml": `<w:styles ${W}><w:style w:styleId="Titre1"><w:name w:val="heading 1"/></w:style><w:style w:styleId="Titre2"><w:name w:val="heading 2"/></w:style></w:styles>`,
  });

const S = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
const xlsx = (
  sheets: Record<string, string>,
  extra: Record<string, string> = {},
  shared: string[] = [],
) =>
  zip({
    "xl/workbook.xml": `<workbook ${S} xmlns:r="x"><sheets>${Object.keys(sheets)
      .map((name, index) => `<sheet name="${name}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
      .join("")}</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships>${Object.keys(sheets)
      .map(
        (_, index) =>
          `<Relationship Id="rId${index + 1}" Type="t" Target="worksheets/sheet${index + 1}.xml"/>`,
      )
      .join("")}</Relationships>`,
    "xl/sharedStrings.xml": `<sst ${S}>${shared.map((text) => `<si><t>${text}</t></si>`).join("")}</sst>`,
    ...Object.fromEntries(
      Object.values(sheets).map((rows, index) => [
        `xl/worksheets/sheet${index + 1}.xml`,
        `<worksheet ${S}><sheetData>${rows}</sheetData></worksheet>`,
      ]),
    ),
    ...extra,
  });
const letters = (index: number): string =>
  (index >= 26 ? letters(Math.floor(index / 26) - 1) : "") + String.fromCharCode(65 + (index % 26));
const row = (number: number, cells: string[]) =>
  `<row r="${number}">${cells
    .map(
      (value, index) =>
        `<c r="${letters(index)}${number}" t="inlineStr"><is><t>${value}</t></is></c>`,
    )
    .join("")}</row>`;

describe("Word files", () => {
  it("keeps headings, lists and tables as Markdown and cuts sections at headings", () => {
    const { sections } = extractOfficeText(
      docx(
        [
          para("Refund policy", "Titre1"),
          para("Refunds take 5 days."),
          para("Cards", "Titre2"),
          para("Visa", "", true),
          "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Plan</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Price</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>Pro</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>9</w:t></w:r></w:p></w:tc></w:tr></w:tbl>",
        ].join(""),
      ),
      "docx",
    );
    expect(sections.map((section) => section.label)).toEqual(["section 1", "section 2"]);
    expect(sections[0]!.text).toBe("# Refund policy\n\nRefunds take 5 days.");
    expect(sections[1]!.text).toContain("## Cards");
    expect(sections[1]!.text).toContain("- Visa");
    expect(sections[1]!.text).toContain("| Plan | Price |\n| --- | --- |\n| Pro | 9 |");
  });

  it("splits a long document with no headings and ignores deleted and fallback text", () => {
    const long = Array.from({ length: 200 }, (_, i) => para(`Line ${i} ${"x".repeat(60)}`)).join(
      "",
    );
    const result = extractOfficeText(
      docx(`${long}<w:p><w:del><w:r><w:delText>gone</w:delText></w:r></w:del></w:p>`),
      "docx",
    );
    expect(result.sections.length).toBeGreaterThan(2);
    expect(result.sections.map((section) => section.text).join("")).not.toContain("gone");
  });

  it("does not resolve entities a file declares", () => {
    const evil = zip({
      "word/document.xml": `<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><w:document ${W}><w:body><w:p><w:r><w:t>&e;</w:t></w:r></w:p></w:body></w:document>`,
    });
    expect(() => extractOfficeText(evil, "docx")).toThrow(DocumentTextError);
  });

  it("refuses a file that is not a zip or has no document", () => {
    expect(() => extractOfficeText(strToU8("not a zip at all"), "docx")).toThrow(
      /not a readable Word file/,
    );
    expect(() => extractOfficeText(zip({ "other.xml": "<a/>" }), "docx")).toThrow(
      /not a readable Word file/,
    );
  });
});

describe("Excel files", () => {
  it("makes each sheet Markdown tables with the header kept in every piece", () => {
    const rows = [row(1, ["Name", "Score"])];
    for (let i = 2; i <= 400; i += 1) rows.push(row(i, [`Person ${i} ${"y".repeat(30)}`, `${i}`]));
    const result = extractOfficeText(xlsx({ Sales: rows.join(""), Empty: "" }), "xlsx");
    expect(result.sections.length).toBeGreaterThan(2);
    expect(result.sections[0]!.label).toMatch(/^Sales, rows 2-\d+$/);
    for (const section of result.sections) {
      expect(section.text).toContain("### Sales\n| Name | Score |\n| --- | --- |");
    }
    expect(result.sections.at(-1)!.label).toMatch(/rows \d+-400$/);
    expect(result.notes).toEqual([]);
  });

  it("reads shared strings, booleans and dates, and never evaluates a formula", () => {
    const sheet = `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row><row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2" s="1"><v>45292</v></c><c r="C2"><f>HYPERLINK("http://evil","x")</f><v>7</v></c><c r="D2" t="b"><v>1</v></c></row>`;
    const { sections } = extractOfficeText(
      xlsx(
        { S: sheet },
        {
          "xl/styles.xml": `<styleSheet ${S}><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>`,
        },
        ["Item", "When", "Qty", "Pipe | here"],
      ),
      "xlsx",
    );
    expect(sections[0]!.text).toContain("| Item | When | Qty |  |");
    expect(sections[0]!.text).toContain("| Pipe \\| here | 2024-01-01 | 7 | TRUE |");
    expect(sections[0]!.text).not.toContain("HYPERLINK");
  });

  it("caps sheets, rows and columns and says what was left out", () => {
    const wide = row(
      1,
      Array.from({ length: 60 }, (_, i) => `c${i}`),
    );
    const tall = Array.from({ length: OFFICE_LIMITS.rowsPerSheet + 5 }, (_, i) =>
      row(i + 1, ["a"]),
    ).join("");
    const many = Object.fromEntries(
      Array.from({ length: OFFICE_LIMITS.sheets + 2 }, (_, i) => [
        `S${i}`,
        row(1, ["h"]) + row(2, ["v"]),
      ]),
    );
    const wideResult = extractOfficeText(xlsx({ W: wide }), "xlsx");
    expect(wideResult.notes.join(" ")).toContain(`first ${OFFICE_LIMITS.columns} columns`);
    const tallResult = extractOfficeText(xlsx({ T: tall }), "xlsx");
    expect(tallResult.notes.join(" ")).toContain('rows of "T"');
    const manyResult = extractOfficeText(xlsx(many), "xlsx");
    expect(manyResult.notes.join(" ")).toContain(`first ${OFFICE_LIMITS.sheets} sheets`);
    expect(manyResult.sections).toHaveLength(OFFICE_LIMITS.sheets);
  });

  it("does not follow a relationship that points outside the file", () => {
    const bytes = xlsx({ A: row(1, ["h"]) + row(2, ["v"]) });
    const outside = zip({
      "xl/workbook.xml": `<workbook ${S} xmlns:r="x"><sheets><sheet name="A" r:id="rId1"/></sheets></workbook>`,
      "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Target="http://evil/x.xml" TargetMode="External"/></Relationships>`,
    });
    expect(extractOfficeText(bytes, "xlsx").sections).toHaveLength(1);
    expect(extractOfficeText(outside, "xlsx").sections).toHaveLength(0);
  });
});

describe("OpenDocument files", () => {
  const O = 'xmlns:office="o" xmlns:text="t" xmlns:table="b"';
  it("reads text with headings and lists", () => {
    const bytes = zip({
      "content.xml": `<office:document-content ${O}><office:body><office:text><text:h text:outline-level="1">Policy</text:h><text:p>Be kind<text:tab/>always.</text:p><text:list><text:list-item><text:p>One</text:p></text:list-item></text:list></office:text></office:body></office:document-content>`,
    });
    const { sections } = extractOfficeText(bytes, "odt");
    expect(sections[0]!.text).toBe("# Policy\n\nBe kind always.\n\n- One");
  });

  it("reads sheets with repeated cells and caps repeated empty rows", () => {
    const bytes = zip({
      "content.xml": `<office:document-content ${O}><office:body><office:spreadsheet><table:table table:name="Data"><table:table-row><table:table-cell office:value-type="string"><text:p>Item</text:p></table:table-cell><table:table-cell><text:p>Qty</text:p></table:table-cell></table:table-row><table:table-row><table:table-cell><text:p>Nut</text:p></table:table-cell><table:table-cell office:value="3"/></table:table-row><table:table-row table:number-rows-repeated="1048000"><table:table-cell table:number-columns-repeated="16000"/></table:table-row></table:table></office:spreadsheet></office:body></office:document-content>`,
    });
    const { sections } = extractOfficeText(bytes, "ods");
    expect(sections).toHaveLength(1);
    expect(sections[0]!.label).toBe("Data, rows 2-2");
    expect(sections[0]!.text).toContain("| Nut | 3 |");
  });
});

describe("limits on untrusted files", () => {
  it("refuses a zip bomb by what it holds once opened, before parsing it", () => {
    const bomb = zip({
      "word/document.xml": `<w:document ${W}><w:body>${"<w:p><w:r><w:t>a</w:t></w:r></w:p>".repeat(1)}</w:body></w:document>${" ".repeat(OFFICE_LIMITS.entryBytes + 1)}`,
    });
    expect(bomb.length).toBeLessThan(200_000);
    expect(() => extractOfficeText(bomb, "docx")).toThrow(/too large once opened/);
  });

  it("refuses a zip with too many entries", () => {
    const files: Record<string, string> = { "word/document.xml": "<a/>" };
    for (let i = 0; i <= OFFICE_LIMITS.entries; i += 1) files[`media/${i}.bin`] = "x";
    expect(() => extractOfficeText(zip(files), "docx")).toThrow(/too many parts/);
  });

  it("stops when the time is up or the request is cancelled", () => {
    const bytes = docx(para("Text"));
    expect(() => extractOfficeText(bytes, "docx", { timeoutMs: -1 })).toThrow();
    const controller = new AbortController();
    controller.abort();
    expect(() => extractOfficeText(bytes, "docx", { signal: controller.signal })).toThrow();
  });
});

describe("through the document reader", () => {
  it("knows Office files by type or name and refuses the old formats in words", async () => {
    expect(documentKind("a.docx", "application/octet-stream")).toBe("docx");
    expect(documentKind("a.xlsx", "")).toBe("xlsx");
    expect(documentKind("a.odt", "")).toBe("odt");
    expect(documentKind("a.ods", "")).toBe("ods");
    expect(documentKind("a.doc", "application/msword")).toBeUndefined();
    expect(documentKind("a.xls", "application/vnd.ms-excel")).toBeUndefined();
    await expect(readableDocumentText(strToU8("x"), "a.doc", "application/msword")).rejects.toThrow(
      /\.doc, \.xls.*\.docx or \.xlsx/,
    );
    const text = await readableDocumentText(docx(para("Hello")), "a.docx", "");
    expect(text.text).toBe("[section 1]\nHello");
    expect(text.hasText).toBe(true);
  });
});
