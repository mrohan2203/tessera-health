"""Run the workflows and the sweep with store tracing on; save the access map as JSON."""
import json, sys
from playwright.sync_api import sync_playwright
OUT = sys.argv[1]
with sync_playwright() as pw:
    b = pw.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
    p = b.new_page(viewport={"width": 1440, "height": 900}); errs = []; p.on("pageerror", lambda e: errs.append(str(e)))
    p.goto("http://localhost:8765/"); p.evaluate("localStorage.clear(); sessionStorage.clear()")
    p.goto("http://localhost:8765/?trace=1"); p.wait_for_timeout(1500)
    print("tracing", p.evaluate("TesseraStore.tracing"))
    r1 = p.evaluate("import('/tests/usecases.js?' + Date.now()).then(m => m.run())")
    r2 = p.evaluate("import('/tests/sweep.js?' + Date.now()).then(m => m.run())")
    amap = p.evaluate("TesseraStore.accessMap()")
    json.dump(amap, open(OUT, "w"), indent=1)
    print("usecases", json.dumps(r1)); print("sweep", json.dumps(r2)); print("collections", len(amap), "errors", errs[:3])
    b.close()
