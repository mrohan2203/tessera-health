"""Writes backend/seed/initial-state.json: the app's state right after a fresh demo boot (seed data plus
every module's initial state), so the server is seeded with exactly what the demo starts from.
Synthetic data only. Needs the app served on :8765 and Playwright for Python."""
import json, os
from playwright.sync_api import sync_playwright
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'backend', 'seed', 'initial-state.json')
with sync_playwright() as pw:
    b = pw.chromium.launch(); p = b.new_page()
    p.goto('http://localhost:8765/'); p.evaluate('localStorage.clear(); sessionStorage.clear()'); p.goto('http://localhost:8765/?fixture=1')
    p.wait_for_function('window.Tessera && Tessera.S')
    s = p.evaluate("(() => { const S = JSON.parse(JSON.stringify(Tessera.S)); delete S.audit; delete S.btg; delete S.seq; return { state: S, unitGroups: Tessera.SEED.unitGroups, er: Tessera.SEED.er, ot: Tessera.SEED.ot }; })()")
    b.close()
json.dump(s, open(OUT, 'w'), indent=0, sort_keys=True)
print('wrote', OUT, len(s['state']), 'collections')
