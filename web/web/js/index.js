import { DEMO, getDevice, setDevice, store, ApiError } from "./api.js";
import { $, toast, registerSW, loadScript, JSQR_LIB } from "./ui.js";

const CFG = window.APP_CONFIG;
registerSW();
$("#appName").textContent = CFG.APP_NAME;
$("#orgName").textContent = CFG.ORG_NAME;

// รูปแบบรหัสใน QR: ...index.html#pair=P0001.K7M2Q9XA
function parsePair(text) {
  const m = String(text).match(/pair=([A-Za-z0-9]+)\.([A-Za-z0-9]+)/) || String(text).match(/^\s*(P\d+)[.\s-]+([A-Za-z0-9]{6,})\s*$/i);
  return m ? { patientId: m[1].toUpperCase(), token: m[2].toUpperCase() } : null;
}

async function pair(creds) {
  $("#checking").hidden = false;
  try {
    const res = await fetch(CFG.API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "patient.get", ...creds }),
    }).then((r) => r.json());
    if (!res.ok) throw new ApiError(res.error || "รหัสไม่ถูกต้อง");
    setDevice({ ...creds, name: res.data.patient.name });
    store.set("cache_patient", res.data);
    history.replaceState(null, "", location.pathname);
    location.replace("home.html");
  } catch (e) {
    $("#checking").hidden = true;
    toast(e instanceof ApiError ? e.message : "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้", "error", 6000);
  }
}

(async function init() {
  if (DEMO) {
    $("#demoBanner").hidden = false;
    $("#demoBox").hidden = false;
    return;
  }
  const fromHash = parsePair(location.hash);
  if (fromHash) return pair(fromHash);
  if (getDevice()) return location.replace("home.html");
  $("#pairBox").hidden = false;
})();

$("#manualBtn").onclick = () => {
  const c = parsePair(`pair=${$("#pid").value.trim()}.${$("#ptoken").value.trim()}`);
  if (!c) return toast("กรุณากรอกรหัสให้ครบ", "error");
  pair(c);
};

// ---------- สแกน QR ในแอป (สำหรับ iPhone ที่ติดตั้งแอปแล้ว) ----------
let scanStream = null, scanTimer = 0;
$("#scanBtn").onclick = async () => {
  try {
    await loadScript(JSQR_LIB);
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
  } catch (e) {
    return toast("เปิดกล้องไม่ได้ กรุณาอนุญาตการใช้กล้อง หรือพิมพ์รหัสเอง", "error", 6000);
  }
  const v = $("#scanVideo");
  v.srcObject = scanStream;
  await v.play();
  $("#scanArea").hidden = false;
  $("#scanBtn").hidden = true;
  const c = document.createElement("canvas");
  const g = c.getContext("2d", { willReadFrequently: true });
  scanTimer = setInterval(() => {
    if (v.readyState < 2) return;
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    g.drawImage(v, 0, 0);
    // eslint-disable-next-line no-undef
    const code = jsQR(g.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
    if (code) {
      const creds = parsePair(code.data);
      if (creds) {
        stopScan();
        pair(creds);
      } else toast("QR นี้ไม่ใช่รหัสลงทะเบียน", "error");
    }
  }, 300);
};
function stopScan() {
  clearInterval(scanTimer);
  scanStream?.getTracks().forEach((t) => t.stop());
  $("#scanArea").hidden = true;
  $("#scanBtn").hidden = false;
}
$("#scanCancel").onclick = stopScan;
