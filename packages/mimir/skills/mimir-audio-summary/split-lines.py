"""Print one sentence per line from a text file.

Used to render long narrations sentence-by-sentence when an engine benefits from segmentation.
"""
import re
import sys

raw = open(sys.argv[1], encoding="utf-8").read()
text = re.sub(r"\s+", " ", raw).strip()
for part in re.split(r"(?<=[.!?…])\s+", text):
    part = part.strip()
    if part:
        print(part)
