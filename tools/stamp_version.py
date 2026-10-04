#!/usr/bin/env python3
"""Publish stamp: SHOGI_VERSION_LABEL / SHOGI_BUILD_TIME (Asia/Tokyo), ?v= cache-bust,
the auto-update PAGE_LABEL in the pages, and version.json (polled by the pages to auto-reload at a safe moment)."""
import re, time, pathlib, datetime, sys
ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
import autoupdate as au
ms = int(time.time() * 1000)
jst = datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone(datetime.timedelta(hours=9)))
v = jst.strftime('%Y%m%d%H%M%S'); label = jst.strftime('%Y-%m-%d %H:%M:%S')
g = ROOT / 'game/index.html'; t = g.read_text()
t = re.sub(r'SHOGI_VERSION_LABEL = "[^"]*"', f'SHOGI_VERSION_LABEL = "{label}"', t)
t = re.sub(r'SHOGI_BUILD_TIME = \d+', f'SHOGI_BUILD_TIME = {ms}', t)
g.write_text(t)
for p in [ROOT / 'index.html', ROOT / 'game/index.html']:
    s = p.read_text(); s2 = re.sub(r'\?v=\d{14}', f'?v={v}', s)
    if s2 != s: p.write_text(s2)
    au.set_label(p, label)
au.write_json(ROOT / 'version.json', label, ms)
print(ms, v, label)
