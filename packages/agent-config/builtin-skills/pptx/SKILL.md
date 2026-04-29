---
name: pptx
description: Create, edit, or analyze PowerPoint presentations (.pptx). Trigger when the user asks for a deck, slides, pitch deck, presentation, slide deck, or mentions a .pptx file. Trigger when reading or extracting content from a presentation, even if the extracted content will end up somewhere else.
when_to_use: User mentions deck, slides, pitch, presentation, .pptx, or wants to produce slide visuals
paths:
  - "**/*.pptx"
category: Documents
icon: presentation
featured: true
---

# PowerPoint (.pptx)

A `.pptx` is a ZIP of XML. Build new decks with the `pptxgenjs` Node library. Read existing decks with `markitdown` for text and `soffice` + `pdftoppm` for visuals. For surgical edits to an existing deck, unzip → patch XML → rezip (same as docx).

## Decision

| Intent | Tool |
|---|---|
| Read text | `markitdown deck.pptx` |
| Visual review | `soffice --headless --convert-to pdf` then `pdftoppm -jpeg -r 150` |
| Build from scratch | `pptxgenjs` |
| Edit an existing deck | unzip → edit `ppt/slides/*.xml` → rezip |
| Combine / split slides | unzip both, move slide XML and rels, rezip |

Install on demand: `npm install pptxgenjs`, `pip install markitdown[pptx]`, plus `libreoffice` and `poppler` for rendering.

## Reading

```bash
# Text + structure
python -m markitdown deck.pptx

# Render every slide to a JPEG for visual inspection
soffice --headless --convert-to pdf deck.pptx
pdftoppm -jpeg -r 150 deck.pdf slide
# Produces slide-1.jpg, slide-2.jpg, ...
```

For surgical edits without re-rendering the design, use `unzip deck.pptx -d unpacked/` and read `ppt/slides/slide1.xml` etc.

## Building from scratch

```javascript
const PptxGenJS = require('pptxgenjs');
const pres = new PptxGenJS();

pres.layout = 'LAYOUT_WIDE'; // 13.333 x 7.5 inches — modern 16:9
// LAYOUT_4x3 (10 x 7.5) for legacy projectors

const COLOR = { primary: '1E2761', accent: 'F96167', body: '36454F', bg: 'FFFFFF' };

const slide = pres.addSlide();
slide.background = { color: COLOR.bg };

slide.addText('Title goes here', {
  x: 0.5, y: 0.5, w: 12.3, h: 1,
  fontSize: 40, bold: true, color: COLOR.primary, fontFace: 'Calibri',
});

slide.addText('Body line', {
  x: 0.5, y: 1.8, w: 12.3, h: 0.5,
  fontSize: 16, color: COLOR.body, fontFace: 'Calibri',
});

slide.addImage({ path: 'chart.png', x: 7, y: 3, w: 5.5, h: 3.5 });

await pres.writeFile({ fileName: 'out.pptx' });
```

### Geometry

`LAYOUT_WIDE` is 13.333 inches wide by 7.5 tall. Coordinates are in inches, decimal numbers are fine. Set `x`, `y`, `w`, `h` on every element — relying on auto-layout produces slides that overlap.

Margin discipline: keep at least 0.5" from every edge. Most "looks broken" complaints are content too close to the slide boundary.

### Layout patterns that read well

- **Title slide**: dark background, single sentence centered, small accent shape in a corner.
- **Two-column**: text on the left half (x=0.5, w=6), visual on the right half (x=7, w=5.8).
- **Stat callout**: one big number (60–80pt) centered, small caption underneath.
- **Icon rows**: a column of three to five rows, each with an icon shape in a colored circle plus a one-line label and a smaller description.
- **Half-bleed image**: full-height image filling one side (x=0, y=0, w=6.66, h=7.5), text on the other half.

Vary layouts across the deck — repeating the same template for every slide reads as boilerplate.

### Visual rules that make slides not look AI-generated

- Pick a palette that fits the topic. Generic blue corporate is the default tell. If the same colors would also fit a completely unrelated deck, choose again.
- Give one color clear visual dominance (60–70% of the deck), one or two supporting tones, and one sharper accent. Equal weighting of three colors is what AI tends to produce; humans don't.
- Pair fonts intentionally — a header face with personality and a clean body face. Don't ship Arial body + Arial title.
- No thin horizontal accent line under every title. That decoration is a strong AI tell.
- Title slides and conclusions can use a dark background; content slides usually want light. Or commit to dark throughout if the topic warrants it.
- Every slide should carry at least one non-text element — an icon, a chart, a shape, an image. A page of text + bullets is forgettable.
- Body text is left-aligned; only titles and stat callouts are centered.

### Palette starting points

Use these as inspiration, not defaults. The dominant color is what carries 60–70% of the deck (background or large blocks); the accent is small but high-contrast.

| Palette | Dominant | Supporting | Accent | Fits |
|---|---|---|---|---|
| **Deep Slate** | `1F2933` slate | `E4E7EB` mist | `FF6B5B` coral | Tech / SaaS / dev tools |
| **Forest Court** | `1B3A2F` pine | `EFE6D6` cream | `D9A03C` amber | Sustainability, outdoors, agriculture |
| **Linen & Ink** | `F4EFE6` linen | `1B2A41` ink | `C44536` terracotta | Consulting, financial, professional services |
| **Burgundy Steel** | `5C1F2B` burgundy | `2E2E2E` charcoal | `D7C9A7` soft sand | Legal, wealth management, classical brands |
| **Pacific Drift** | `0F4C5C` teal | `E2D7B5` sand | `1E2761` deep navy | Travel, hospitality, marine |
| **Studio Mono** | `0A0A0A` black | `FFFFFF` white | `F2C12E` school-bus yellow | Creative agency, fashion, editorial |
| **Aurora** | `2D1B4E` deep purple | `F2D7E0` rose | `E63B7A` magenta | Consumer lifestyle, beauty, B2C |
| **Electric Lab** | `0D0F12` near-black | `1E2227` graphite | `B5FF3A` lime | Developer tools, security, infra |
| **Clinic White** | `FFFFFF` white | `2C5282` clinical blue | `38A169` validation green | Healthcare, medical devices, compliance |
| **Warm Brick** | `B23A48` brick | `FCE2C7` peach | `2B2D42` ink | Hospitality, food & beverage, retail |

Don't ship more than three colors total per slide. If you find yourself reaching for a fourth, you're describing too much; cut something.

### Font pairings

`pptxgenjs` ships text rendered with whatever fonts are installed on the viewer's machine. To stay portable, stick to faces that are bundled with Office and most operating systems, or embed your own.

| Style | Header | Body | Read |
|---|---|---|---|
| **Editorial serif** | Georgia | Calibri | Bookish, deliberate, long-form |
| **Modern minimal** | Calibri | Calibri Light | Clean, restrained, default-pleasant |
| **Classic corporate** | Garamond | Calibri | Established, traditional, professional |
| **Bold pitch** | Trebuchet MS | Calibri | Friendly, energetic, founder-deck |
| **High contrast** | Impact | Arial | Punchy, headline-driven, consumer |
| **Technical** | Consolas | Calibri | Engineering, infrastructure, dev tooling |
| **Premium serif** | Palatino | Garamond | Luxury, wealth, conservative |
| **Display sans** | Arial Black | Arial | Loud titles, plain body |

Use the same pairing across the whole deck. Mixing two header faces or two body faces reads as inconsistency, not variety.

### Type sizing

| Element | Size |
|---|---|
| Slide title | 36–44pt bold |
| Section header | 20–24pt bold |
| Body | 14–16pt |
| Caption / footnote | 10–12pt, muted color |

If the title size is similar to body size, the slide reads as a wall of text. Keep at least a 2× ratio between title and body.

### Charts

`pptxgenjs` has native chart support — use it instead of drawing bars and lines as shapes. Native charts stay editable in PowerPoint and resize cleanly.

```javascript
slide.addChart(pres.ChartType.bar, [
  { name: 'Q1', labels: ['A', 'B', 'C'], values: [10, 20, 15] },
], { x: 1, y: 1, w: 6, h: 4 });
```

Hand-drawn charts using shapes are acceptable only when the chart type isn't supported (sparklines, custom annotations).

## Editing an existing deck

```bash
unzip input.pptx -d unpacked/

# Slide N is at unpacked/ppt/slides/slideN.xml
# Slide order is in unpacked/ppt/_rels/presentation.xml.rels (rId order)
# Comments live in unpacked/ppt/comments/commentN.xml

# Edit XML with the Edit tool. Don't write a Python rewriter for simple
# string substitutions — Edit shows the diff.

cd unpacked
zip -X -r ../output.pptx '[Content_Types].xml'
zip -X -r ../output.pptx . -x '[Content_Types].xml'
cd ..

# Validate by rendering
soffice --headless --convert-to pdf output.pptx
```

To duplicate a slide, copy its `slideN.xml` and the matching `_rels/slideN.xml.rels`, give them a new number, then add an entry in `presentation.xml` and `presentation.xml.rels`.

## QA loop — do not skip this

The first render is almost never right. Treat QA as bug-hunting; if you found nothing on the first inspection you didn't look hard enough.

The skill ships a renderer at `${CLAUDE_SKILL_DIR}/scripts/thumbnails.py` that does the soffice→PDF→JPEG pipeline plus a contact-sheet grid:

```bash
python ${CLAUDE_SKILL_DIR}/scripts/thumbnails.py deck.pptx
# Outputs ./pptx-thumbnails-deck/slide-1.jpg, slide-2.jpg, ..., contact-sheet.jpg
```

Then:

1. Open the contact sheet to scan the deck at a glance.
2. **Use a sub-agent for fresh-eyes review.** You've been staring at the code and will see what you intended, not what's there. Spawn an Agent and pass the slide images with a prompt that lists what to look for:
   - overlapping elements (text crossing shapes, lines through words)
   - text overflow or cut-off at box edges
   - decorative lines positioned for one-line titles when the title wrapped to two
   - source citations colliding with body content
   - element gaps below 0.3"
   - inconsistent margins (< 0.5") from the slide edge
   - low-contrast text or icons (light on light, dark on dark)
   - leftover placeholder text from a template
3. Apply fixes.
4. Re-render and re-check. Fixing one thing usually breaks another.
5. Repeat until a full pass surfaces nothing new.

### Rendering one slide after a fix

```bash
# Re-render the whole deck (fast for small decks)
python ${CLAUDE_SKILL_DIR}/scripts/thumbnails.py deck.pptx --no-grid

# Or render just slide 5 manually for speed
soffice --headless --convert-to pdf deck.pptx
pdftoppm -jpeg -r 150 -f 5 -l 5 deck.pdf slide-fixed
```

### Placeholder check before delivery

```bash
python -m markitdown out.pptx | grep -iE 'lorem|ipsum|xxxx|click here|placeholder|your text here|sample text'
```

Any hits, fix them.

## Dependencies

- `npm install pptxgenjs` — create from scratch
- `pip install "markitdown[pptx]"` — text extraction
- `libreoffice` — render to PDF
- `poppler` (`pdftoppm`) — PDF to images for review
