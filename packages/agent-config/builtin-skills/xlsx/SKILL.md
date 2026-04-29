---
name: xlsx
description: Create, edit, or analyze spreadsheets — .xlsx, .xlsm, .csv, .tsv. Trigger when the user references a spreadsheet by name, asks to add columns / write formulas / format / chart / clean tabular data, or wants a spreadsheet deliverable. Trigger when the user wants to convert tabular data into Excel. Do NOT trigger when the deliverable is a Word doc, PDF report, or a Google Sheets API integration.
when_to_use: User mentions Excel, .xlsx, spreadsheet, workbook, formula, pivot, financial model, or wants tabular data as a file
paths:
  - "**/*.xlsx"
  - "**/*.xlsm"
  - "**/*.csv"
  - "**/*.tsv"
category: Documents
icon: table
featured: true
---

# Spreadsheets (.xlsx)

Use **pandas** for analysis and bulk transforms, **openpyxl** for anything that requires formulas, formatting, or preserving an existing template. Both are Python.

## Decision

| Intent | Library |
|---|---|
| Read/analyze, summary stats, ETL | `pandas` |
| Build a model with formulas | `openpyxl` |
| Edit while preserving styles/formulas of an existing file | `openpyxl` (load_workbook with defaults) |
| Export computed dataframe to xlsx | `pandas.DataFrame.to_excel` |
| Convert .csv → .xlsx | pandas |
| Recalculate formulas after writing | `soffice --headless --calc --convert-to xlsx` (LibreOffice round-trip) |

Install on demand: `pip install openpyxl pandas`.

## The most important rule: use formulas, not Python-computed values

The whole point of an Excel deliverable is that the user can change an input cell and watch downstream cells update. If you compute the answer in Python and write the literal number, you've shipped a static report dressed up as a spreadsheet.

```python
# WRONG — hardcoded result, no longer dynamic
total = df['Revenue'].sum()
sheet['B12'] = total

# RIGHT — formula stays live
sheet['B12'] = '=SUM(B2:B11)'
```

This applies to totals, growth rates, ratios, percentages, lookups, currency conversions — anything the user might want to tweak inputs for. Hardcode raw inputs (assumptions, data points). Compute everything else with formulas.

## Reading

```python
import pandas as pd

# Single sheet
df = pd.read_excel('input.xlsx')

# All sheets
sheets = pd.read_excel('input.xlsx', sheet_name=None)

# Specific columns / dtype hints
df = pd.read_excel('input.xlsx', usecols=['id', 'name', 'amount'], dtype={'id': str})

# Quick inspection
df.head(); df.info(); df.describe()
```

To read formula values that were last computed by Excel itself:

```python
from openpyxl import load_workbook
wb = load_workbook('input.xlsx', data_only=True)  # returns last cached values
```

Caveat: if you `save()` a workbook that was loaded with `data_only=True`, all formulas are replaced by their cached values and lost forever. Use `data_only=True` only for read-only inspection.

## Creating

```python
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

wb = Workbook()
ws = wb.active
ws.title = 'Model'

# Headers
ws.append(['Period', 'Revenue', 'COGS', 'Gross Profit', 'Margin'])
for col in range(1, 6):
    cell = ws.cell(row=1, column=col)
    cell.font = Font(bold=True, color='FFFFFF', name='Arial')
    cell.fill = PatternFill('solid', fgColor='1E2761')
    cell.alignment = Alignment(horizontal='center')

# Data + formulas
for i, period in enumerate(['Q1', 'Q2', 'Q3', 'Q4'], start=2):
    ws.cell(row=i, column=1, value=period)
    ws.cell(row=i, column=2, value=100 + i * 10)   # input
    ws.cell(row=i, column=3, value=40 + i * 4)     # input
    ws.cell(row=i, column=4, value=f'=B{i}-C{i}')  # formula
    ws.cell(row=i, column=5, value=f'=D{i}/B{i}')  # formula

# Totals row
ws.cell(row=6, column=1, value='Total').font = Font(bold=True)
for col_letter in ('B', 'C', 'D'):
    ws[f'{col_letter}6'] = f'=SUM({col_letter}2:{col_letter}5)'

# Number formats
for r in range(2, 6):
    for c in ('B', 'C', 'D'):
        ws[f'{c}{r}'].number_format = '$#,##0;($#,##0);-'
    ws[f'E{r}'].number_format = '0.0%'

# Column widths
for col in range(1, 6):
    ws.column_dimensions[get_column_letter(col)].width = 14

wb.save('out.xlsx')
```

## Recalculating formulas — use the bundled script

`openpyxl` writes formula strings but does **not** evaluate them. If you open the saved file in any tool that reads cached values (most viewers, `data_only=True`, anything that renders to PDF), the formula cells appear blank or show stale numbers.

The skill ships a helper that does the LibreOffice round-trip and scans for errors in one shot:

```bash
python ${CLAUDE_SKILL_DIR}/scripts/recalc.py out.xlsx
```

It prints JSON. `status: success` means every formula evaluated without error. `status: errors_found` means at least one cell has `#REF!` / `#DIV/0!` / `#VALUE!` / `#NAME?` / `#N/A` / `#NUM!` / `#NULL!` and `error_summary` lists the worst offenders by sheet + coordinate. Fix and rerun until status is success.

If LibreOffice is not installed the script tells you how to install it. If you cannot install LibreOffice, fall back to the manual recipe below — but then you have no automatic error scan, so do it yourself.

### Manual fallback if you can't run the script

```bash
soffice --headless --calc --convert-to xlsx out.xlsx --outdir /tmp/recalc
mv /tmp/recalc/out.xlsx out.xlsx
```

```python
from openpyxl import load_workbook
wb = load_workbook('out.xlsx', data_only=True)
errors = []
for ws in wb.worksheets:
    for row in ws.iter_rows():
        for cell in row:
            v = cell.value
            if isinstance(v, str) and v.startswith('#') and v.endswith(('!', '?')):
                errors.append((ws.title, cell.coordinate, v))
print(errors)
```

Common causes:

- `#REF!` — formula points at a row or column that was deleted, or a sheet that was renamed.
- `#DIV/0!` — denominator is 0 or empty. Wrap in `IFERROR(.../denom, 0)` or guard with `IF(denom=0, 0, num/denom)`.
- `#VALUE!` — text where a number was expected; check `dtype` of the source data.
- `#NAME?` — function name typo, or a function that exists in Excel but not LibreOffice (`XLOOKUP` works on modern versions; older `soffice` does not).
- `#N/A` — `VLOOKUP`/`MATCH` did not find the key. Often legitimate; wrap with `IFNA(...)` if you want a clean display.

## Editing existing files without trashing the template

Match the existing style. The user's template is the spec — your guidelines are not.

```python
from openpyxl import load_workbook

wb = load_workbook('template.xlsx')
ws = wb['Inputs']

# Find an existing cell and copy its formatting before adding adjacent data
src = ws['B2']
new = ws['B7']
new.value = 1234
new.font = src.font.copy()
new.fill = src.fill.copy()
new.number_format = src.number_format
new.alignment = src.alignment.copy()

wb.save('updated.xlsx')
```

Do not impose a different number format, color scheme, or column width than what the template already uses.

## Financial model conventions

When building a financial model from scratch (no template to match), the industry expects color-coded inputs:

| Color | Use |
|---|---|
| Blue text | Hardcoded inputs (assumptions, scenario knobs) |
| Black text | Formulas computed within the same sheet |
| Green text | Links to other sheets in the same workbook |
| Red text | Links to external workbooks |
| Yellow fill | Cells that need attention or user input |

```python
from openpyxl.styles import Font, PatternFill
INPUT = Font(color='0000FF')        # blue
FORMULA = Font(color='000000')      # black
LINK = Font(color='008000')         # green
EXTERNAL = Font(color='FF0000')     # red
ATTENTION = PatternFill('solid', fgColor='FFFF00')
```

Number-format conventions:

- Currency: `$#,##0;($#,##0);-` — thousands separator, parentheses for negatives, dash for zero.
- Percent: `0.0%` (one decimal).
- Multiples: `0.0"x"` for valuation multiples like EV/EBITDA.
- Years: store as text strings (`"2024"`), not as numbers — keeps Excel from rendering them as `2,024`.

Place every assumption in a labeled input cell and reference it by cell name. `=B5*(1+$B$6)` is correct; `=B5*1.05` hides the 5% from the user.

Cite hardcoded numbers in an adjacent cell or comment: source, date, document, page. Models without sourced inputs are not auditable.

## Pitfalls when working with pandas + Excel

- Excel rows and columns are 1-indexed; pandas DataFrames are 0-indexed. DataFrame row 0 lands in Excel row 2 if you write headers.
- Column number 64 is Excel column `BL`, not `BK`. Use `openpyxl.utils.get_column_letter(n)` rather than hand-counting.
- Quarterly data often lives 50+ columns in. Don't stop scanning at column 26.
- Search for all matches when looking up a value. The first occurrence is rarely the right one in financial models with subtotals.
- Always check `pd.notna(value)` before passing to a formula — `nan` becomes the string `'nan'` in openpyxl.
- For very large files: `read_only=True` (read) or `write_only=True` (write) keeps memory bounded.

## Code style for spreadsheet scripts

Keep the Python script short. The deliverable is the spreadsheet, not the code that produced it. Avoid:

- Verbose variable names that don't add clarity.
- Print statements left in for debugging.
- Comments explaining each `ws.cell(...)` line — the cell address is self-documenting.

Add cell-level comments inside the workbook itself for non-obvious formulas, key assumptions, and data sources. Those travel with the file.

## Dependencies

- `pip install openpyxl pandas` — core read/write/format/formulas
- `libreoffice` (`soffice` binary) — formula recalculation
- Optional: `pip install xlsxwriter` for a faster write-only path with chart support
