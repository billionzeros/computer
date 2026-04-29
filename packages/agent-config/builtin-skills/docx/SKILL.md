---
name: docx
description: Create, edit, or analyze Microsoft Word documents (.docx). Trigger when the user asks for a Word document, .docx file, report, memo, letter, contract redline, or wants tracked changes, comments, headings, tables of contents, page numbers, or letterhead. Trigger when reading or extracting content from existing .docx files. Do NOT trigger for PDFs, spreadsheets, or Google Docs.
when_to_use: User mentions Word, .docx, doc file, or wants to produce/edit a formatted document deliverable
paths:
  - "**/*.docx"
  - "**/*.doc"
category: Documents
icon: file-text
featured: true
---

# Word Documents (.docx)

A `.docx` is a ZIP of XML. Read it with `pandoc`, build a new one with the `docx` Node library, edit an existing one by unzipping the XML, modifying it, and zipping it back.

## Decision

| User intent | Approach |
|---|---|
| Read or extract text | `pandoc` (preserves tracked changes if asked) |
| Create new from scratch | `docx` npm package, then validate |
| Edit existing | unzip → patch XML → rezip → validate |
| Convert .doc → .docx | `soffice --headless --convert-to docx file.doc` |
| Render a preview | convert to PDF via `soffice`, then `pdftoppm` to images |

Install on demand: `npm install docx` (or `pandoc` / `libreoffice` via the system package manager).

## Reading

```bash
# Plain-text dump
pandoc input.docx -o output.md

# Keep tracked-change markers
pandoc --track-changes=all input.docx -o output.md

# Raw XML for surgical edits
unzip input.docx -d unpacked/
```

Tracked changes live in `word/document.xml` as `<w:ins>` and `<w:del>`. Comments live in `word/comments.xml`.

## Creating

```javascript
const fs = require('node:fs');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  AlignmentType, LevelFormat, PageOrientation,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
  ImageRun, PageBreak, ExternalHyperlink, TableOfContents,
  Header, Footer, PageNumber,
} = require('docx');

const doc = new Document({
  styles: {
    default: { document: { run: { font: 'Arial', size: 24 } } }, // 24 half-points = 12pt
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal',
        run: { size: 32, bold: true, font: 'Arial' },
        paragraph: { spacing: { before: 240, after: 240 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal',
        run: { size: 28, bold: true, font: 'Arial' },
        paragraph: { spacing: { before: 180, after: 180 }, outlineLevel: 1 } },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 }, // US Letter in DXA (1440 = 1 inch)
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      },
    },
    children: [
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Title')] }),
      new Paragraph({ children: [new TextRun('Body paragraph.')] }),
    ],
  }],
});

Packer.toBuffer(doc).then((buf) => fs.writeFileSync('out.docx', buf));
```

### Page sizing — read this before building

The library defaults to **A4**. For US documents always set the page explicitly. Common values in DXA (twentieths of a point, 1 inch = 1440 DXA):

| Paper | width | height | content width with 1" margins |
|---|---|---|---|
| US Letter | 12240 | 15840 | 9360 |
| A4 | 11906 | 16838 | 9026 |

For landscape: pass the **portrait** dimensions and add `orientation: PageOrientation.LANDSCAPE`. The library swaps internally — passing pre-swapped values produces a broken file.

### Bullets and numbered lists — never use unicode

Inserting `•` or `•` as a literal character produces a fake bullet that breaks Word's outline. Always go through the `numbering` config:

```javascript
new Document({
  numbering: {
    config: [
      { reference: 'bullets', levels: [{
        level: 0, format: LevelFormat.BULLET, text: '•',
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } },
      }]},
      { reference: 'numbers', levels: [{
        level: 0, format: LevelFormat.DECIMAL, text: '%1.',
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } },
      }]},
    ],
  },
  // ...
  // Use as:
  // new Paragraph({ numbering: { reference: 'bullets', level: 0 }, children: [...] })
});
```

Same `reference` continues numbering across paragraphs; a different `reference` restarts at 1.

### Tables — set widths in two places

Word renders tables inconsistently across viewers (Word, Google Docs, LibreOffice) unless widths are pinned everywhere:

```javascript
new Table({
  width: { size: 9360, type: WidthType.DXA },     // total width on the table
  columnWidths: [4680, 4680],                     // must sum to the table width
  rows: [
    new TableRow({ children: [
      new TableCell({
        width: { size: 4680, type: WidthType.DXA }, // and on every cell
        borders: { top: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
                   bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
                   left: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
                   right: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' } },
        shading: { fill: 'D5E8F0', type: ShadingType.CLEAR }, // CLEAR, never SOLID
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [new Paragraph({ children: [new TextRun('Header')] })],
      }),
      // ...
    ]}),
  ],
});
```

Rules that catch most rendering bugs:

- Use `WidthType.DXA` everywhere. `WidthType.PERCENTAGE` does not survive Google Docs.
- The `width` on `Table` must equal the sum of `columnWidths`, and each cell's `width` must equal its column width.
- Use `ShadingType.CLEAR` — `ShadingType.SOLID` paints a solid black background in some viewers.
- Cell `margins` are inner padding; they do not extend the cell's outer width.
- Do not use a 1-row table to draw a divider line. Cells have a minimum height and you'll get an empty box. Put a bottom border on a `Paragraph` instead.

### Images

```javascript
new Paragraph({ children: [
  new ImageRun({
    type: 'png', // required — png|jpg|jpeg|gif|bmp|svg
    data: fs.readFileSync('logo.png'),
    transformation: { width: 200, height: 80 },
    altText: { title: 'Logo', description: 'Company logo', name: 'logo' }, // all three required
  }),
]})
```

### Page breaks, headers, footers, hyperlinks

```javascript
// Page break — must live inside a Paragraph
new Paragraph({ children: [new PageBreak()] })

// Or break before a heading
new Paragraph({ pageBreakBefore: true, heading: HeadingLevel.HEADING_1, children: [...] })

// External hyperlink
new Paragraph({ children: [new ExternalHyperlink({
  link: 'https://example.com',
  children: [new TextRun({ text: 'click', style: 'Hyperlink' })],
})]})

// Header + footer with page numbers
sections: [{
  headers: { default: new Header({ children: [new Paragraph('Document Title')] }) },
  footers: { default: new Footer({ children: [new Paragraph({ children: [
    new TextRun('Page '),
    new TextRun({ children: [PageNumber.CURRENT] }),
  ]})] }) },
  children: [/* ... */],
}]

// Table of contents — headings must use HeadingLevel (no custom paragraphStyles)
new TableOfContents('Contents', { hyperlink: true, headingStyleRange: '1-3' })
```

### Validation

Always open the generated file and check it actually parses:

```bash
soffice --headless --convert-to pdf out.docx
# If conversion succeeds, the docx is well-formed.
```

Common reasons docx-js produces a broken file: page break outside a paragraph, table widths that don't sum, missing `type` on `ImageRun`, smart quotes inserted as Unicode without `xml:space="preserve"` context.

## Editing existing documents — use the bundled scripts

Edit XML in place rather than reconstructing the file — that preserves styles, comments, tracked changes, embedded objects. The skill ships three helpers in `${CLAUDE_SKILL_DIR}/scripts/`:

| Script | What it does |
|---|---|
| `unpack.py` | Extract the `.docx`, pretty-print the main XML files, convert curly quotes to entities, merge same-formatting adjacent runs so the Edit tool can find substrings |
| `pack.py` | Repack the directory back into a `.docx` with `[Content_Types].xml` written first, condense the previously pretty-printed XML, and validate by converting to PDF via headless LibreOffice |
| `accept_changes.py` | Walk the OOXML directly and accept every tracked change (insertions kept, deletions applied, change-history records dropped) |

Workflow:

```bash
# 1. Unpack — produces unpacked/ ready for surgical edits
python ${CLAUDE_SKILL_DIR}/scripts/unpack.py input.docx unpacked/

# 2. Patch unpacked/word/document.xml (and friends) with the Edit tool.
#    Make minimal string replacements. Do not write a Python rewriter.

# 3. Repack and validate
python ${CLAUDE_SKILL_DIR}/scripts/pack.py unpacked/ output.docx

# 4. Optional: accept all tracked changes for a clean deliverable
python ${CLAUDE_SKILL_DIR}/scripts/accept_changes.py output.docx clean.docx
```

`unpack.py` accepts `--no-merge-runs` if you specifically want runs preserved (e.g., when the original document depends on per-run formatting that `<w:t>` substrings would break). `pack.py` accepts `--no-validate` to skip the soffice round-trip when LibreOffice isn't available.

### Tracked changes

Wrap inserts in `<w:ins>`, deletes in `<w:del>`. Inside a delete, text uses `<w:delText>` not `<w:t>`.

```xml
<!-- Change "30 days" to "60 days" -->
<w:r><w:t xml:space="preserve">The term is </w:t></w:r>
<w:del w:id="1" w:author="Anton" w:date="2026-04-29T00:00:00Z">
  <w:r><w:delText>30</w:delText></w:r>
</w:del>
<w:ins w:id="2" w:author="Anton" w:date="2026-04-29T00:00:00Z">
  <w:r><w:t>60</w:t></w:r>
</w:ins>
<w:r><w:t xml:space="preserve"> days.</w:t></w:r>
```

When deleting an entire paragraph or list item, also mark the paragraph mark itself as deleted — otherwise accepting changes leaves an empty line:

```xml
<w:p>
  <w:pPr>
    <w:rPr><w:del w:id="3" w:author="Anton" w:date="..."/></w:rPr>
  </w:pPr>
  <w:del w:id="4" w:author="Anton" w:date="...">
    <w:r><w:delText>Paragraph being removed.</w:delText></w:r>
  </w:del>
</w:p>
```

Use `Anton` as the change author unless the user names someone else.

### Smart quotes

When inserting new text into raw XML, use the entity form so quotes survive editing tools:

| Character | Entity |
|---|---|
| ' (apostrophe / right single) | `&#x2019;` |
| ' (left single) | `&#x2018;` |
| " (left double) | `&#x201C;` |
| " (right double) | `&#x201D;` |

### XML element-order rules that bite

- Inside `<w:pPr>`: `<w:pStyle>`, then `<w:numPr>`, then spacing/indent/alignment, then `<w:rPr>` last.
- Add `xml:space="preserve"` to any `<w:t>` whose value starts or ends with whitespace.
- Comment-range markers (`<w:commentRangeStart>`, `<w:commentRangeEnd>`) are siblings of `<w:r>`, never nested inside one.

### Adding an image to an unpacked document

1. Drop the file in `unpacked/word/media/`.
2. Add a relationship in `unpacked/word/_rels/document.xml.rels`: `<Relationship Id="rIdN" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/foo.png"/>`.
3. Add the content type in `unpacked/[Content_Types].xml`: `<Default Extension="png" ContentType="image/png"/>` (skip if already present).
4. Reference the image in `document.xml` with a `<w:drawing>` block whose `<a:blip r:embed="rIdN"/>` points at the relationship.

EMU math: `914400 EMUs = 1 inch`.

## Dependencies

- `npm install docx` — create new files
- `pandoc` — text extraction
- `libreoffice` (`soffice` binary) — convert to PDF for preview / validation
- `poppler` (`pdftoppm`) — PDF to images for visual inspection
