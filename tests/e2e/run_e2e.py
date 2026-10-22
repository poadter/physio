"""ทดสอบทั้งระบบในเบราว์เซอร์จริง (Chromium + กล้องจำลอง + AI จำลอง)
ใช้: node tests/e2e/server.mjs &  แล้ว  python3 tests/e2e/run_e2e.py [โฟลเดอร์เก็บภาพ]
"""
import json, sys, time, urllib.request, os
from playwright.sync_api import sync_playwright

SHOTS = sys.argv[1] if len(sys.argv) > 1 else "shots"
os.makedirs(SHOTS, exist_ok=True)
HERE = os.path.dirname(os.path.abspath(__file__))
FAKE = open(os.path.join(HERE, "fake-vision.mjs"), encoding="utf-8").read()
failed = 0
errors = []

def ok(cond, msg):
    global failed
    print(("  ✔ " if cond else "  ✘ ") + msg)
    if not cond:
        failed += 1

def state():
    return json.load(urllib.request.urlopen("http://localhost:8001/__state"))

def webhook(events):
    req = urllib.request.Request("http://localhost:8001/__webhook", data=json.dumps({"events": events}).encode(), method="POST")
    urllib.request.urlopen(req)

def route(r):
    url = r.request.url
    if "tasks-vision" in url and url.endswith(".mjs"):
        return r.fulfill(status=200, body=FAKE, headers={"Content-Type": "text/javascript", "Access-Control-Allow-Origin": "*"})
    if url.startswith("http://localhost"):
        return r.continue_()
    return r.abort()

with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"])
    ctx = b.new_context(viewport={"width": 400, "height": 860}, permissions=["camera"], device_scale_factor=1)
    ctx.route("**/*", route)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: m.type == "error" and "net::ERR" not in m.text and "Failed to load resource" not in m.text and errors.append(m.text))

    print("นักกายภาพ: เข้าสู่ระบบและเพิ่มผู้ฝึก")
    page.goto("http://localhost:8000/admin.html")
    page.fill("#pin", "000000"); page.click("#loginBtn"); page.wait_for_timeout(500)
    ok(page.is_visible("#login"), "PIN ผิด ยังอยู่หน้าเข้าสู่ระบบ")
    page.fill("#pin", "246810"); page.click("#loginBtn")
    page.wait_for_selector("#addBtn")
    page.click("#addBtn")
    page.fill("#nName", "สมศรี ใจดี"); page.fill("#nAge", "72")
    page.uncheck('.modal input[type=checkbox][data-ex="arm_raise"]')
    page.fill('.modal input[data-ex="sit_to_stand"][data-k="reps"]', "2")
    page.fill('.modal input[data-ex="sit_to_stand"][data-k="sets"]', "2")
    page.fill(".modal #restSec", "5")
    page.screenshot(path=f"{SHOTS}/01_admin_add.png")
    page.click("#nSave")
    page.wait_for_selector("text=ลงทะเบียนเครื่องของคุณสมศรี")
    page.screenshot(path=f"{SHOTS}/02_admin_qr.png")
    pt = state()["sheets"]["Patients"][1]
    pid, token = pt[0], pt[5]
    ok(pid == "P0001", f"สร้างผู้ฝึก {pid}")
    ok(json.loads(pt[6])["exercises"] == [{"id": "sit_to_stand", "reps": 2, "sets": 2, "down": 110, "up": 155, "good": 165}], "แผนฝึกบันทึกถูกต้อง")

    print("ผู้ฝึก: ลงทะเบียนเครื่องด้วยลิงก์จาก QR")
    page2 = ctx.new_page()
    page2.on("pageerror", lambda e: errors.append(str(e)))
    page2.goto(f"http://localhost:8000/index.html#pair={pid}.{token}")
    page2.wait_for_url("**/home.html")
    page2.wait_for_selector(".ex-tile")
    ok("สวัสดีครับ คุณสมศรี ใจดี" in page2.inner_text("#hello"), "เข้าหน้าหลักพร้อมชื่อ")
    ok(page2.locator(".ex-tile").count() == 1, "เห็นท่าตามแผน 1 ท่า")
    page2.screenshot(path=f"{SHOTS}/03_home.png", full_page=True)

    print("ผู้ฝึก: ฝึกท่าลุก-นั่ง 2 เซต (AI จำลอง)")
    page2.click(".ex-tile")
    page2.wait_for_selector("#startBtn")
    page2.screenshot(path=f"{SHOTS}/04_intro.png", full_page=True)
    page2.click("#startBtn")
    page2.click('[data-pain="none"]')
    page2.wait_for_selector("#loading", state="hidden", timeout=15000)
    page2.wait_for_function("document.querySelector('#repNow').textContent === '1'", timeout=15000)
    page2.screenshot(path=f"{SHOTS}/05_training.png")
    page2.wait_for_selector("#sRest:not([hidden])", timeout=15000)
    ok(True, "ครบเซตที่ 1 → หน้าพัก")
    page2.screenshot(path=f"{SHOTS}/06_rest.png")
    page2.wait_for_selector("#sTrain:not([hidden])", timeout=10000)
    ok("เซต 2/2" in page2.inner_text("#setInfo"), "เริ่มเซตที่ 2 อัตโนมัติหลังพัก")
    page2.wait_for_selector("#sPain:not([hidden])", timeout=20000)
    page2.click('[data-pain="mild"]')
    page2.wait_for_selector("#saveState:has-text('บันทึกผลแล้ว')", timeout=10000)
    ok(page2.inner_text("#sumReps") == "4", f"สรุป {page2.inner_text('#sumReps')} ครั้ง")
    page2.screenshot(path=f"{SHOTS}/07_done.png", full_page=True)
    sess = state()["sheets"]["Sessions"]
    ok(len(sess) == 2 and sess[1][8] == "4" and sess[1][12] == "mild", "เซิร์ฟเวอร์บันทึก 4 ครั้ง อาการหลังฝึก=เจ็บเล็กน้อย")

    print("ผู้ฝึก: หน้าหลักอัปเดตความคืบหน้า")
    page2.click("#doneHome")
    page2.wait_for_selector(".ex-tile.done", timeout=8000)
    ok(page2.inner_text("#doneBadge") == "เสร็จ 1/1", "ขึ้นว่าเสร็จ 1/1")

    print("เชื่อมต่อญาติ")
    page2.click("#linkBtn")
    page2.wait_for_selector(".code-big")
    code = page2.inner_text(".code-big").strip()
    page2.screenshot(path=f"{SHOTS}/08_link.png")
    webhook([{"type": "message", "replyToken": "r", "source": {"userId": "Ufam"}, "message": {"type": "text", "text": "LINK " + code}}])
    page2.wait_for_selector("[data-approve]", timeout=10000)
    ok(True, "แอปผู้สูงอายุเด้งคำขอเชื่อมต่อขึ้นมาเอง")
    page2.screenshot(path=f"{SHOTS}/09_approve.png", full_page=True)
    page2.click("[data-approve]")
    page2.wait_for_selector("#family:has-text('ลูกสาว')")
    page2.wait_for_timeout(800)
    ok(any(x["to"] == "Ufam" for x in state()["pushes"]), "ญาติได้รับ LINE ยืนยันการเชื่อมต่อ")

    print("ปุ่มขอความช่วยเหลือ")
    n = len(state()["pushes"])
    page2.click("#sosBtn"); page2.click("#cfOk")
    page2.wait_for_selector("text=แจ้งญาติแล้ว 1 คน")
    ok(len(state()["pushes"]) == n + 1 and "ขอความช่วยเหลือ" in state()["pushes"][-1]["messages"][0]["text"], "ส่ง LINE ขอความช่วยเหลือถึงญาติ")

    print("นักกายภาพ: ดูรายละเอียด")
    page.reload(); page.wait_for_selector("#ptable tbody tr[data-id]")
    page.screenshot(path=f"{SHOTS}/10_admin_list.png", full_page=True)
    page.click("#ptable tbody tr[data-id]")
    page.wait_for_selector("#famList")
    ok("ลูกสาว" in page.inner_text("#famList"), "เห็นญาติที่เชื่อมต่อ")
    ok("ขอความช่วยเหลือ" in page.inner_text("#alList"), "เห็นแจ้งเตือน SOS")
    page.set_viewport_size({"width": 1200, "height": 900})
    page.screenshot(path=f"{SHOTS}/11_admin_detail.png", full_page=True)
    page.click("#tabs [data-tab=test]")
    page.wait_for_selector("[data-try]")
    page.click("#tabs [data-tab=system]")
    page.wait_for_selector("#runDaily")

    print("โหมดทดลองท่า (นักกายภาพ)")
    page.goto("http://localhost:8000/exercise.html?ex=sit_to_stand&test=1&reps=1&sets=1")
    page.click("#startBtn"); page.click('[data-pain="none"]')
    page.wait_for_selector("#debug:not([hidden])", timeout=15000)
    page.wait_for_timeout(1500)
    ok("มุมเข่า" in page.inner_text("#debug"), "แสดงองศาสด: " + page.inner_text("#debug").split("\n")[0])
    page.wait_for_selector("#sDone:not([hidden]), #sPain:not([hidden])", timeout=15000)
    n = len(state()["sheets"]["Sessions"])
    if page.is_visible("#sPain"): page.click('[data-pain="none"]')
    page.wait_for_timeout(800)
    ok(len(state()["sheets"]["Sessions"]) == n, "โหมดทดลองไม่บันทึกผล")

    print("ความถูกต้องของหน้าจอ")
    ok(not errors, "ไม่มี JavaScript error" + ("" if not errors else ": " + " | ".join(errors[:5])))
    b.close()

print(f"\nไม่ผ่าน {failed} ข้อ" if failed else "\nผ่านทั้งหมด")
sys.exit(1 if failed else 0)
