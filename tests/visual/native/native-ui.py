#!/usr/bin/env python3
"""Small AT-SPI command helper for deterministic native Pinta captures."""

from __future__ import annotations

import argparse
import time

import pyatspi


def applications():
    desktop = pyatspi.Registry.getDesktop(0)
    return [application for application in desktop if (application.name or "").lower() in {"pinta", "dotnet"}]


def descendants(node):
    yield node
    try:
        for child in node:
            yield from descendants(child)
    except Exception:
        return


def matches(node, name: str, role: str | None, exact: bool):
    try:
        candidate_name = node.name or ""
        candidate_role = node.getRoleName()
    except Exception:
        return False
    if role and candidate_role != role:
        return False
    return candidate_name == name if exact else name.casefold() in candidate_name.casefold()


def find_nodes(name: str, role: str | None, exact: bool, timeout: float):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        found = [node for application in applications() for node in descendants(application) if matches(node, name, role, exact)]
        if found:
            return found
        time.sleep(0.15)
    return []


def click(node):
    actions = node.queryAction()
    for index in range(actions.nActions):
        if actions.getName(index).casefold() in {"click", "press", "activate"}:
            return actions.doAction(index)
    if actions.nActions:
        return actions.doAction(0)
    raise RuntimeError(f"{node.getRoleName()} {node.name!r} exposes no accessible actions")


def role_of(node):
    try:
        return node.getRoleName()
    except Exception:
        return ""


def direct_menu_items(menu):
    items = []

    def visit(node):
        for child in node:
            role = role_of(child)
            if role == "menu":
                continue
            if role == "menu item":
                items.append(child)
                continue
            visit(child)

    visit(menu)
    return items


def nested_menu(item, timeout):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        menus = [node for node in descendants(item) if role_of(node) == "menu"]
        if menus:
            return menus[0]
        time.sleep(0.1)
    return None


def activate_menu_path(path, timeout):
    deadline = time.monotonic() + timeout
    root_menu = None
    while time.monotonic() < deadline and root_menu is None:
        menus = [node for application in applications() for node in descendants(application) if role_of(node) == "menu"]
        if menus:
            root_menu = menus[0]
        else:
            time.sleep(0.1)
    if root_menu is None:
        raise RuntimeError("No accessible menu is open")

    menu = root_menu
    selected = None
    for depth, index in enumerate(path):
        items = direct_menu_items(menu)
        if index >= len(items):
            raise RuntimeError(f"Menu path index {index} is out of range at depth {depth}; menu has {len(items)} items")
        selected = items[index]
        if not click(selected):
            raise RuntimeError(f"Menu action failed at depth {depth}, index {index}")
        if depth < len(path) - 1:
            menu = nested_menu(selected, max(0.2, deadline - time.monotonic()))
            if menu is None:
                raise RuntimeError(f"Menu path stopped before depth {depth + 1}")
    return selected


parser = argparse.ArgumentParser()
parser.add_argument("command", choices=["bounds", "click", "wait", "menu"])
parser.add_argument("name")
parser.add_argument("--role")
parser.add_argument("--contains", action="store_true")
parser.add_argument("--index", type=int, default=0)
parser.add_argument("--timeout", type=float, default=12)
arguments = parser.parse_args()

if arguments.command == "menu":
    path = [int(part) for part in arguments.name.split(",") if part != ""]
    if not path:
        raise SystemExit("A comma-separated menu path is required")
    try:
        selected = activate_menu_path(path, arguments.timeout)
    except RuntimeError as error:
        raise SystemExit(str(error)) from error
    print(f"menu item: {selected.name!r} at {path}")
    raise SystemExit(0)

nodes = find_nodes(arguments.name, arguments.role, not arguments.contains, arguments.timeout)
if len(nodes) <= arguments.index:
    available = sorted({(node.getRoleName(), node.name or "") for application in applications() for node in descendants(application) if node.name})
    raise SystemExit(
        f"Accessible node not found: name={arguments.name!r}, role={arguments.role!r}, index={arguments.index}. "
        f"Named nodes: {available}"
    )

target = nodes[arguments.index]
if arguments.command == "bounds":
    extents = target.queryComponent().getExtents(pyatspi.DESKTOP_COORDS)
    print(f"{extents.x} {extents.y} {extents.width} {extents.height}")
    raise SystemExit(0)
if arguments.command == "click":
    if not click(target):
        raise SystemExit(f"Accessible action failed: {target.getRoleName()} {target.name!r}")
print(f"{target.getRoleName()}: {target.name!r}")
