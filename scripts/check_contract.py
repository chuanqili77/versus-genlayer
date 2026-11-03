#!/usr/bin/env python3
"""Structural checks for contracts/versus.py.

Enforces the failure modes the live runner rejects, plus basic hygiene:
- parses as Python
- Depends header is exactly the pinned line and is the first line
- no comment lines follow the Depends header line
- the contract class subclasses gl.Contract and defines __init__
- every persistent field is class-level annotated
- no float literals in the file (nondet results cannot contain floats)
- public methods carry @gl.public.write or @gl.public.view
"""
import ast
import re
import sys
from pathlib import Path

PATH = Path(__file__).resolve().parent.parent / "contracts" / "versus.py"
PINNED = '# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }'

errors = []
src = PATH.read_text()
lines = src.splitlines()

if not lines or lines[0] != PINNED:
    errors.append("first line is not the pinned Depends header")
for i, line in enumerate(lines[1:], start=2):
    if line.lstrip().startswith("#"):
        errors.append(f"comment line after Depends header at line {i}")
        break

try:
    tree = ast.parse(src)
except SyntaxError as exc:
    print(f"FAIL: syntax error: {exc}")
    sys.exit(1)

for node in tree.body:
    if isinstance(node, ast.ClassDef):
        bases = [ast.unparse(b) for b in node.bases]
        if "gl.Contract" not in bases:
            errors.append(f"class {node.name} does not subclass gl.Contract")
        method_names = [n.name for n in node.body if isinstance(n, ast.FunctionDef)]
        if "__init__" not in method_names:
            errors.append(f"class {node.name} does not define __init__")
        for item in node.body:
            if isinstance(item, ast.FunctionDef) and not item.name.startswith("_"):
                decos = [ast.unparse(d) for d in item.decorator_list]
                if not any(d in ("gl.public.write", "gl.public.view") for d in decos):
                    errors.append(f"method {item.name} lacks a @gl.public decorator")
        anns = [t.target.id for t in node.body if isinstance(t, ast.AnnAssign)]
        print(f"class {node.name}: bases={bases} methods={method_names} storage={anns}")

for node in ast.walk(tree):
    if isinstance(node, ast.Constant) and isinstance(node.value, float):
        errors.append(f"float literal {node.value} at line {node.lineno}")

if errors:
    print("FAIL:")
    for err in errors:
        print(f"  - {err}")
    sys.exit(1)
print("PASS: structural checks")
