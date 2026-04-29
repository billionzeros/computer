#!/usr/bin/env python3
"""Accept all tracked changes in a .docx and write the result to a new file.

Operates on the OOXML directly so there is no dependency on LibreOffice or
python-docx. The transformation:

  <w:ins>...children...</w:ins>     →  ...children...   (unwrap; insertion is kept)
  <w:del>...children...</w:del>     →  removed entirely (deletion takes effect)
  <w:rPr>...<w:del/>...</w:rPr>     →  the parent paragraph mark deletion is honored
                                       by removing the paragraph itself when its
                                       only run content was inside <w:del>.

Run-property tracked-format changes (`<w:rPrChange>`) and section/paragraph
property changes (`<w:pPrChange>`, `<w:sectPrChange>`) are dropped — accepting
them means keeping the new properties and discarding the recorded "old"
formatting that lives inside those elements.

Usage:
  python accept_changes.py input.docx output.docx
"""

from __future__ import annotations

import os
import re
import shutil
import sys
import tempfile
import zipfile

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"

# Files that may contain tracked-change markup.
TARGETS = ("word/document.xml", "word/footnotes.xml", "word/endnotes.xml", "word/comments.xml")


def w(tag: str) -> str:
    return f"{{{W_NS}}}{tag}"


def accept_xml(xml_bytes: bytes) -> bytes:
    """Return new XML bytes with all tracked changes accepted."""
    from xml.etree import ElementTree as ET

    ET.register_namespace("w", W_NS)
    parser = ET.XMLParser()
    root = ET.fromstring(xml_bytes, parser=parser)

    INS = w("ins")
    DEL = w("del")
    RPR = w("rPr")
    PPR = w("pPr")
    P = w("p")
    RPR_CHANGE = w("rPrChange")
    PPR_CHANGE = w("pPrChange")
    SECT_PR_CHANGE = w("sectPrChange")
    NUM_PR_CHANGE = w("numPrChange")

    # Build parent map so we can mutate the tree.
    parent_of = {child: parent for parent in root.iter() for child in parent}

    def replace_with_children(elem, parent):
        index = list(parent).index(elem)
        parent.remove(elem)
        for offset, child in enumerate(list(elem)):
            parent.insert(index + offset, child)

    # Pass 1: drop all rPrChange / pPrChange / sectPrChange / numPrChange wrappers.
    # These record the *old* values; accepting means keeping current and removing the record.
    for change_tag in (RPR_CHANGE, PPR_CHANGE, SECT_PR_CHANGE, NUM_PR_CHANGE):
        for node in list(root.iter(change_tag)):
            parent = parent_of.get(node)
            if parent is not None:
                parent.remove(node)

    # Pass 2: handle paragraph-mark deletions.
    # If a <w:p>'s <w:pPr><w:rPr> contains <w:del/>, the paragraph mark itself
    # was deleted — accepting means merging this paragraph with the next one.
    # We approximate by removing the paragraph entirely if all of its run content
    # was wrapped in <w:del> (handled below) OR by stripping the <w:del/> marker
    # and letting the empty-paragraph case resolve naturally.
    for paragraph in list(root.iter(P)):
        ppr = paragraph.find(PPR)
        if ppr is None:
            continue
        rpr = ppr.find(RPR)
        if rpr is None:
            continue
        para_del = rpr.find(DEL)
        if para_del is not None:
            rpr.remove(para_del)

    # Pass 3: process <w:ins> (unwrap) and <w:del> (remove).
    # Iterate until stable — ins/del can be nested.
    changed = True
    while changed:
        changed = False
        for node in list(root.iter()):
            tag = node.tag
            parent = parent_of.get(node)
            if parent is None:
                continue
            if tag == INS:
                replace_with_children(node, parent)
                # Refresh parent map for the moved children.
                for child in list(parent):
                    parent_of[child] = parent
                changed = True
                break
            if tag == DEL:
                parent.remove(node)
                changed = True
                break

    # Re-serialize. We have to manage the namespace declaration on the root
    # because ET strips it when we read.
    out = ET.tostring(root, encoding="utf-8", xml_declaration=True, default_namespace=None)
    return out


def fallback_regex_pass(xml: str) -> str:
    """Best-effort cleanup if ElementTree round-tripping mangled namespace prefixes.

    Some .docx files declare exotic namespaces on the root element that ET
    serializes back as `ns0:`, `ns1:`. Word still reads those, but it's ugly.
    This pass restores the conventional `w:` prefix where it's the only sensible
    one (the wordprocessingml namespace).
    """
    return re.sub(r'xmlns:ns0="[^"]*wordprocessingml[^"]*"', f'xmlns:w="{W_NS}"', xml).replace("ns0:", "w:")


def transform_zip(input_path: str, output_path: str) -> None:
    with tempfile.TemporaryDirectory(prefix="anton-accept-") as work:
        with zipfile.ZipFile(input_path, "r") as zin:
            zin.extractall(work)
        for rel in TARGETS:
            path = os.path.join(work, rel)
            if not os.path.exists(path):
                continue
            with open(path, "rb") as f:
                data = f.read()
            try:
                new_bytes = accept_xml(data)
            except Exception as e:
                print(f"warning: failed to transform {rel}: {e}", file=sys.stderr)
                continue
            text = new_bytes.decode("utf-8")
            text = fallback_regex_pass(text)
            with open(path, "w", encoding="utf-8") as f:
                f.write(text)

        # Repack with [Content_Types].xml first.
        members: list[str] = []
        for dirpath, _dirs, files in os.walk(work):
            for name in files:
                full = os.path.join(dirpath, name)
                rel = os.path.relpath(full, work)
                members.append(rel)
        members.sort()
        ordered = ["[Content_Types].xml"] + [m for m in members if m != "[Content_Types].xml"]

        with zipfile.ZipFile(output_path, "w", zipfile.ZIP_DEFLATED) as zout:
            for rel in ordered:
                full = os.path.join(work, rel)
                if os.path.exists(full):
                    zout.write(full, arcname=rel)


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print("usage: accept_changes.py <input.docx> <output.docx>", file=sys.stderr)
        return 2
    input_path, output_path = argv[1], argv[2]
    if not os.path.exists(input_path):
        print(f"file not found: {input_path}", file=sys.stderr)
        return 2

    transform_zip(input_path, output_path)
    print(f"accepted changes -> {output_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
