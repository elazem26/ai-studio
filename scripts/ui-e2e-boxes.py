#!/usr/bin/env python3
"""UI E2E: login → upload source + reference in studio → verify numbered boxes."""
import json, time
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
SRC = "/home/z/my-project/scripts/studio-multi-ref.png"
REF = "/home/z/my-project/scripts/face-multi-ref.png"

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    pg.goto(BASE + "/login", wait_until="networkidle")
    # login via system session button
    pg.get_by_text("تشغيل من النظام الحالي").click()
    pg.wait_for_url(BASE + "/", timeout=20000)
    time.sleep(3)
    inputs = pg.locator("input[type=file]")
    n = inputs.count()
    print("file inputs:", n)
    # Input map (verified): 0/1=source panel (replace/dropzone), 2/3/4=garment panel (replace/dropzone/multi-add)
    inputs.nth(0).set_input_files(SRC)
    time.sleep(6)
    inputs.nth(3).set_input_files(REF)
    time.sleep(8)
    body = pg.inner_text("body")
    print("--- status lines:")
    for line in body.splitlines():
        s = line.strip()
        if ("رُصد" in s) or ("الوضع" in s) or ("مربعات" in s) or ("رصد" in s and "المرجع" in s):
            print("  •", s[:100])
    # numbered box overlays (button role with title containing انقر للتعيين)
    boxes = pg.locator("[title*='انقر للتعيين']")
    print("numbered box overlays:", boxes.count())
    # screenshots for visual proof
    pg.screenshot(path="/tmp/ui-boxes.png", full_page=False)
    # garment editor tab card
    try:
        pg.get_by_role("button", name="تعديل الملابس").click()
        time.sleep(4)
        b2 = pg.inner_text("body")
        print("garment-editor card present:", "تبديل الملابس من صورة المرجع" in b2)
        pg.screenshot(path="/tmp/ui-garment-card.png", full_page=False)
    except Exception as e:
        print("garment tab:", str(e)[:120])
    errs = []
    print("done")
    b.close()
