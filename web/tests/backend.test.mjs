// ทดสอบเซิร์ฟเวอร์ Code.gs ด้วยตัวจำลอง Google Apps Script: node tests/backend.test.mjs
import { createGas } from "./gas-mock.mjs";

let failed = 0;
const ok = (c, m) => { console.log((c ? "  ✔ " : "  ✘ ") + m); if (!c) failed++; };
const { G, call, webhook, sheets, props, pushes, replies, T } = createGas();
T.clock = Date.parse("2026-10-20T03:00:00Z");

// ---------- ทดสอบ ----------
console.log("ติดตั้ง");
G.setup();
ok(Object.keys(sheets).sort().join() === "Alerts,Family,LinkCodes,Patients,Sessions", "สร้างแผ่นงานครบ 5 แผ่น");
ok(call("admin.login", { pin: "x" }).error.includes("ADMIN_PIN"), "ยังไม่ตั้ง PIN → แจ้งให้ตั้งค่า");
Object.assign(props, { ADMIN_PIN: "246810", LINE_CHANNEL_ACCESS_TOKEN: "tok", LINE_OA_ID: "@physio", LINE_LOGIN_CHANNEL_ID: "123", LIFF_ID: "123-abc" });

console.log("นักกายภาพ");
ok(call("admin.login", { pin: "000000" }).ok === false, "PIN ผิด → ปฏิเสธ");
ok(call("admin.login", { pin: "246810" }).ok, "PIN ถูก → เข้าได้");
const created = call("admin.createPatient", { pin: "246810", name: "สมศรี ใจดี", age: "72", plan: { exercises: [{ id: "sit_to_stand", reps: 8, sets: 2, up: 150 }, { id: "hack", reps: 1 }], restSec: 20 } });
const P = created.data.patient;
ok(P.id === "P0001" && /^[A-Z2-9]{8}$/.test(P.token), `สร้างผู้ฝึก ${P.id} รหัสลับ ${P.token}`);
ok(P.plan.exercises.length === 1 && P.plan.exercises[0].up === 150, "แผนฝึกกรองท่าที่ไม่มีอยู่จริงออก และเก็บค่าองศาที่ปรับ");
ok(call("admin.createPatient", { pin: "246810", name: "=HYPERLINK(\"x\")" }).data.patient.name.startsWith("'"), "กันสูตรอันตรายใน Sheet");

console.log("ผู้ฝึก");
ok(call("patient.get", { patientId: "P0001", token: "WRONG" }).ok === false, "รหัสลับผิด → ปฏิเสธ");
const auth = { patientId: "p0001", token: P.token.toLowerCase() };
ok(call("patient.get", auth).data.patient.name === "สมศรี ใจดี", "เข้าด้วยรหัสตัวพิมพ์เล็กได้");
ok(call("patient.saveSession", { ...auth, session: { exercise: "sit_to_stand", reps: 16, goodReps: 14, issues: { trunk: 2 } } }).data.saved, "บันทึกผลการฝึก");
const today = call("patient.get", auth).data.today;
ok(today.length === 1 && today[0].reps === 16 && today[0].issues.trunk === 2, "ผลการฝึกวันนี้แสดงถูกต้อง");

console.log("เชื่อมต่อญาติผ่าน LINE (พิมพ์รหัส)");
const lc = call("patient.linkCode", auth).data;
ok(/^\d{6}$/.test(lc.code), `ได้รหัส ${lc.code}`);
ok(lc.liffUrl === `https://liff.line.me/123-abc?code=${lc.code}`, "สร้างลิงก์ LIFF สำหรับ QR");
ok(lc.oaUrl === `https://line.me/R/oaMessage/%40physio/?LINK%20${lc.code}`, "สร้างลิงก์ส่งข้อความสำรอง");
webhook([{ type: "message", replyToken: "r1", source: { userId: "Ufamily1" }, message: { type: "text", text: "LINK " + lc.code } }]);
ok(replies.at(-1).messages[0].text.includes("ส่งคำขอเชื่อมต่อกับคุณสมศรี"), "LINE ตอบกลับว่าส่งคำขอแล้ว");
let fam = call("patient.get", auth).data.family;
ok(fam.length === 1 && fam[0].status === "pending" && fam[0].displayName === "ลูกสาว", "ผู้สูงอายุเห็นคำขอรออนุมัติ");
webhook([{ type: "message", replyToken: "r2", source: { userId: "Uhacker" }, message: { type: "text", text: lc.code } }]);
ok(replies.at(-1).messages[0].text.includes("ถูกใช้ไปแล้ว"), "รหัสใช้ซ้ำไม่ได้");
const before = pushes.length;
call("patient.familyAction", { ...auth, familyId: fam[0].id, approve: true });
ok(pushes.length === before + 1 && pushes.at(-1).to === "Ufamily1", "อนุมัติแล้ว ส่ง LINE ยืนยันให้ญาติ");

console.log("เชื่อมต่อญาติผ่าน QR + LIFF");
const lc2 = call("patient.linkCode", auth).data;
ok(call("family.preview", { code: lc2.code }).data.patientName === "สมศรี ใจดี", "ญาติเห็นชื่อผู้สูงอายุก่อนยืนยัน");
ok(call("family.link", { code: lc2.code, idToken: "fake", relation: "หลาน" }).ok === false, "ID Token ปลอม → ปฏิเสธ");
const linked = call("family.link", { code: lc2.code, idToken: "good-token", relation: "หลาน" });
ok(linked.ok && linked.data.status === "pending", "ID Token จริง → ส่งคำขอได้");
fam = call("patient.get", auth).data.family;
const f2 = fam.find((f) => f.relation === "หลาน");
call("admin.familyAction", { pin: "246810", id: f2.id, op: "approve" });
ok(call("patient.get", auth).data.family.filter((f) => f.status === "approved").length === 2, "นักกายภาพอนุมัติแทนได้");

console.log("แจ้งเตือน");
let n0 = pushes.length;
const al = call("patient.alert", { ...auth, type: "fall", detail: "ทดสอบ" }).data;
ok(al.notified === 2 && pushes.length === n0 + 2, "ล้ม → ส่ง LINE ถึงญาติ 2 คน");
ok(pushes.at(-1).messages[0].text.includes("ตรวจพบการล้ม"), "ข้อความแจ้งเตือนถูกต้อง");
ok(call("patient.alert", { ...auth, type: "fall" }).data.duplicate, "กดซ้ำภายใน 1 นาที ไม่ส่งซ้ำ");
webhook([{ type: "message", replyToken: "r3", source: { userId: "Ufamily1" }, message: { type: "text", text: "สถานะ" } }]);
ok(replies.at(-1).messages[0].text.includes("รวม 16 ครั้ง"), "ญาติพิมพ์ 'สถานะ' ดูผลการฝึกได้");
call("admin.familyAction", { pin: "246810", id: f2.id, op: "remove" });
n0 = pushes.length;
T.clock += 5 * 60000;
call("patient.alert", { ...auth, type: "sos" });
ok(pushes.length === n0 + 1, "ลบญาติแล้ว ไม่ได้รับแจ้งเตือนอีก");

console.log("ตรวจรายวัน");
T.clock += 3 * 86400000;
n0 = pushes.length;
const dc = G.dailyCheck();
ok(dc.missed.includes("P0001") && pushes.at(-1).messages[0].text.includes("ไม่ได้ฝึกกายภาพมา 3 วัน"), "ไม่ได้ฝึก 3 วัน → แจ้งญาติ");
ok(G.dailyCheck().missed.length === 0, "วันเดียวกันไม่แจ้งซ้ำ");
const ov = call("admin.overview", { pin: "246810" }).data;
ok(ov.patients[0].newAlerts >= 3 && ov.alerts.length >= 3, "หน้านักกายภาพเห็นรายการแจ้งเตือน");

// ผลการฝึกลดลง
const p2 = call("admin.createPatient", { pin: "246810", name: "ทดสอบลดลง" }).data.patient;
const a2 = { patientId: p2.id, token: p2.token };
for (let i = 0; i < 4; i++) { call("patient.saveSession", { ...a2, session: { reps: 20 } }); T.clock += 86400000; }
T.clock += 4 * 86400000;
for (let i = 0; i < 3; i++) { call("patient.saveSession", { ...a2, session: { reps: 8 } }); T.clock += 86400000 / 2; }
const dc2 = G.dailyCheck();
ok(dc2.decline.includes(p2.id), "จำนวนครั้งลดลง 60% → แจ้งเตือน");

console.log("รหัสหมดอายุ");
const lc3 = call("patient.linkCode", auth).data;
T.clock += 11 * 60000;
ok(call("family.preview", { code: lc3.code }).error.includes("หมดอายุ"), "เกิน 10 นาที รหัสหมดอายุ");

console.log("ผู้ป่วยโรคหลอดเลือดสมอง");
{
  const sp = call("admin.createPatient", { pin: "246810", name: "สมชาย", condition: "stroke", affectedSide: "R" }).data.patient;
  ok(sp.condition === "stroke" && sp.affectedSide === "R", "บันทึกโรคและข้างที่อ่อนแรง");
  ok(call("admin.createPatient", { pin: "246810", name: "x", condition: "hack", affectedSide: "Z" }).data.patient.condition === "general", "กรองค่าโรคที่ไม่รู้จัก");
  const sa = { patientId: sp.id, token: sp.token };
  ok(call("patient.get", sa).data.patient.affectedSide === "R", "แอปผู้ป่วยรู้ข้างที่อ่อนแรง");
  // ญาติ
  const c = call("patient.linkCode", sa).data.code;
  webhook([{ type: "message", replyToken: "s1", source: { userId: "Ustroke" }, message: { type: "text", text: c } }]);
  const fid = call("patient.get", sa).data.family[0].id;
  call("patient.familyAction", { ...sa, familyId: fid, approve: true });
  let n = pushes.length;
  call("patient.alert", { ...sa, type: "stroke_warning", detail: "หน้าเบี้ยว" });
  ok(pushes.length === n + 1 && pushes.at(-1).messages[0].text.includes("1669"), "สัญญาณเตือนสโตรค → LINE ญาติพร้อมให้โทร 1669");
  // ข้างอ่อนแรงแย่ลง
  const side = (r) => ({ L: { reps: 8, avg: 150, max: 160 }, R: { reps: 8, avg: r, max: r } });
  for (let i = 0; i < 3; i++) { call("patient.saveSession", { ...sa, session: { exercise: "arm_raise", reps: 8, sides: side(110) } }); T.clock += 86400000; }
  T.clock += 5 * 86400000;
  for (let i = 0; i < 3; i++) { call("patient.saveSession", { ...sa, session: { exercise: "arm_raise", reps: 8, sides: side(70) } }); T.clock += 86400000 / 3; }
  n = pushes.length;
  const dc = G.dailyCheck();
  ok(dc.regress.includes(sp.id), "ตรวจพบข้างอ่อนแรงขยับได้น้อยลง");
  ok(pushes.length === n || !pushes.slice(n).some((x) => x.messages[0].text.includes("ขยับได้น้อยลง")), "แจ้งเฉพาะนักกายภาพ ไม่ส่ง LINE ญาติ");
  const det = call("admin.patientDetail", { pin: "246810", id: sp.id }).data;
  ok(det.alerts.some((a) => a.type === "regress" && a.detail.includes("ข้างขวา") && a.detail.includes("ยกแขน 110° →")), "หน้านักกายภาพเห็น: " + det.alerts.find((a) => a.type === "regress").detail);
  ok(det.sessions.at(-1).sides.R.avg === 70, "เก็บผลแยกซ้าย-ขวาในประวัติ");
}

console.log(failed ? `\nไม่ผ่าน ${failed} ข้อ` : "\nผ่านทั้งหมด");
process.exit(failed ? 1 : 0);
