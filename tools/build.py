#!/usr/bin/env python3
"""Build one self-contained HTML page from a map.

    build.py examples/starter/map.js -o out/starter.html

The page opens offline and publishes as a claude.ai artifact unchanged.
"""

import argparse
import pathlib
import re
import sys

ENGINE = pathlib.Path(__file__).resolve().parent.parent / "engine"


def main():
    args = parse_args()
    content = args.map.read_text()
    page = (ENGINE / "shell.html").read_text()
    for placeholder, text in (("/*CSS*/", read("engine.css")), ("/*MODEL*/", read("model.js")),
                              ("/*VIEW*/", read("view.js")), ("/*MAP*/", content)):
        page = page.replace(placeholder, text)
    page = page.replace("__TITLE__", title_of(content))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(page)
    print(f"wrote {args.out} ({len(page) // 1024} KB)")
    return 0


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("map", type=pathlib.Path)
    p.add_argument("-o", "--out", type=pathlib.Path, required=True)
    return p.parse_args()


def read(name):
    return (ENGINE / name).read_text()


def title_of(content):
    """The <title> has to be in the static page, so it is read from the source."""
    found = re.search(r'^\s*title:\s*"([^"]+)"', content, re.MULTILINE)
    return found.group(1) if found else sys.exit('map needs a top-level  title: "..."  line')


if __name__ == "__main__":
    sys.exit(main())
