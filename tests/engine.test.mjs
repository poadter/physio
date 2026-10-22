// ทดสอบตัวนับครั้งและตัวตรวจการล้มด้วยข้อมูลจำลอง: node tests/engine.test.mjs
import { EXERCISES, RepCounter, FallDetector, resolveParams, angle, LM } from "../web/js/pose-engine.js";

let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "  ✔ " : "  ✘ ") + msg); if (!cond) failed++; };

function blank() {
  return Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.95 }));
}
// โครงร่างด้านข้าง: มุมเข่า = knee°, ลำตัวเอียง = lean°
function sideBody(knee, lean = 0, hipY = 0.55) {
  const lm = blank();
  const K = { x: 0.5, y: hipY + 0.15 };
  const A = { x: 0.5, y: K.y + 0.2 };
  const r = (knee * Math.PI) / 180;
  const H = { x: K.x + 0.15 * Math.sin(r), y: K.y + 0.15 * Math.cos(r) };
  const lr = (lean * Math.PI) / 180;
  const S = { x: H.x + 0.25 * Math.sin(lr), y: H.y - 0.25 * Math.cos(lr) };
  for (const [i, p] of [[LM.L_HIP, H], [LM.R_HIP, H], [LM.L_KNEE, K], [LM.R_KNEE, K], [LM.L_ANKLE, A], [LM.R_ANKLE, A], [LM.L_SHOULDER, S], [LM.R_SHOULDER, S]])
    Object.assign(lm[i], p);
  lm[LM.R_HIP].visibility = lm[LM.R_KNEE].visibility = lm[LM.R_ANKLE].visibility = 0.5;
  lm[LM.L_HEEL] = { x: 0.48, y: A.y + 0.02, visibility: 0.9 };
  lm[LM.L_FOOT] = { x: 0.56, y: A.y + 0.02, visibility: 0.9 };
  return lm;
}
function run(counter, seq, fps = 30) {
  let t = 0; const ev = [];
  for (const lm of seq) { ev.push(...counter.update(lm, t, 1)); t += 1000 / fps; }
  return ev;
}
const ramp = (a, b, n) => Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));

console.log("มุม");
ok(Math.abs(angle({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }) - 90) < 1e-6, "มุมฉาก = 90°");
ok(Math.abs(angle(sideBody(120)[LM.L_HIP], sideBody(120)[LM.L_KNEE], sideBody(120)[LM.L_ANKLE]) - 120) < 0.01, "โครงร่างจำลองให้มุมเข่าถูกต้อง");

console.log("ลุก-นั่ง: ทำถูก 3 ครั้ง (ช้า ๆ)");
{
  const ex = EXERCISES.sit_to_stand, c = new RepCounter(ex, resolveParams(ex));
  const one = [...ramp(90, 175, 40), ...Array(15).fill(175), ...ramp(175, 90, 40), ...Array(10).fill(90)];
  const seq = [...one, ...one, ...one].map((k) => sideBody(k, 5));
  const ev = run(c, seq);
  ok(c.reps === 3, `นับได้ ${c.reps} ครั้ง`);
  ok(c.goodReps === 3, `ทำถูก ${c.goodReps} ครั้ง`);
  ok(!ev.some((e) => e.type === "partial"), "ไม่มีการเตือนทำไม่ถึง");
}

console.log("ลุก-นั่ง: ยืนไม่สุด + ตัวเอียง + เร็วเกิน");
{
  const ex = EXERCISES.sit_to_stand, c = new RepCounter(ex, resolveParams(ex));
  const lazy = [...ramp(90, 158, 10), ...Array(5).fill(158), ...ramp(158, 90, 10)].map((k) => sideBody(k, 35));
  const ev = run(c, lazy);
  const rep = ev.find((e) => e.type === "rep");
  ok(c.reps === 1 && c.goodReps === 0, "นับ 1 ครั้งแต่ไม่นับเป็นท่าถูก");
  const keys = rep.problems.map((p) => p.key).sort().join(",");
  ok(keys === "fast,range,trunk", `ตรวจพบปัญหา: ${keys}`);
}

console.log("ลุก-นั่ง: ลุกไม่ถึงแล้วนั่งกลับ");
{
  const ex = EXERCISES.sit_to_stand, c = new RepCounter(ex, resolveParams(ex));
  const ev = run(c, [...ramp(90, 145, 30), ...ramp(145, 90, 30)].map((k) => sideBody(k)));
  ok(c.reps === 0, "ไม่นับ");
  ok(ev.some((e) => e.type === "partial"), "เตือนให้ยืดเข่าให้สุด");
}

console.log("นั่งเหยียดเข่า: ต้องค้าง 2 วินาที");
{
  const ex = EXERCISES.knee_extension, c = new RepCounter(ex, resolveParams(ex));
  const short = [...ramp(95, 170, 30), ...Array(20).fill(170), ...ramp(170, 95, 30)];
  const long = [...ramp(95, 170, 30), ...Array(75).fill(170), ...ramp(170, 95, 30)];
  run(c, short.map((k) => sideBody(k)));
  ok(c.reps === 0, "ค้างไม่ถึง 2 วิ ไม่นับ");
  run(c, long.map((k) => sideBody(k)));
  ok(c.reps === 1 && c.goodReps === 1, "ค้างครบ นับ 1 ครั้ง");
}

console.log("ค่าที่นักกายภาพปรับเอง");
{
  const ex = EXERCISES.sit_to_stand;
  const p = resolveParams(ex, { up: 140, good: 150, reps: "8" });
  ok(p.up === 140 && p.good === 150 && p.reps === 8 && p.down === 110, "ใช้ค่าที่ปรับ");
  const c = new RepCounter(ex, p);
  run(c, [...ramp(90, 152, 40), ...Array(10).fill(152), ...ramp(152, 90, 40)].map((k) => sideBody(k)));
  ok(c.reps === 1 && c.goodReps === 1, "ผู้ป่วยข้อเข่าติด ยืนได้ 152° ก็นับเป็นท่าถูก");
}

console.log("หายจากกล้อง");
{
  const ex = EXERCISES.sit_to_stand, c = new RepCounter(ex, resolveParams(ex));
  const ev = run(c, Array(60).fill(null));
  ok(ev.some((e) => e.type === "lost"), "แจ้งว่าไม่เห็นร่างกาย");
}

console.log("ตรวจการล้ม");
{
  const fd = new FallDetector();
  let t = 0, res = null;
  // ลุก-นั่งปกติ 3 รอบ ต้องไม่แจ้งล้ม
  for (let r = 0; r < 3; r++)
    for (const k of [...ramp(90, 175, 40), ...ramp(175, 90, 40)]) {
      res = res || fd.update(sideBody(k, 10, k > 150 ? 0.45 : 0.55), t, 1); t += 33;
    }
  ok(res === null, "ลุก-นั่งปกติ ไม่แจ้งล้ม");
  // ล้ม: สะโพกตกลงเร็ว แล้วลำตัวนอน
  for (let i = 0; i < 12; i++) { res = res || fd.update(sideBody(170, 10 + i * 7, 0.45 + i * 0.025), t, 1); t += 33; }
  for (let i = 0; i < 45; i++) { res = res || fd.update(sideBody(170, 85, 0.75), t, 1); t += 33; }
  ok(res && res.type === "fall", `ตรวจพบการล้ม (${res && res.reason})`);

  const fd2 = new FallDetector(); t = 0; res = null;
  for (let i = 0; i < 30; i++) { res = res || fd2.update(sideBody(170, 5, 0.45), t, 1); t += 33; }
  for (let i = 0; i < 8; i++) { res = res || fd2.update(sideBody(170, 20, 0.45 + i * 0.04), t, 1); t += 33; }
  for (let i = 0; i < 160; i++) { res = res || fd2.update(null, t, 1); t += 33; }
  ok(res && res.reason === "lost_after_drop", "ตกลงเร็วแล้วหายจากกล้อง → แจ้งล้ม");

  const fd3 = new FallDetector(); t = 0; res = null;
  for (let i = 0; i < 200; i++) { res = res || fd3.update(null, t, 1); t += 33; }
  ok(res === null, "เดินออกจากกล้องเฉย ๆ ไม่แจ้งล้ม");
}

console.log(failed ? `\nไม่ผ่าน ${failed} ข้อ` : "\nผ่านทั้งหมด");
process.exit(failed ? 1 : 0);
