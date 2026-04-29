#!/usr/bin/env python3
"""Render every slide of a .pptx as a JPEG, plus an optional contact sheet.

Pipeline:
  pptx → PDF (LibreOffice) → JPEGs (poppler's pdftoppm) → optional grid (Pillow)

The contact sheet is what you hand to a sub-agent for fresh-eyes visual QA.

Usage:
  python thumbnails.py deck.pptx [--out OUT_DIR] [--dpi 150] [--no-grid]

Defaults:
  OUT_DIR = ./pptx-thumbnails-<basename>
  DPI     = 150
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile


def find_soffice() -> str:
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
    raise RuntimeError("LibreOffice not found. brew install --cask libreoffice")


def run_soffice_to_pdf(pptx_path: str, out_pdf_dir: str, timeout: int = 120) -> str:
    binary = find_soffice()
    with tempfile.TemporaryDirectory(prefix="anton-pptx-") as profile:
        cmd = [
            binary,
            "--headless",
            f"-env:UserInstallation=file://{profile}",
            "--convert-to",
            "pdf",
            "--outdir",
            out_pdf_dir,
            pptx_path,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        if result.returncode != 0:
            raise RuntimeError(f"soffice failed: {result.stderr or result.stdout}")
    expected = os.path.join(out_pdf_dir, os.path.splitext(os.path.basename(pptx_path))[0] + ".pdf")
    if not os.path.exists(expected):
        raise RuntimeError("soffice produced no PDF")
    return expected


def render_pages(pdf_path: str, out_dir: str, dpi: int) -> list[str]:
    if not shutil.which("pdftoppm"):
        raise RuntimeError("pdftoppm not found. Install poppler (brew install poppler / apt install poppler-utils)")
    prefix = os.path.join(out_dir, "slide")
    cmd = ["pdftoppm", "-jpeg", "-r", str(dpi), pdf_path, prefix]
    subprocess.run(cmd, check=True)
    files = sorted(f for f in os.listdir(out_dir) if f.startswith("slide-") and f.endswith(".jpg"))
    return [os.path.join(out_dir, f) for f in files]


def make_grid(images: list[str], out_path: str, cols: int = 3) -> None:
    try:
        from PIL import Image
    except ImportError:
        print("warning: Pillow not installed — skipping contact sheet (pip install Pillow)", file=sys.stderr)
        return
    if not images:
        return
    thumbs = [Image.open(p) for p in images]
    # Resize each to a max-width 480px for a manageable contact sheet.
    target_w = 480
    sized = []
    for img in thumbs:
        ratio = target_w / img.width
        sized.append(img.resize((target_w, int(img.height * ratio))))
    cell_w = max(img.width for img in sized)
    cell_h = max(img.height for img in sized)
    rows = (len(sized) + cols - 1) // cols
    sheet = Image.new("RGB", (cell_w * cols, cell_h * rows), "white")
    for i, img in enumerate(sized):
        x = (i % cols) * cell_w
        y = (i // cols) * cell_h
        sheet.paste(img, (x, y))
    sheet.save(out_path, "JPEG", quality=85)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="thumbnails.py")
    parser.add_argument("pptx", help=".pptx file to render")
    parser.add_argument("--out", help="output directory", default=None)
    parser.add_argument("--dpi", type=int, default=150)
    parser.add_argument("--no-grid", action="store_true", help="skip contact sheet")
    args = parser.parse_args(argv[1:])

    if not os.path.exists(args.pptx):
        print(f"file not found: {args.pptx}", file=sys.stderr)
        return 2

    base = os.path.splitext(os.path.basename(args.pptx))[0]
    out_dir = args.out or f"./pptx-thumbnails-{base}"
    os.makedirs(out_dir, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="anton-thumb-") as work:
        pdf_path = run_soffice_to_pdf(args.pptx, work)
        images = render_pages(pdf_path, out_dir, args.dpi)

    print(f"rendered {len(images)} slides to {out_dir}")
    for path in images:
        print(f"  {path}")

    if not args.no_grid and images:
        grid_path = os.path.join(out_dir, "contact-sheet.jpg")
        make_grid(images, grid_path)
        if os.path.exists(grid_path):
            print(f"contact sheet -> {grid_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
