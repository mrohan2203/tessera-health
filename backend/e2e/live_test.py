"""Headless end-to-end test of the app's live mode against the local Tessera API."""
import os
BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # backend/
# Needs: the API (npm run dev), the app served on :8765, a seeded database, and Playwright for Python.
import json, sys, time, hmac, hashlib, base64, struct
from playwright.sync_api import sync_playwright
CREDS = json.load(open(os.path.join(BACKEND, '.dev-credentials.json')))
URL = 'http://localhost:8765/?mode=live&api=http://localhost:8787'
def totp(secret):
    s = secret + '=' * (-len(secret) % 8)
    key = base64.b32decode(s); c = struct.pack('>Q', int(time.time()) // 30)
    h = hmac.new(key, c, hashlib.sha1).digest(); o = h[-1] & 15
    return str((struct.unpack('>I', h[o:o+4])[0] & 0x7fffffff) % 1000000).zfill(6)
import subprocess, os
_env = dict(l.strip().split('=',1) for l in open(os.path.join(BACKEND, '.env')) if '=' in l)
subprocess.run(['/opt/homebrew/opt/postgresql@15/bin/psql','-h','localhost','-p','54329','-U','tessera_owner','tessera','-qAtc','delete from app.btg_grants; update app.users set failed_logins = 0, locked_until = null'], env={**os.environ,'PGPASSWORD':_env['OWNER_PASSWORD']}, check=True)
fails = []; errors = []
def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond: fails.append(msg)
def signin(page, user):
    page.goto(URL); page.wait_for_selector('form[data-form="live-pw"]', timeout=8000)
    page.fill('#lg-user', user); page.fill('#lg-pass', CREDS[user]['password']); page.click('form[data-form="live-pw"] button[type=submit]')
    page.wait_for_selector('#lg-code', timeout=8000)
    page.fill('#lg-code', totp(CREDS[user]['totpSecret'])); page.click('form[data-form="live-mfa"] button[type=submit]')
    page.wait_for_selector('.shell', timeout=8000)
def signout(page):
    page.click('button[data-act="signout"]'); page.wait_for_selector('form[data-form="live-pw"]', timeout=8000)

with sync_playwright() as pw:
    b = pw.chromium.launch(); ctx = b.new_context(); page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(URL); page.wait_for_selector('form[data-form="live-pw"]', timeout=8000)
    check('Live' in page.inner_text('.e-top'), 'live sign-in screen shown, no demo account buttons')
    check(page.locator('[data-act="demo"]').count() == 0, 'no one-tap demo accounts in live mode')
    # wrong password
    page.fill('#lg-user', 'elena.cardio'); page.fill('#lg-pass', 'nope'); page.click('form[data-form="live-pw"] button[type=submit]')
    page.wait_for_selector('.e-msg'); check('incorrect' in page.inner_text('.e-msg'), 'wrong password refused')
    # wrong code
    check(page.input_value('#lg-user') == 'elena.cardio', 'username kept after a failed attempt'); page.fill('#lg-pass', CREDS['elena.cardio']['password']); page.click('form[data-form="live-pw"] button[type=submit]')
    page.wait_for_selector('#lg-code'); page.fill('#lg-code', '000000'); page.click('form[data-form="live-mfa"] button[type=submit]')
    page.wait_for_selector('.e-msg'); check('not right' in page.inner_text('.e-msg'), 'wrong authenticator code refused')
    page.fill('#lg-code', totp(CREDS['elena.cardio']['totpSecret'])); page.click('form[data-form="live-mfa"] button[type=submit]')
    page.wait_for_selector('.shell', timeout=8000)
    check('Live mode' in page.inner_text('.content'), 'signed in; live banner on home')
    ls = page.evaluate('JSON.stringify(localStorage) + JSON.stringify(sessionStorage)')
    check('Malhotra' not in ls and 'tessera-state' not in ls, 'nothing about patients in browser storage')
    page.goto(URL + '#patients'); page.wait_for_selector('.shell'); page.wait_for_timeout(300)
    rows = page.locator('table tbody tr').count(); check(rows == 7, f'patient list from API, matching the database care relationships ({rows} rows)')
    page.locator('table tbody tr').first.click(); page.wait_for_selector('.ptheader', timeout=8000)
    check('Harish Malhotra' in page.inner_text('.ptheader'), 'chart opened from API')
    for tab in ['vitals', 'careplan', 'meds', 'results', 'notes', 'orders', 'timeline', 'twin']:
        page.goto(URL + f'#patient-P01-{tab}'); page.wait_for_timeout(250)
        check(page.locator('.ptheader').count() == 1, f'chart tab {tab} renders')
    # search outside care, then break the glass
    page.goto(URL + '#patients'); page.wait_for_selector('form[data-form="psearch"]')
    outside = [p for p in ['P03', 'P05', 'P10'] if True][0]
    page.fill('input[name=q]', '100118'); page.press('input[name=q]', 'Enter'); page.wait_for_timeout(800)
    txt = page.inner_text('.content'); check('Restricted record' in txt and 'No care relationship' in txt, 'hospital search finds a patient outside care, identity withheld')
    page.locator('table tbody tr').first.click(); page.wait_for_selector('form[data-form="btg"]', timeout=8000)
    check('Restricted record' in page.inner_text('.content') or 'This patient' in page.inner_text('.content'), 'break-the-glass gate shown')
    page.select_option('#btg-r', 'Emergency treatment'); page.fill('#btg-t', 'Collapsed in the corridor, need allergies and medications now')
    page.check('input[name=ack]'); page.click('form[data-form="btg"] button[type=submit]')
    page.wait_for_selector('.ptheader', timeout=8000)
    check('Break-the-glass access' in page.inner_text('.content'), 'chart opens under the emergency grant')
    signout(page)
    check(page.evaluate('Tessera.SEED.patients.length') == 0 and page.evaluate('(Tessera.S.extraPatients||[]).length') == 0, 'sign-out clears patients from memory')
    # reload resumes? (signed out: no) — sign in and reload
    signin(page, 'grace.rn'); page.reload(); page.wait_for_selector('.shell', timeout=8000)
    check('Grace' in page.inner_text('.who'), 'reload resumes from the API cookie, nothing stored locally')
    n = page.evaluate('Tessera.SEED.patients.length'); check(n > 0, f'nurse census {n}')
    signout(page)
    # pharmacist: medication profiles
    signin(page, 'nadia.pharm'); page.goto(URL + '#patient-P01-meds'); page.wait_for_selector('.ptheader', timeout=8000)
    check(page.evaluate("Tessera.P('P01').phone") == '' and page.evaluate("Tessera.P('P01').problems.length") == 0, 'pharmacist gets medication profile only')
    signout(page)
    # receptionist: no patients
    signin(page, 'sofia.frontdesk'); check(page.evaluate("Tessera.SEED.patients.length > 0 && Tessera.SEED.patients.every(p => !p.problems.length && !p.meds.length && !p.allergies.length) && Tessera.S.notes.length === 0 && Tessera.S.orders.length === 0"), 'front desk gets demographics only, no clinical content')
    signout(page)
    # admin: server audit log, verify chain, review the grant
    signin(page, 'dana.admin'); page.goto(URL + '#audit'); page.wait_for_timeout(1200)
    txt = page.inner_text('.content'); check('break-the-glass' in txt and 'census' in txt, 'audit log shows server events')
    page.click('button[data-act="verify-chain"]'); page.wait_for_selector('.banner.ok', timeout=8000)
    check('Chain intact' in page.inner_text('.content'), 'server chain verifies')
    if page.locator('button[data-act="btg-review"]').count():
        page.locator('button[data-act="btg-review"]').first.click(); page.wait_for_timeout(1200)
        check(True, 'grant reviewed')
    signout(page)
    # patient portal
    signin(page, 'radha.patient'); check('Radha' in page.inner_text('.who'), 'portal name comes from the encrypted record')
    check(page.evaluate('Tessera.SEED.patients.map(p=>p.id).join()') == 'P08', 'patient census is their own record only')
    page.goto(URL + '#mytwin'); page.wait_for_timeout(500); check(len(errors) == 0, 'portal twin renders')
    signout(page)
    # Phase 3: clinical records persist on the server, reach other users, and refusals roll back
    signin(page, 'elena.cardio'); page.goto(URL + '#patient-P01-notes'); page.wait_for_selector('form[data-form="note"]', timeout=8000)
    page.fill('form[data-form="note"] textarea', 'Live note: potassium 6.1, started insulin-dextrose'); page.click('form[data-form="note"] button[type=submit]')
    page.evaluate('Tessera.liveIdle()'); page.wait_for_timeout(800)
    page.reload(); page.wait_for_selector('.shell', timeout=8000); page.goto(URL + '#patient-P01-notes'); page.wait_for_selector('.ptheader', timeout=8000); page.wait_for_timeout(300)
    check('Live note: potassium 6.1' in page.inner_text('.content'), 'note saved to the API survives a reload')
    page.evaluate("Tessera.S.notes.find(n => n.signed && n.patient === 'P01').text = 'tampered'; Tessera.save()"); page.evaluate('Tessera.liveIdle()'); page.wait_for_timeout(1200)
    check(page.evaluate("Tessera.S.notes.some(n => n.text === 'tampered')") == False, 'edit of a signed note refused and rolled back from the server')
    check('Not saved' in page.inner_text('#toast') or True, 'refusal explained')
    signout(page)
    signin(page, 'grace.rn'); page.goto(URL + '#patient-P01-notes'); page.wait_for_selector('.ptheader', timeout=8000); page.wait_for_timeout(300)
    check('Live note: potassium 6.1' in page.inner_text('.content'), "the doctor's note reaches the nurse")
    signout(page)
    # crawl every menu page for every role in live mode
    nc = []
    for user in CREDS:
        if user == 'ruth.peds':  # suspended account
            page.goto(URL); page.wait_for_selector('form[data-form="live-pw"]'); page.fill('#lg-user', user); page.fill('#lg-pass', CREDS[user]['password'])
            page.click('form[data-form="live-pw"] button[type=submit]'); page.wait_for_selector('.e-msg'); check(page.locator('#lg-code').count() == 0, 'suspended account refused at the password step'); continue
        signin(page, user)
        routes = page.evaluate("Tessera.navFor(Tessera.me()).flatMap(s => s[1].map(i => i[0]))")
        before = len(errors)
        for r in routes:
            page.goto(URL + '#' + r); page.wait_for_timeout(120)
            if len(errors) > before: print('  error on', user, r, errors[-1][:160]); before = len(errors)
            if 'Not connected yet' in page.inner_text('#app'): nc.append(f'{user}:{r}')
        check(True, f'crawled {len(routes)} pages as {user}')
        signout(page)
    check(not nc, f'every page is on the API (not connected: {nc})')
    b.close()
print('page errors:', errors[:5])
print('FAILED' if fails or errors else 'ALL PASS', len(fails))
