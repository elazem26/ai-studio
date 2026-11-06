#!/usr/bin/env python3
"""Fix-up pass 1) strip duplicated data/ after DATA_ROOT join
2) normalize added imports to @/ alias and merge with existing alias import."""
import re, pathlib

API = pathlib.Path("/home/z/my-project/src/app/api")
LIB_ALIAS = "@/lib/security/resolve-file-path"
ABS = "/home/z/my-project/src/lib/security/resolve-file-path"

changed = 0
for f in sorted(API.rglob("*.ts")):
    src = f.read_text()
    orig = src
    # 1) strip duplicated data/ prefix: path.join(DATA_ROOT, "data/results") -> path.join(DATA_ROOT, "results")
    src = re.sub(r'path\.join\(DATA_ROOT,\s*(")data/', r'path.join(DATA_ROOT, \1', src)
    # 2) remove absolute import line added by pass 1
    abs_line = f'import {{ dataRootSync as DATA_ROOT }} from "{ABS}";\n'
    had_abs = abs_line in src
    src = src.replace(abs_line, "")
    if had_abs:
        alias_re = re.compile(r'import\s*\{([^}]*)\}\s*from\s*["\']' + re.escape(LIB_ALIAS) + r'["\'];?')
        m = alias_re.search(src)
        if m and "DATA_ROOT" not in m.group(1):
            names = m.group(1).strip().rstrip(",")
            src = alias_re.sub(
                f'import {{ {names}, dataRootSync as DATA_ROOT }} from "{LIB_ALIAS}";',
                src, count=1)
        else:
            # no alias import exists -> add one as the first line
            src = f'import {{ dataRootSync as DATA_ROOT }} from "{LIB_ALIAS}";\n' + src
    if src != orig:
        f.write_text(src)
        changed += 1
        print("fixed:", str(f).replace("/home/z/my-project/", ""))
print("TOTAL:", changed)
