---
name: pdf
description: Read, create, edit, or transform PDF files. Trigger when the user mentions a .pdf file or wants to produce one — extracting text/tables, merging, splitting, rotating, watermarking, redacting, filling forms, OCRing scans, encrypting/decrypting, or building a PDF from scratch.
when_to_use: User mentions PDF, .pdf, or wants to read/create/transform a PDF file
paths:
  - "**/*.pdf"
category: Documents
icon: file
featured: true
---

# PDFs (.pdf)

PDFs are not one format — they are a family. Text-based PDFs let you extract text directly. Scanned PDFs are images and need OCR. Form PDFs have AcroForm fields. Pick the tool that matches the task.

## Decision

| Intent | Tool |
|---|---|
| Extract plain text | `pdftotext` (CLI, fast) or `pdfplumber` (Python, layout-aware) |
| Extract tables | `pdfplumber.extract_tables()` |
| Merge / split / rotate / reorder pages | `pypdf` or `qpdf` |
| Add watermark / overlay | `pypdf` page merging |
| Build a new PDF | `reportlab` (Python) or `pdf-lib` (Node) |
| OCR a scanned PDF | `pdf2image` + `pytesseract` |
| Fill an AcroForm | `pypdf` field updates |
| Encrypt / decrypt / remove password | `pypdf` or `qpdf` |
| Extract embedded images | `pdfimages` (poppler) |

Install on demand:

```bash
pip install pypdf pdfplumber reportlab pytesseract pdf2image
# Plus system: poppler (pdftotext, pdftoppm, pdfimages), qpdf, tesseract
```

## Reading text

```bash
# Fast and clean for most documents
pdftotext input.pdf output.txt

# Preserve column / table layout
pdftotext -layout input.pdf output.txt

# A specific page range
pdftotext -f 3 -l 7 input.pdf output.txt
```

For layout-sensitive parsing (forms, structured reports, anything with tables):

```python
import pdfplumber

with pdfplumber.open('input.pdf') as pdf:
    for i, page in enumerate(pdf.pages, start=1):
        text = page.extract_text()
        # ...
```

If `pdftotext` returns garbage or empty output, the PDF is probably scanned — jump to OCR.

## Tables

```python
import pdfplumber, pandas as pd

frames = []
with pdfplumber.open('report.pdf') as pdf:
    for page in pdf.pages:
        for table in page.extract_tables():
            if not table or len(table) < 2:
                continue
            frames.append(pd.DataFrame(table[1:], columns=table[0]))

if frames:
    pd.concat(frames, ignore_index=True).to_excel('tables.xlsx', index=False)
```

`extract_tables()` works well on PDFs with explicit ruling lines. For tables that rely on whitespace alignment, tune the `table_settings` argument (`vertical_strategy='text'`, `horizontal_strategy='text'`).

## Merging, splitting, rotating

```python
from pypdf import PdfReader, PdfWriter

# Merge
writer = PdfWriter()
for path in ['a.pdf', 'b.pdf', 'c.pdf']:
    for page in PdfReader(path).pages:
        writer.add_page(page)
with open('merged.pdf', 'wb') as f:
    writer.write(f)

# Split — every page to its own file
reader = PdfReader('input.pdf')
for i, page in enumerate(reader.pages, start=1):
    out = PdfWriter()
    out.add_page(page)
    with open(f'page_{i:03d}.pdf', 'wb') as f:
        out.write(f)

# Rotate page 1 by 90° clockwise
reader = PdfReader('input.pdf')
writer = PdfWriter()
reader.pages[0].rotate(90)
writer.add_page(reader.pages[0])
for page in reader.pages[1:]:
    writer.add_page(page)
with open('rotated.pdf', 'wb') as f:
    writer.write(f)
```

CLI alternatives that are sometimes faster on large files:

```bash
qpdf --empty --pages a.pdf b.pdf -- merged.pdf
qpdf input.pdf --pages . 1-5 -- first_five.pdf
qpdf input.pdf rotated.pdf --rotate=+90:1
```

## Building a new PDF

For simple drawn content use `reportlab.canvas`. For multi-page reports with flowing text use `Platypus`.

```python
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak
from reportlab.lib.styles import getSampleStyleSheet

doc = SimpleDocTemplate('report.pdf', pagesize=letter,
                        leftMargin=72, rightMargin=72,
                        topMargin=72, bottomMargin=72)
styles = getSampleStyleSheet()

story = []
story.append(Paragraph('Quarterly Review', styles['Title']))
story.append(Spacer(1, 12))
story.append(Paragraph('Body paragraph one. ' * 30, styles['Normal']))
story.append(PageBreak())
story.append(Paragraph('Section Two', styles['Heading1']))
story.append(Paragraph('More content.', styles['Normal']))

doc.build(story)
```

### Critical: never use unicode subscripts or superscripts in reportlab

The bundled fonts do not include Unicode subscript / superscript glyphs. `H₂O` will render as a literal black box. Use the inline markup tags inside `Paragraph` content instead:

```python
Paragraph('H<sub>2</sub>O is the molecule for water.', styles['Normal'])
Paragraph('E = mc<super>2</super>', styles['Normal'])
```

For text drawn directly on a `Canvas` (not a `Paragraph`), shrink the font size and shift the y-coordinate manually rather than emitting a Unicode subscript character.

### Embedding fonts

If you need a font that isn't built in (most non-Latin scripts, branded typefaces), register it before use:

```python
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
pdfmetrics.registerFont(TTFont('Inter', '/path/to/Inter-Regular.ttf'))
# Then reference 'Inter' in styles or canvas.setFont('Inter', 12).
```

## Watermarking

A watermark is a one-page PDF that gets merged onto every page of the target.

```python
from pypdf import PdfReader, PdfWriter

stamp = PdfReader('watermark.pdf').pages[0]
reader = PdfReader('input.pdf')
writer = PdfWriter()

for page in reader.pages:
    page.merge_page(stamp)
    writer.add_page(page)

with open('watermarked.pdf', 'wb') as f:
    writer.write(f)
```

The watermark PDF can itself be created with `reportlab` if you don't already have one.

## OCR — scanned PDFs

```python
from pdf2image import convert_from_path
import pytesseract

pages = convert_from_path('scanned.pdf', dpi=300)  # higher dpi = better OCR
text = ''
for i, image in enumerate(pages, start=1):
    text += f'--- page {i} ---\n'
    text += pytesseract.image_to_string(image, lang='eng')
    text += '\n'

with open('scanned.txt', 'w') as f:
    f.write(text)
```

Notes:

- 300 dpi is the sweet spot. 150 is cheap and lossy; 600 doubles processing time for marginal accuracy gain.
- Pass `lang='eng+spa'` (or whatever language packs are installed) for multilingual documents.
- For tables in scanned PDFs, OCR first, then run `pdfplumber` on a re-rendered text-layer PDF (`ocrmypdf` is the easy way to add a text layer).

## Forms

```python
from pypdf import PdfReader, PdfWriter

reader = PdfReader('form.pdf')
writer = PdfWriter(clone_from=reader)

writer.update_page_form_field_values(
    writer.pages[0],
    { 'name': 'Jane Doe', 'date': '2026-04-29', 'signature': '/Yes' },
)

with open('filled.pdf', 'wb') as f:
    writer.write(f)
```

For checkboxes and radio buttons the value is `/Yes` (selected) or `/Off` (unselected). Field names are case-sensitive. Inspect them with `reader.get_fields()` if you don't know what's available.

If `pypdf` form filling produces fields that don't render in some viewers, fall back to flattening with `pdftk fill_form` or `qpdf --generate-appearances`.

## Encryption

```python
from pypdf import PdfReader, PdfWriter

reader = PdfReader('input.pdf')
writer = PdfWriter()
for page in reader.pages:
    writer.add_page(page)

writer.encrypt(user_password='reader', owner_password='owner-secret')

with open('encrypted.pdf', 'wb') as f:
    writer.write(f)
```

To remove a password (with permission):

```bash
qpdf --password=secret --decrypt encrypted.pdf clean.pdf
```

## Extracting embedded images

```bash
pdfimages -j input.pdf out_prefix
# Produces out_prefix-000.jpg, out_prefix-001.jpg, ...
```

`-j` keeps JPEGs as JPEGs. Without it, `pdfimages` writes everything as `.ppm` which is rarely what you want.

## Quick reference

| Task | One-liner |
|---|---|
| Page count | `pdfinfo input.pdf \| grep Pages` |
| Text dump | `pdftotext input.pdf -` |
| Merge | `qpdf --empty --pages a.pdf b.pdf -- out.pdf` |
| Split into single pages | `qpdf input.pdf --split-pages -- pages` |
| Compress / linearize | `qpdf --linearize input.pdf out.pdf` |
| Strip metadata | `qpdf --empty --copy-encryption=- input.pdf out.pdf` (keeps content, drops outline/info) |

## Dependencies

- `pip install pypdf pdfplumber reportlab pytesseract pdf2image`
- `poppler` — `pdftotext`, `pdftoppm`, `pdfimages`, `pdfinfo`
- `qpdf` — fast structural manipulation
- `tesseract` — OCR engine
- Optional: `ocrmypdf` for one-shot OCR-and-add-text-layer
