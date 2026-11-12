# Reading attached documents

A person can attach a PDF, a Word or spreadsheet file, or a text file to a chat and ask about it. The agent reads it with
`read_document`, which works with **no computer**: the file is read straight from storage and its
text is extracted inside the engine. This matters on a computer without Docker, where an agent has
no computer to run `pdftotext` on.

## What it reads

| File | How |
| --- | --- |
| PDF | Text of each page, read with pdf.js (`unpdf`). A page with no text, as in a scan, is empty. |
| Word (`.docx`, `.odt`) | Markdown with headings, lists and tables kept, in `[section N]` pieces. |
| Excel (`.xlsx`, `.ods`) | Each sheet as Markdown tables with the header row repeated, in `[Sheet, rows A-B]` pieces. Dates are shown as dates; formulas show their last saved value and are never run. |
| Plain text, Markdown, CSV, JSON, HTML | Decoded as UTF-8, as it is. |

Anything else (the older `.doc` and `.xls`, images, audio, video) is not read, and the tool says so. A
PDF with no text layer at all comes back with a note to say it is a scan, so the agent does not
guess its contents. A password-protected PDF is refused.

## How an agent uses it

- With no file, `read_document` lists the documents attached in the conversation, newest first.
- With a file (its path from the attachment list, or its exact name) it returns the text. A PDF
  carries a `[page N]` marker before each page, so an answer can name its page.
- A long document comes in parts of 24 000 characters: call again with `offset` set to the
  `next_offset` it returned.

## Limits and safety

- Only a file attached **in this conversation** and belonging to the same person and Space can be
  read; one attached elsewhere is refused.
- A file over the attachment size limit is refused before it is read. A PDF is read up to 500
  pages, and for at most 60 seconds.
- Word and spreadsheet files are zip archives, so they are opened with limits first (2 000 entries,
  24 MB of text from one part, 48 MB in all, 30 seconds), and a spreadsheet is read up to 20 sheets,
  20 000 rows each and 50 columns. No macro, formula or link in them is run or followed.
- A PDF is untrusted input. Its text is returned as data (`untrusted`), never as instructions, and
  a run that reads it is treated like one that read any other outside text.
- Runs that answer a messaging channel do not get the tool.

## Not done yet

Reading a scanned PDF by recognising its text, and the older `.doc` and `.xls` formats.
