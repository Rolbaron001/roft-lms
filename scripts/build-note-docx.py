#!/usr/bin/env python3
"""Turn one of this project's markdown notes into a Word document.

    python scripts/build-note-docx.py FOR-HEIDI-process-flow-and-costing.md
    python scripts/build-note-docx.py <note.md> --out "../../Design/Server/Note.docx"

Curiosa circulate these to the QCTO and to their own clients, so the markdown
in the repository is the working copy and the Word file is what leaves the
building. Writing the Word file by hand meant the two drifted, which is how a
job sheet came to disagree with itself.

House style follows the ROFT documents already issued and
scripts/build-dictionary-docx.py: Montserrat headings on navy, Inter body,
gold accent.

It handles the subset of markdown these notes actually use: headings,
paragraphs, bullet lists, tables, block quotes, fenced code, horizontal rules,
markdown hard breaks, and inline bold, italic and code. Anything else is
written through as plain text rather than silently dropped.
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

NAVY = "0D1E32"
GOLD = "B9975B"
INK = "1A1A1A"
PAPER = "F4F1EA"

HEADING_FONT = "Montserrat"
BODY_FONT = "Inter"
MONO_FONT = "Consolas"

# How a hard break travels from the markdown reader to the renderer.
#
# Markdown writes one as two trailing spaces, which a naive join would throw
# away along with the four-line "For / From / Date" block at the head of every
# one of these notes. A vertical tab is used because it cannot occur in the
# source: the reader substitutes it, and write_inline is the only thing that
# understands it.
BREAK = ""


# ---------------------------------------------------------------- docx helpers

def shade(cell, hex_colour: str) -> None:
    """Fill a table cell. python-docx has no API for this."""
    element = OxmlElement("w:shd")
    element.set(qn("w:val"), "clear")
    element.set(qn("w:fill"), hex_colour)
    cell._tc.get_or_add_tcPr().append(element)


def rule(paragraph, edge: str = "bottom", colour: str = GOLD, size: int = 6) -> None:
    """A horizontal line on one edge of a paragraph."""
    borders = OxmlElement("w:pBdr")
    element = OxmlElement(f"w:{edge}")
    element.set(qn("w:val"), "single")
    element.set(qn("w:sz"), str(size))
    element.set(qn("w:space"), "8")
    element.set(qn("w:color"), colour)
    borders.append(element)
    paragraph._p.get_or_add_pPr().append(borders)


INLINE = re.compile(r"(\*\*.+?\*\*|`[^`]+`|\*[^*]+\*|" + BREAK + r")", re.S)


def write_inline(paragraph, text: str, *, size: float = 10, colour: str = INK,
                 bold: bool = False) -> None:
    """Add text to a paragraph, honouring **bold**, *italic*, `code` and breaks."""
    for piece in INLINE.split(text):
        if not piece:
            continue

        if piece == BREAK:
            paragraph.add_run().add_break()
            continue

        run = paragraph.add_run()
        run.font.size = Pt(size)
        run.font.color.rgb = RGBColor.from_string(colour)
        run.bold = bold

        if piece.startswith("**") and piece.endswith("**") and len(piece) > 4:
            run.text = piece[2:-2]
            run.bold = True
            run.font.name = BODY_FONT
        elif piece.startswith("`") and piece.endswith("`") and len(piece) > 2:
            run.text = piece[1:-1]
            run.font.name = MONO_FONT
            run.font.size = Pt(size - 1)
        elif piece.startswith("*") and piece.endswith("*") and len(piece) > 2:
            run.text = piece[1:-1]
            run.italic = True
            run.font.name = BODY_FONT
        else:
            run.text = piece
            run.font.name = BODY_FONT


# -------------------------------------------------------------- markdown model

def split_row(line: str) -> list[str]:
    return [cell.strip() for cell in line.strip().strip("|").split("|")]


def is_divider(line: str) -> bool:
    return bool(re.fullmatch(r"\|?[\s:|-]+\|?", line.strip())) and "-" in line


def ends_paragraph(line: str) -> bool:
    """Whether this line starts a different block and so closes a paragraph."""
    return bool(re.match(r"(#{1,4}\s|[-*]\s|\d+\.\s|\||>|```|-{3,}$)", line.strip()))


def with_break(line: str) -> str:
    """The line's text, carrying a hard break if markdown asked for one."""
    return line.strip() + (BREAK if line.endswith("  ") else "")


def blocks(lines: list[str]):
    """Walk the markdown once, yielding (kind, payload)."""
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        if not stripped:
            i += 1
            continue

        if stripped.startswith("```"):
            body = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith("```"):
                body.append(lines[i])
                i += 1
            i += 1
            yield "code", body
            continue

        if re.fullmatch(r"-{3,}|\*{3,}|_{3,}", stripped):
            yield "rule", None
            i += 1
            continue

        heading = re.match(r"(#{1,4})\s+(.*)", stripped)
        if heading:
            yield f"h{len(heading.group(1))}", heading.group(2)
            i += 1
            continue

        # A table: a pipe row followed by a divider row.
        if stripped.startswith("|") and i + 1 < len(lines) and is_divider(lines[i + 1]):
            header = split_row(stripped)
            i += 2
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                rows.append(split_row(lines[i].strip()))
                i += 1
            yield "table", (header, rows)
            continue

        if stripped.startswith(">"):
            body = []
            while i < len(lines) and lines[i].strip().startswith(">"):
                body.append(lines[i].strip().lstrip(">").strip())
                i += 1
            yield "quote", " ".join(body)
            continue

        bullet = re.match(r"[-*]\s+(.*)", stripped)
        if bullet:
            body = [bullet.group(1)]
            i += 1
            # Continuation lines are indented under the bullet.
            while i < len(lines) and lines[i].startswith("  ") and lines[i].strip() \
                    and not re.match(r"[-*]\s+", lines[i].strip()):
                body.append(lines[i].strip())
                i += 1
            yield "bullet", " ".join(body)
            continue

        numbered = re.match(r"(\d+)\.\s+(.*)", stripped)
        if numbered:
            body = [numbered.group(2)]
            i += 1
            while i < len(lines) and lines[i].startswith("  ") and lines[i].strip() \
                    and not re.match(r"(\d+\.|[-*])\s+", lines[i].strip()):
                body.append(lines[i].strip())
                i += 1
            yield "numbered", " ".join(body)
            continue

        # A paragraph runs until a blank line or the start of another block.
        body = [with_break(line)]
        i += 1
        while i < len(lines) and lines[i].strip() and not ends_paragraph(lines[i]):
            body.append(with_break(lines[i]))
            i += 1
        # Joined with spaces, except where a hard break already ended a line.
        yield "paragraph", " ".join(body).replace(BREAK + " ", BREAK)


# ------------------------------------------------------------------- rendering

def build(markdown: str, out: Path) -> None:
    document = Document()

    normal = document.styles["Normal"]
    normal.font.name = BODY_FONT
    normal.font.size = Pt(10)
    normal.font.color.rgb = RGBColor.from_string(INK)

    for section in document.sections:
        section.top_margin = Cm(2.2)
        section.bottom_margin = Cm(2.2)
        section.left_margin = Cm(2.4)
        section.right_margin = Cm(2.4)

    lines = markdown.replace("\r\n", "\n").split("\n")
    first_heading = True

    for kind, payload in blocks(lines):
        if kind == "h1":
            paragraph = document.add_paragraph()
            paragraph.paragraph_format.space_after = Pt(4)
            write_inline(paragraph, payload, size=22, colour=NAVY, bold=True)
            for run in paragraph.runs:
                run.font.name = HEADING_FONT
            rule(paragraph, colour=GOLD, size=12)

        elif kind in ("h2", "h3", "h4"):
            size = {"h2": 14, "h3": 11.5, "h4": 10.5}[kind]
            paragraph = document.add_paragraph()
            paragraph.paragraph_format.space_before = Pt(14 if kind == "h2" else 10)
            paragraph.paragraph_format.space_after = Pt(3)
            write_inline(paragraph, payload, size=size, colour=NAVY, bold=True)
            for run in paragraph.runs:
                run.font.name = HEADING_FONT
            if kind == "h2" and not first_heading:
                rule(paragraph, colour=GOLD, size=4)
            first_heading = False

        elif kind == "paragraph":
            paragraph = document.add_paragraph()
            paragraph.paragraph_format.space_after = Pt(7)
            write_inline(paragraph, payload)

        elif kind == "bullet":
            paragraph = document.add_paragraph(style="List Bullet")
            paragraph.paragraph_format.space_after = Pt(3)
            write_inline(paragraph, payload)

        elif kind == "numbered":
            paragraph = document.add_paragraph(style="List Number")
            paragraph.paragraph_format.space_after = Pt(3)
            write_inline(paragraph, payload)

        elif kind == "quote":
            paragraph = document.add_paragraph()
            paragraph.paragraph_format.left_indent = Cm(0.6)
            paragraph.paragraph_format.space_before = Pt(6)
            paragraph.paragraph_format.space_after = Pt(9)
            write_inline(paragraph, payload, size=11, colour=NAVY)
            rule(paragraph, edge="left", colour=GOLD, size=18)

        elif kind == "code":
            paragraph = document.add_paragraph()
            paragraph.paragraph_format.space_after = Pt(9)
            for index, line in enumerate(payload):
                run = paragraph.add_run(line)
                run.font.name = MONO_FONT
                run.font.size = Pt(9)
                run.font.color.rgb = RGBColor.from_string(NAVY)
                if index < len(payload) - 1:
                    run.add_break()

        elif kind == "rule":
            paragraph = document.add_paragraph()
            paragraph.paragraph_format.space_after = Pt(2)
            rule(paragraph, colour=GOLD, size=4)

        elif kind == "table":
            header, rows = payload
            table = document.add_table(rows=1, cols=len(header))
            table.style = "Table Grid"
            table.alignment = WD_TABLE_ALIGNMENT.CENTER

            for cell, text in zip(table.rows[0].cells, header):
                shade(cell, NAVY)
                paragraph = cell.paragraphs[0]
                paragraph.paragraph_format.space_after = Pt(2)
                # The header sits on navy, so it is written white rather than ink.
                write_inline(paragraph, text.replace("**", ""), size=9,
                             colour="FFFFFF", bold=True)
                for run in paragraph.runs:
                    run.font.name = HEADING_FONT

            for index, row in enumerate(rows):
                cells = table.add_row().cells
                for cell, text in zip(cells, row):
                    if index % 2 == 1:
                        shade(cell, PAPER)
                    paragraph = cell.paragraphs[0]
                    paragraph.paragraph_format.space_after = Pt(2)
                    paragraph.alignment = WD_ALIGN_PARAGRAPH.LEFT
                    write_inline(paragraph, text, size=9)

            document.add_paragraph().paragraph_format.space_after = Pt(4)

    out.parent.mkdir(parents=True, exist_ok=True)
    document.save(out)
    print(f"  {out}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="the markdown note")
    parser.add_argument("--out", type=Path, default=None,
                        help="where the Word file goes (default: beside the note)")
    args = parser.parse_args()

    source: Path = args.source
    if not source.exists():
        raise SystemExit(f"  {source} is not there.")

    build(source.read_text(encoding="utf-8"), args.out or source.with_suffix(".docx"))


if __name__ == "__main__":
    main()
