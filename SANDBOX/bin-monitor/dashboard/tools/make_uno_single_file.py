#!/usr/bin/env python3
"""Joins the Uno program and its two headers into one .ino file, so it can be
pasted into ArduinoPath's Free Play (which takes one file) and uploaded.

  python3 tools/make_uno_single_file.py          # write it
  python3 tools/make_uno_single_file.py --check  # fail if it's out of date
"""
import pathlib, re, sys

here = pathlib.Path(__file__).resolve().parent.parent / "firmware"
src = here / "uno_bin_controller"
out = here / "uno_single_file" / "uno_single_file.ino"

def header(name):
    text = (src / name).read_text()
    text = re.sub(r"^#pragma once\n", "", text, flags=re.M)
    return f"// ----- {name} (joined in by tools/make_uno_single_file.py) -----\n{text.rstrip()}\n// ----- end of {name} -----\n"

ino = (src / "uno_bin_controller.ino").read_text()
joined = re.sub(r'^#include "([^"]+)"\n', lambda m: header(m.group(1)), ino, flags=re.M)
banner = ("// ONE-FILE VERSION of uno_bin_controller (made by tools/make_uno_single_file.py).\n"
          "// Paste it into ArduinoPath Free Play (board: Arduino Uno) and press Upload,\n"
          "// or open it in the Arduino IDE. Edit uno_bin_controller/, then re-run the tool.\n\n")
text = banner + joined

if "--check" in sys.argv:
    if not out.exists() or out.read_text() != text:
        sys.exit("uno_single_file.ino is out of date: run python3 tools/make_uno_single_file.py")
    print("uno_single_file.ino is up to date")
else:
    out.parent.mkdir(exist_ok=True)
    out.write_text(text)
    print(f"wrote {out} ({len(text)} bytes)")
