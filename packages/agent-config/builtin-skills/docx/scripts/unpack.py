#!/usr/bin/env python3
"""Unzip a .docx into a directory and prepare the XML for manual editing.

Steps performed on the unpacked tree:

1.  Pretty-print the main XML files so the Edit tool has something readable
    to work with (Word ships everything on a single line).
2.  Convert curly-quote characters into XML entities so they survive
    subsequent string replacements without losing their typographic form.
3.  Merge runs of identical formatting in `word/document.xml`. Without
    this, a phrase like "hello world" can be split across `<w:r>` elements
    and string-based edits fail to find it.

Usage:
  python unpack.py path/to/in.docx output-dir/ [--no-merge-runs]
"""

from __future__ import annotations

import os
import shutil
import sys
import zipfile
from xml.etree import ElementTree as ET

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
ET.register_namespace("w", W_NS)
ET.register_namespace("r", "http://schemas.openxmlformats.org/officeDocument/2006/relationships")
ET.register_namespace("wp", "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing")
ET.register_namespace("a", "http://schemas.openxmlformats.org/drawingml/2006/main")
ET.register_namespace("pic", "http://schemas.openxmlformats.org/drawingml/2006/picture")

PRETTY_FILES = {
    "word/document.xml",
    "word/comments.xml",
    "word/footnotes.xml",
    "word/endnotes.xml",
    "word/styles.xml",
    "word/numbering.xml",
    "word/header1.xml",
    "word/header2.xml",
    "word/header3.xml",
    "word/footer1.xml",
    "word/footer2.xml",
    "word/footer3.xml",
}

SMART_QUOTES = {
    "‘": "&#x2018;",  # left single
    "’": "&#x2019;",  # right single / apostrophe
    "“": "&#x201C;",  # left double
    "”": "&#x201D;",  # right double
}


def extract(input_path: str, out_dir: str) -> None:
    if os.path.exists(out_dir):
        shutil.rmtree(out_dir)
    with zipfile.ZipFile(input_path) as zf:
        zf.extractall(out_dir)


def pretty_print(path: str) -> None:
    """Indent XML in place using ET.indent (Python 3.9+)."""
    try:
        tree = ET.parse(path)
    except ET.ParseError:
        return
    ET.indent(tree, space="  ")
    tree.write(path, xml_declaration=True, encoding="utf-8", standalone=True)


def convert_smart_quotes(path: str) -> None:
    with open(path, "r", encoding="utf-8") as f:
        text = f.read()
    for char, entity in SMART_QUOTES.items():
        text = text.replace(char, entity)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


def _rpr_signature(rpr: ET.Element | None) -> str:
    """A canonical string representation of run properties for equality comparison."""
    if rpr is None:
        return ""
    return ET.tostring(rpr, encoding="unicode")


def merge_runs(document_xml_path: str) -> None:
    """Combine adjacent <w:r> elements that share the same <w:rPr>.

    Only merges runs that contain a single <w:t> as their non-rPr child.
    Runs containing tabs, breaks, drawings, or other complex content are
    left alone — merging them would change rendering.
    """
    try:
        tree = ET.parse(document_xml_path)
    except ET.ParseError:
        return
    root = tree.getroot()
    w = lambda tag: f"{{{W_NS}}}{tag}"

    def is_simple_run(run: ET.Element) -> bool:
        children = [c for c in run if c.tag != w("rPr")]
        return len(children) == 1 and children[0].tag == w("t")

    for paragraph in root.iter(w("p")):
        runs = [c for c in list(paragraph) if c.tag == w("r")]
        i = 0
        while i < len(runs) - 1:
            a, b = runs[i], runs[i + 1]
            if (
                is_simple_run(a)
                and is_simple_run(b)
                and _rpr_signature(a.find(w("rPr"))) == _rpr_signature(b.find(w("rPr")))
            ):
                t_a = a.find(w("t"))
                t_b = b.find(w("t"))
                if t_a is None or t_b is None:
                    i += 1
                    continue
                t_a.text = (t_a.text or "") + (t_b.text or "")
                # Preserve whitespace if either side had leading/trailing space.
                if t_a.text and (t_a.text != t_a.text.strip()):
                    t_a.set(f"{{{'http://www.w3.org/XML/1998/namespace'}}}space", "preserve")
                paragraph.remove(b)
                runs.pop(i + 1)
            else:
                i += 1

    ET.indent(tree, space="  ")
    tree.write(document_xml_path, xml_declaration=True, encoding="utf-8", standalone=True)


def main(argv: list[str]) -> int:
    args = [a for a in argv[1:] if not a.startswith("--")]
    no_merge = "--no-merge-runs" in argv

    if len(args) != 2:
        print("usage: unpack.py <in.docx> <out-dir/> [--no-merge-runs]", file=sys.stderr)
        return 2

    input_path, out_dir = args
    if not os.path.exists(input_path):
        print(f"file not found: {input_path}", file=sys.stderr)
        return 2

    extract(input_path, out_dir)

    for rel in PRETTY_FILES:
        path = os.path.join(out_dir, rel)
        if os.path.exists(path):
            pretty_print(path)
            convert_smart_quotes(path)

    if not no_merge:
        doc_xml = os.path.join(out_dir, "word/document.xml")
        if os.path.exists(doc_xml):
            merge_runs(doc_xml)

    print(f"unpacked to {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
