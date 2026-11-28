"""Run the 73 demo workflows in live mode against the local API, collecting every write the server refuses."""
import os
BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # backend/
# Needs: the API (npm run dev), the app served on :8765, a seeded database, and Playwright for Python.
import sys, json, time, hmac, hashlib, base64, struct, subprocess
from playwright.sync_api import sync_playwright
subprocess.run(['npm', 'run', '-s', 'seed'], cwd=BACKEND, check=True, capture_output=True)
CREDS = json.load(open(os.path.join(BACKEND, '.dev-credentials.json')))
def totp(secret):
    key = base64.b32decode(secret + '=' * (-len(secret) % 8)); c = struct.pack('>Q', int(time.time()) // 30)
    h = hmac.new(key, c, hashlib.sha1).digest(); o = h[-1] & 15
    return str((struct.unpack('>I', h[o:o+4])[0] & 0x7fffffff) % 1000000).zfill(6)
# Workflows that cannot pass in live mode yet, and why. Anything else failing is a regression.
DEMO_ONLY = ['Password sign-in with MFA', 'Wrong password is rejected', 'Suspended account is blocked',  # demo sign-in screen; live sign-in is covered by live_test.py
             'Data layer: demo adapter', 'Break-the-glass reviewed in audit log',  # demo storage and demo audit list; live equivalents in live_test.py
             'Care plan: accept suggestions']  # the test rewrites a result's history locally, which the server correctly refuses
PHASE_4 = ['Role change needs a second', 'Portal refill', 'ER: triage', 'Discharge: insurance', 'Lab: normal autoverifies', 'Radiology: contrast', 'Blood: crossmatch',
           'Registration catches', 'Double booking', 'Check-in starts', 'Social-needs safety', 'Claims: eligibility', 'Good faith estimate', 'Care gaps de-identified',
           'NHSN reporting', 'Privacy Sentinel', 'Config: duplicate check', 'Platform support access']  # modules whose state is not on the API yet
EXPECTED = DEMO_ONLY + PHASE_4
with sync_playwright() as pw:
    b = pw.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
    p = b.new_page(viewport={"width": 1440, "height": 900}); errs = []
    p.on("pageerror", lambda e: errs.append(str(e)[:200] + " @ " + (e.stack or "")[:300]))
    p.expose_function('__creds', lambda u: {'password': CREDS[u]['password'], 'code': totp(CREDS[u]['totpSecret'])})
    p.goto('http://localhost:8765/?mode=live&api=http://localhost:8787'); p.wait_for_selector('form[data-form="live-pw"]')
    p.evaluate("""window.__refusals = []; new MutationObserver(() => { const t = document.querySelector('#toast').textContent; if (/^Not saved/.test(t)) window.__refusals.push((window.__cur || '') + ' :: ' + t); }).observe(document.querySelector('#toast'), { childList: true, characterData: true, subtree: true });""")
    r = p.evaluate("import('/tests/usecases.js?' + Date.now()).then(async m => { const r = await m.run(); await Tessera.liveIdle(); await new Promise(x => setTimeout(x, 1500)); return r; })")
    unexpected = [f for f in r['failed'] if not any(f.startswith(x) for x in EXPECTED)]
    print(json.dumps({'total': r['total'], 'passed': r['passed'], 'expected_failures': len(r['failed']) - len(unexpected), 'unexpected': len(unexpected)}))
    for f in unexpected: print("FAIL", f[:230])
    print('REFUSALS', len(p.evaluate('window.__refusals')))
    for x in sorted(set(p.evaluate('window.__refusals'))): print('  ', x[:230])
    errs = [e for e in errs if 'Failed to load resource' not in e]  # refused requests are part of the tests
    print('pageerrors', errs[:6]); b.close()
    sys.exit(1 if unexpected or errs else 0)
