#!/usr/bin/env python3
"""Screenshot the overview and every detail of a built page, and put them on
contact sheets — one look at every level, without clicking through.

    sheet.py examples/starter/map.js out/starter.html -o out/sheets

Needs chromium and Pillow. Screenshots show the layout, not the animation:
headless chromium does not advance it.
"""

import argparse
import pathlib
import subprocess
import sys

from PIL import Image

TOOLS = pathlib.Path(__file__).resolve().parent
VIEWPORT = (1700, 1100)
CROP = (80, 280, 1620, 820)
TILE = (770, 270)
PER_SHEET = 8


def main():
    args = parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    keys = detail_keys(args.map)
    shoot(args.page, "", args.out / "overview.png")
    for key in keys:
        shoot(args.page, key, args.out / f"{key}.png")
    sheets = [compose(args.out, keys[i:i + PER_SHEET], i // PER_SHEET) for i in range(0, len(keys), PER_SHEET)]
    print(f"overview: {args.out / 'overview.png'}")
    for sheet in sheets:
        print(f"sheet:    {sheet}")
    return 0


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("map", type=pathlib.Path)
    p.add_argument("page", type=pathlib.Path)
    p.add_argument("-o", "--out", type=pathlib.Path, required=True)
    return p.parse_args()


def detail_keys(map_file):
    done = subprocess.run(["node", str(TOOLS / "check.mjs"), str(map_file), "--keys"],
                          capture_output=True, text=True, check=True)
    return done.stdout.split()


def shoot(page, key, png):
    url = page.resolve().as_uri() + (f"#{key}" if key else "")
    subprocess.run(["chromium", "--headless", "--disable-gpu", "--no-sandbox",
                    f"--window-size={VIEWPORT[0]},{VIEWPORT[1]}", "--virtual-time-budget=1500",
                    f"--screenshot={png}", url],
                   capture_output=True, timeout=60, check=True)


def compose(folder, keys, index):
    sheet = Image.new("RGB", (TILE[0] * 2, TILE[1] * ((len(keys) + 1) // 2)), "white")
    for i, key in enumerate(keys):
        tile = Image.open(folder / f"{key}.png").crop(CROP).resize(TILE)
        sheet.paste(tile, ((i % 2) * TILE[0], (i // 2) * TILE[1]))
    out = folder / f"sheet-{index + 1}.png"
    sheet.save(out)
    return out


if __name__ == "__main__":
    sys.exit(main())
