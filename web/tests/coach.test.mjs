// ทดสอบโหมดเรียนท่า: node tests/coach.test.mjs
import { EXERCISES, RepCounter, resolveParams, LM } from "../web/js/pose-engine.js";
import { Coach, facing } from "../web/js/coach.js";

let failed = 0;
const ok = (c, m) => { console.log((c ? "  ✔ " : "  ✘ ") + m); if (!c) failed++; };
function sideBody(knee, lean = 0, wide = 0) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.95 }));
  const K = { x: 0.5, y: 0.7 }, A = { x: 0.5, y: 0.9 }, r = (knee * Math.PI) / 180;
  const H = { x: K.x + 0.15 * Math.sin(r), y: K.y + 0.15 * Math.cos(r) };
  const lr = (lean * Math.PI) / 180, S = { x: H.x + 0.25 * Math.sin(lr), y: H.y - 0.25 * Math.cos(lr) };
  for (const [i, p] of [[23, H], [24, H], [25, K], [26, K], [27, A], [28, A], [11, S], [12, S]]) Object.assign(lm[i], p);
  if (wide) { lm[11].x -= wide; lm[12].x += wide; lm[23].x -= wide / 2; lm[24].x += wide / 2; }
  return lm;
}
const ramp = (a, b, n) => Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));
function run(seq, opts = {}) {
  const ex = EXERCISES.sit_to_stand, p = resolveParams(ex);
  const counter = new RepCounter(ex, p), coach = new Coach(ex, p, opts);
  let t = 0, last, said = [];
  for (const lm of seq) {
    const ev = counter.update(lm, t, 1);
    last = coach.update(lm, t, 1, ev, counter);
    said.push(...last.say.map((s) => s[0]));
    t += 33;
  }
  return { last, said, coach };
}
const seated = (n, w = 0) => Array(n).fill(0).map(() => sideBody(90, 5, w));
const goodRep = () => [...ramp(90, 175, 45), ...Array(15).fill(175), ...ramp(175, 90, 45), ...Array(20).fill(90)].map((k) => sideBody(k, 5));
const lazyRep = () => [...ramp(90, 158, 45), ...Array(10).fill(158), ...ramp(158, 90, 45), ...Array(20).fill(90)].map((k) => sideBody(k, 5));

console.log("ตรวจทิศทางการหันตัว");
ok(facing(sideBody(175)) === "side", "หันข้าง");
ok(facing(sideBody(175, 0, 0.12)) === "front", "หันหน้า");

console.log("ผ่านทั้ง 3 ขั้น");
{
  const { last, said } = run([seated(110), goodRep(), goodRep(), goodRep()].flat());
  ok(last.finished && last.finished.passed, "ผ่านการเรียนท่า");
  ok(said.some((s) => s.includes("ขั้นที่สอง")) && said.some((s) => s.includes("ขั้นที่สาม")), "พูดบอกทุกขั้น");
  ok(said.some((s) => s.includes("ผ่านแล้ว")), "บอกว่าผ่านแล้ว");
}
console.log("หันผิดด้าน → ยังอยู่ขั้นตั้งกล้อง");
{
  const { last, said } = run(seated(150, 0.12));
  ok(last.stage === 0, "อยู่ขั้นที่ 1");
  ok(said.some((s) => s.includes("หันข้าง")), "บอกให้หันข้าง");
}
console.log("ทำไม่สุดซ้ำ ๆ → ให้คำแนะนำ");
{
  const { last, said } = run([seated(110), lazyRep(), lazyRep(), lazyRep(), lazyRep(), lazyRep(), lazyRep()].flat());
  ok(last.finished && !last.finished.passed, "ยังไม่ผ่าน หลังลอง 6 ครั้ง");
  ok(last.finished.tips[0].includes("ยืดเข่า"), "คำแนะนำ: " + last.finished.tips[0]);
  ok(said.some((s) => s.includes("เกือบแล้ว")), "ให้กำลังใจและบอกจุดแก้");
}
console.log(failed ? `\nไม่ผ่าน ${failed} ข้อ` : "\nผ่านทั้งหมด");
process.exit(failed ? 1 : 0);
