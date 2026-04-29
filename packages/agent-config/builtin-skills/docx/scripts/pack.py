#!/usr/bin/env python3
"""Repack an unpacked .docx tree into a valid .docx file.

The ZIP layout for OOXML containers requires `[Content_Types].xml` to be
the first member. Most ZIP tools reorder by name, which produces a
technically-valid archive that some readers (Word in particular) reject.
This script always writes `[Content_Types].xml` first and condenses the
XML files we pretty-printed during unpack.

After packing it optionally validates the file by converting it to PDF
through headless LibreOffice — if the conversion succeeds the docx is
well-formed.

Usage:
  python pack.py unpacked/ output.docx [--no-validate]
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from xml.etree import ElementTree as ET

CONDENSE_FILES = {
    "word/document.xml",
    "word/comments.xml",
    "word/footnotes.xml",
    "word/endnotes.xml",
    "word/styles.xml",
    "word/numbering.xml",
}


def find_soffice() -> str | None:
    candidate = shutil.which("soffice")
    if candidate:
        return candidate
    for fallback in (
        "/Applications/LibreOffice.app/Contents/MacOS/soffice",
        "/usr/bin/soffice",
        "/usr/local/bin/soffice",
        "/snap/bin/libreoffice",
    ):
        if os.path.exists(fallback):
            return fallback
    return None


def condense(path: str) -> None:
    """Strip whitespace between elements so the output isn't bloated."""
    try:
        tree = ET.parse(path)
    except ET.ParseError:
        return
    # Remove indentation by serializing without ET.indent.
    tree.write(path, xml_declaration=True, encoding="utf-8", standalone=True)


def collect_files(root: str) -> list[str]:
    out: list[str] = []
    for dirpath, _dirnames, filenames in os.walk(root):
        for name in filenames:
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, root)
            out.append(rel)
    return sorted(out)


def write_zip(src_dir: str, output_path: str) -> None:
    """Write the docx with [Content_Types].xml as the first entry."""
    members = collect_files(src_dir)
    content_types = "[Content_Types].xml"
    if content_types not in members:
        raise RuntimeError("missing [Content_Types].xml — not a valid docx tree")

    ordered = [content_types] + [m for m in members if m != content_types]
    with zipfile.ZipFile(output_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for rel in ordered:
            zf.write(os.path.join(src_dir, rel), arcname=rel)


def validate(path: str, timeout: int = 60) -> tuple[bool, str]:
    binary = find_soffice()
    if binary is None:
        return True, "validation skipped (LibreOffice not installed)"
    with tempfile.TemporaryDirectory(prefix="anton-validate-") as profile:
        cmd = [
            binary,
            "--headless",
            f"-env:UserInstallation=file://{profile}",
            "--convert-to",
            "pdf",
            "--outdir",
            profile,
            path,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        if result.returncode != 0:
            return False, (result.stderr or result.stdout).strip()
        produced = os.path.join(profile, os.path.splitext(os.path.basename(path))[0] + ".pdf")
        if not os.path.exists(produced):
            return False, "soffice produced no output"
    return True, "ok"


def main(argv: list[str]) -> int:
    args = [a for a in argv[1:] if not a.startswith("--")]
    do_validate = "--no-validate" not in argv

    if len(args) != 2:
        print("usage: pack.py <unpacked-dir/> <out.docx> [--no-validate]", file=sys.stderr)
        return 2

    src_dir, output_path = args
    if not os.path.isdir(src_dir):
        print(f"directory not found: {src_dir}", file=sys.stderr)
        return 2

    for rel in CONDENSE_FILES:
        path = os.path.join(src_dir, rel)
        if os.path.exists(path):
            condense(path)

    write_zip(src_dir, output_path)

    if do_validate:
        ok, message = validate(output_path)
        if not ok:
            print(f"validation failed: {message}", file=sys.stderr)
            return 3
        print(f"packed -> {output_path} ({message})")
    else:
        print(f"packed -> {output_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
