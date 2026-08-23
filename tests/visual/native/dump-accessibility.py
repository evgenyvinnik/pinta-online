#!/usr/bin/env python3
"""Print Pinta's AT-SPI tree while developing native capture scenarios."""

import pyatspi
import time


def walk(node, depth=0):
    try:
        role = node.getRoleName()
        name = node.name or ""
        print(f"{'  ' * depth}{role}: {name!r}")
        for child in node:
            walk(child, depth + 1)
    except Exception as error:  # AT-SPI nodes can disappear during a live dump.
        print(f"{'  ' * depth}<unavailable: {error}>")


desktop = pyatspi.Registry.getDesktop(0)
matches = []
for _ in range(50):
    matches = [application for application in desktop if (application.name or "").lower() in {"pinta", "dotnet"}]
    if matches:
        break
    time.sleep(0.2)
if not matches:
    available = [application.name or "<unnamed>" for application in desktop]
    raise SystemExit(f"Pinta was not present in the AT-SPI desktop tree. Applications: {available}")
for application in matches:
    walk(application)
