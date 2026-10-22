// =============================================================
//  pose-engine.js — หัวใจของระบบ: คำนวณมุม ตัดสินท่า นับครั้ง ตรวจการล้ม
//  ไฟล์นี้ไม่ยุ่งกับหน้าจอเลย จึงทดสอบแยกได้ (ดู tests/engine.test.mjs)
// =============================================================

// ตำแหน่งจุดของ MediaPipe Pose (33 จุด) ที่ใช้ในระบบ
export const LM = {
  NOSE: 0,
  L_SHOULDER: 11, R_SHOULDER: 12,
  L_ELBOW: 13, R_ELBOW: 14,
  L_WRIST: 15, R_WRIST: 16,
  L_HIP: 23, R_HIP: 24,
  L_KNEE: 25, R_KNEE: 26,
  L_ANKLE: 27, R_ANKLE: 28,
  L_HEEL: 29, R_HEEL: 30,
  L_FOOT: 31, R_FOOT: 32,
};

const SIDE = {
  L: { sh: LM.L_SHOULDER, el: LM.L_ELBOW, wr: LM.L_WRIST, hip: LM.L_HIP, knee: LM.L_KNEE, ank: LM.L_ANKLE, heel: LM.L_HEEL, foot: LM.L_FOOT },
  R: { sh: LM.R_SHOULDER, el: LM.R_ELBOW, wr: LM.R_WRIST, hip: LM.R_HIP, knee: LM.R_KNEE, ank: LM.R_ANKLE, heel: LM.R_HEEL, foot: LM.R_FOOT },
};

// ---------- คณิตศาสตร์พื้นฐาน ----------

// แปลงพิกัด 0–1 ให้เป็นสัดส่วนจริงของภาพ (กันมุมเพี้ยนเมื่อภาพไม่เป็นสี่เหลี่ยมจัตุรัส)
export function px(p, aspect = 1) {
  return { x: p.x * aspect, y: p.y };
}

// มุมที่จุด b ระหว่างเส้น b→a และ b→c (องศา 0–180)
export function angle(a, b, c, aspect = 1) {
  const A = px(a, aspect), B = px(b, aspect), C = px(c, aspect);
  const v1x = A.x - B.x, v1y = A.y - B.y;
  const v2x = C.x - B.x, v2y = C.y - B.y;
  const n1 = Math.hypot(v1x, v1y), n2 = Math.hypot(v2x, v2y);
  if (n1 === 0 || n2 === 0) return NaN;
  let cos = (v1x * v2x + v1y * v2y) / (n1 * n2);
  cos = Math.max(-1, Math.min(1, cos));
  return (Math.acos(cos) * 180) / Math.PI;
}

// มุมของเส้น a→b เทียบกับแนวตั้ง (0 = ตั้งตรง, 90 = แนวนอน)
export function angleFromVertical(a, b, aspect = 1) {
  const A = px(a, aspect), B = px(b, aspect);
  const dx = B.x - A.x, dy = B.y - A.y;
  const n = Math.hypot(dx, dy);
  if (n === 0) return NaN;
  return (Math.acos(Math.min(1, Math.abs(dy) / n)) * 180) / Math.PI;
}

export function dist(a, b, aspect = 1) {
  const A = px(a, aspect), B = px(b, aspect);
  return Math.hypot(A.x - B.x, A.y - B.y);
}

export function mid(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, visibility: Math.min(vis(a), vis(b)) };
}

// ความมั่นใจว่ามองเห็นจุดนี้ (บางเวอร์ชันของ MediaPipe ไม่ส่ง visibility มา จึงใช้การอยู่ในกรอบภาพแทน)
export function vis(p) {
  if (!p) return 0;
  if (typeof p.visibility === "number" && p.visibility > 0) return p.visibility;
  const inFrame = p.x > -0.02 && p.x < 1.02 && p.y > -0.02 && p.y < 1.02;
  return inFrame ? 0.75 : 0;
}

export function visibleAll(lm, idxs, min = 0.5) {
  return idxs.every((i) => vis(lm[i]) >= min);
}

// เลือกด้านของร่างกายที่หันเข้าหากล้อง (สำหรับท่าที่ถ่ายด้านข้าง)
export function pickSide(lm, keys) {
  const score = (s) => keys.reduce((t, k) => t + vis(lm[SIDE[s][k]]), 0);
  const sl = score("L"), sr = score("R");
  if (Math.abs(sl - sr) > 0.15) return sl > sr ? "L" : "R";
  // ถ้าใกล้กัน ใช้ค่าความลึก z (ค่าน้อย = ใกล้กล้อง)
  const z = (s) => keys.reduce((t, k) => t + (lm[SIDE[s][k]]?.z ?? 0), 0);
  return z("L") <= z("R") ? "L" : "R";
}

// =============================================================
//  ท่ากายภาพ — แต่ละท่ามี "ค่าวัด" 1 ค่า ที่ยิ่งมาก = ยิ่งใกล้ท่าสุดทาง
//  down = ค่าที่ถือว่ากลับท่าเริ่มต้นแล้ว
//  up   = ค่าที่ถือว่าทำถึงท่าแล้ว (เริ่มนับ)
//  good = ค่าที่ถือว่าทำได้เต็มที่ (ทำถูกสมบูรณ์)
//  นักกายภาพปรับ 3 ค่านี้รายคนได้ในหน้าจัดการ
// =============================================================
export const EXERCISES = {
  sit_to_stand: {
    id: "sit_to_stand",
    cue: { start: "นั่งบนเก้าอี้ หลังตรง เท้าวางราบกับพื้น", go: "โน้มตัวมาข้างหน้าเล็กน้อย แล้วค่อย ๆ ลุกขึ้นยืนตรง", back: "ค่อย ๆ นั่งลงช้า ๆ" },
    name: "ลุก-นั่งจากเก้าอี้",
    icon: "🪑",
    view: "side",
    benefit: "เพิ่มแรงขา ช่วยให้ลุกเดินได้มั่นคง ลดความเสี่ยงล้ม",
    setup: "วางเก้าอี้ที่มั่นคงไม่มีล้อ ชิดผนัง ตั้งมือถือด้านข้างลำตัว ห่าง 2–3 เมตร ให้เห็นตั้งแต่ศีรษะถึงเท้า",
    steps: [
      "นั่งบนเก้าอี้ เท้าวางราบกับพื้น ห่างกันประมาณช่วงไหล่",
      "ไขว้แขนแนบอก หรือวางมือบนเข่า",
      "โน้มตัวไปข้างหน้าเล็กน้อย แล้วลุกขึ้นยืนตรงช้า ๆ",
      "ค่อย ๆ นั่งลงอย่างช้า ๆ",
    ],
    metricLabel: "มุมเข่า",
    unit: "°",
    range: [60, 180],
    defaults: { reps: 10, sets: 2, down: 110, up: 155, good: 165 },
    minRepSec: 1.6,
    holdSec: 0,
    required: (lm, side) => [SIDE[side].hip, SIDE[side].knee, SIDE[side].ank],
    sideKeys: ["hip", "knee", "ank"],
    metric(lm, ctx) {
      const s = SIDE[ctx.side];
      return angle(lm[s.hip], lm[s.knee], lm[s.ank], ctx.aspect);
    },
    checks: [
      {
        key: "trunk",
        msg: "ยืดตัวให้ตรงตอนยืนครับ",
        when: "top",
        test(lm, ctx) {
          const s = SIDE[ctx.side];
          return angleFromVertical(lm[s.hip], lm[s.sh], ctx.aspect) > 25;
        },
      },
    ],
    partialMsg: "ยืดเข่าให้สุด ยืนให้ตรงอีกนิดครับ",
    goodMsg: "ดีมากครับ",
  },

  arm_raise: {
    id: "arm_raise",
    cue: { start: "ปล่อยแขนสองข้างไว้ข้างลำตัว", go: "กางแขนทั้งสองข้างขึ้นด้านข้าง จนอยู่เหนือศีรษะ", back: "ค่อย ๆ ลดแขนลงข้างลำตัว" },
    name: "ยกแขนเหนือศีรษะ",
    icon: "🙌",
    view: "front",
    benefit: "เพิ่มองศาการเคลื่อนไหวของไหล่ ช่วยใส่เสื้อ หยิบของที่สูงได้ง่ายขึ้น",
    setup: "ยืนหรือนั่งหันหน้าเข้าหากล้อง ห่าง 2 เมตร ให้เห็นตั้งแต่ศีรษะถึงสะโพก และเห็นปลายมือเมื่อยกแขนสุด",
    steps: [
      "ปล่อยแขนสองข้างไว้ข้างลำตัว",
      "กางแขนทั้งสองข้างขึ้นด้านข้าง จนอยู่เหนือศีรษะ",
      "เหยียดศอกให้ตรง ค้างไว้สักครู่",
      "ค่อย ๆ ลดแขนลง",
    ],
    metricLabel: "มุมไหล่",
    unit: "°",
    range: [0, 180],
    defaults: { reps: 10, sets: 2, down: 50, up: 135, good: 155 },
    minRepSec: 1.4,
    holdSec: 0,
    required: () => [LM.L_SHOULDER, LM.R_SHOULDER, LM.L_ELBOW, LM.R_ELBOW, LM.L_HIP, LM.R_HIP],
    metric(lm, ctx) {
      const l = angle(lm[LM.L_HIP], lm[LM.L_SHOULDER], lm[LM.L_ELBOW], ctx.aspect);
      const r = angle(lm[LM.R_HIP], lm[LM.R_SHOULDER], lm[LM.R_ELBOW], ctx.aspect);
      ctx.extra = { left: l, right: r };
      return Math.min(l, r); // ต้องยกทั้งสองข้าง จึงใช้ข้างที่ยกได้น้อยกว่า
    },
    sideMode: "both",
    sideBase: 0,
    sideMetric(lm, ctx) {
      return {
        L: angle(lm[LM.L_HIP], lm[LM.L_SHOULDER], lm[LM.L_ELBOW], ctx.aspect),
        R: angle(lm[LM.R_HIP], lm[LM.R_SHOULDER], lm[LM.R_ELBOW], ctx.aspect),
      };
    },
    checks: [
      {
        key: "elbow",
        msg: "เหยียดศอกให้ตรงครับ",
        when: "top",
        test(lm, ctx) {
          if (!visibleAll(lm, [LM.L_WRIST, LM.R_WRIST], 0.4)) return false;
          const l = angle(lm[LM.L_SHOULDER], lm[LM.L_ELBOW], lm[LM.L_WRIST], ctx.aspect);
          const r = angle(lm[LM.R_SHOULDER], lm[LM.R_ELBOW], lm[LM.R_WRIST], ctx.aspect);
          return Math.min(l, r) < 140;
        },
      },
      {
        key: "symmetry",
        msg: "ยกแขนสองข้างให้สูงเท่ากันครับ",
        msgFn: (ctx) => ((ctx.peaks?.L ?? 0) < (ctx.peaks?.R ?? 0) ? "ยกแขนซ้ายให้สูงขึ้นอีกนิดครับ" : "ยกแขนขวาให้สูงขึ้นอีกนิดครับ"),
        when: "top",
        test(lm, ctx) {
          const e = ctx.extra || {};
          return Math.abs((e.left ?? 0) - (e.right ?? 0)) > 25;
        },
      },
    ],
    partialMsg: "ยกแขนให้สูงขึ้นอีกนิดครับ",
    goodMsg: "เยี่ยมเลยครับ",
  },

  knee_extension: {
    id: "knee_extension",
    cue: { start: "นั่งหลังตรง เท้าวางราบกับพื้น", go: "ค่อย ๆ เหยียดเข่าจนขาตรง", back: "ค่อย ๆ วางเท้าลง" },
    name: "นั่งเหยียดเข่า",
    icon: "🦵",
    view: "side",
    benefit: "เพิ่มกำลังกล้ามเนื้อต้นขาด้านหน้า ช่วยลดปวดเข่า",
    setup: "นั่งบนเก้าอี้ หลังพิงพนัก ตั้งมือถือด้านข้างลำตัว ให้เห็นสะโพก เข่า และเท้า",
    steps: [
      "นั่งหลังตรง เท้าวางราบกับพื้น",
      "ค่อย ๆ เหยียดเข่าข้างหนึ่งจนขาตรง",
      "ค้างไว้ 2 วินาที",
      "ค่อย ๆ วางเท้าลง แล้วสลับข้าง",
    ],
    metricLabel: "มุมเข่า",
    unit: "°",
    range: [60, 180],
    defaults: { reps: 10, sets: 2, down: 115, up: 150, good: 165 },
    minRepSec: 1.5,
    holdSec: 2,
    required: (lm, side) => [SIDE[side].hip, SIDE[side].knee, SIDE[side].ank],
    sideKeys: ["hip", "knee", "ank"],
    metric(lm, ctx) {
      // ใช้ขาที่เหยียดได้มากกว่า (ให้สลับขาได้)
      const vals = ["L", "R"]
        .filter((s) => visibleAll(lm, [SIDE[s].hip, SIDE[s].knee, SIDE[s].ank], 0.35))
        .map((s) => angle(lm[SIDE[s].hip], lm[SIDE[s].knee], lm[SIDE[s].ank], ctx.aspect));
      if (!vals.length) {
        const s = SIDE[ctx.side];
        return angle(lm[s.hip], lm[s.knee], lm[s.ank], ctx.aspect);
      }
      return Math.max(...vals);
    },
    sideMode: "alternate",
    sideBase: 90,
    sideMetric(lm, ctx) {
      const o = {};
      for (const s of ["L", "R"]) {
        const S = SIDE[s];
        o[s] = visibleAll(lm, [S.hip, S.knee, S.ank], 0.35) ? angle(lm[S.hip], lm[S.knee], lm[S.ank], ctx.aspect) : NaN;
      }
      return o;
    },
    checks: [],
    partialMsg: "เหยียดเข่าให้ตรงอีกนิดครับ",
    holdMsg: "ค้างไว้ก่อนครับ",
    goodMsg: "ดีมากครับ",
  },

  march: {
    id: "march",
    cue: { start: "ยืนตรง มือจับพนักเก้าอี้", go: "ยกเข่าขึ้นสูงเท่าที่ทำได้", back: "วางเท้าลง แล้วเตรียมยกอีกข้าง" },
    name: "ยกเข่าย่ำเท้า",
    icon: "🚶",
    view: "side",
    benefit: "ฝึกการทรงตัวและกล้ามเนื้อสะโพก เตรียมพร้อมสำหรับการเดิน",
    setup: "ยืนข้างโต๊ะหรือพนักเก้าอี้เพื่อจับประคอง ตั้งมือถือด้านข้างลำตัว ให้เห็นทั้งตัว",
    steps: [
      "ยืนตรง มือจับพนักเก้าอี้ไว้",
      "ยกเข่าข้างหนึ่งขึ้นสูงเท่าที่ทำได้",
      "วางเท้าลง แล้วยกอีกข้าง",
      "ทำสลับซ้าย-ขวาช้า ๆ",
    ],
    metricLabel: "การยกสะโพก",
    unit: "°",
    range: [0, 100],
    defaults: { reps: 20, sets: 1, down: 15, up: 40, good: 55 },
    minRepSec: 0.8,
    holdSec: 0,
    required: (lm, side) => [SIDE[side].sh, SIDE[side].hip, SIDE[side].knee],
    sideKeys: ["sh", "hip", "knee"],
    metric(lm, ctx) {
      // องศาที่ยกต้นขาขึ้น = 180 − มุม (ไหล่–สะโพก–เข่า) ใช้ข้างที่ยกสูงกว่า
      const vals = ["L", "R"]
        .filter((s) => visibleAll(lm, [SIDE[s].sh, SIDE[s].hip, SIDE[s].knee], 0.35))
        .map((s) => 180 - angle(lm[SIDE[s].sh], lm[SIDE[s].hip], lm[SIDE[s].knee], ctx.aspect));
      return vals.length ? Math.max(...vals) : NaN;
    },
    sideMode: "alternate",
    sideBase: 0,
    sideMetric(lm, ctx) {
      const o = {};
      for (const s of ["L", "R"]) {
        const S = SIDE[s];
        o[s] = visibleAll(lm, [S.sh, S.hip, S.knee], 0.35) ? 180 - angle(lm[S.sh], lm[S.hip], lm[S.knee], ctx.aspect) : NaN;
      }
      return o;
    },
    checks: [
      {
        key: "trunk",
        msg: "ยืนตัวตรง อย่าเอนตัวครับ",
        when: "top",
        test(lm, ctx) {
          const s = SIDE[ctx.side];
          return angleFromVertical(lm[s.hip], lm[s.sh], ctx.aspect) > 20;
        },
      },
    ],
    partialMsg: "ยกเข่าให้สูงขึ้นอีกนิดครับ",
    goodMsg: "ดีครับ",
  },

  heel_raise: {
    id: "heel_raise",
    cue: { start: "ยืนตรง มือจับพนักเก้าอี้ เท้าราบกับพื้น", go: "ค่อย ๆ เขย่งปลายเท้า ยกส้นเท้าขึ้น", back: "ค่อย ๆ วางส้นเท้าลง" },
    name: "เขย่งปลายเท้า",
    icon: "🦶",
    view: "side",
    benefit: "เพิ่มกำลังน่อง ช่วยการทรงตัวและการเดิน",
    setup: "ยืนจับพนักเก้าอี้ ตั้งมือถือด้านข้าง วางต่ำระดับเข่า ให้เห็นเท้าชัดเจน",
    steps: [
      "ยืนตรง มือจับพนักเก้าอี้",
      "ค่อย ๆ เขย่งปลายเท้า ยกส้นเท้าขึ้นให้สูงที่สุด",
      "ค้างไว้ 1 วินาที",
      "ค่อย ๆ วางส้นเท้าลง",
    ],
    metricLabel: "การยกส้นเท้า",
    unit: "%",
    range: [0, 40],
    defaults: { reps: 10, sets: 2, down: 5, up: 12, good: 18 },
    minRepSec: 1.2,
    holdSec: 1,
    required: (lm, side) => [SIDE[side].ank, SIDE[side].heel, SIDE[side].foot, SIDE[side].knee],
    sideKeys: ["ank", "heel", "foot"],
    metric(lm, ctx) {
      // ความสูงส้นเท้าเทียบปลายเท้า เป็น % ของความยาวหน้าแข้ง แล้วหักค่าตอนยืนปกติ (ปรับเทียบอัตโนมัติ)
      const s = SIDE[ctx.side];
      const shank = dist(lm[s.knee], lm[s.ank], ctx.aspect);
      if (!shank) return NaN;
      const raw = ((lm[s.foot].y - lm[s.heel].y) / shank) * 100;
      const st = ctx.state;
      if (st.hrBase === undefined) st.hrBase = raw;
      if (ctx.phase !== "up") {
        if (raw < st.hrBase) st.hrBase = raw;
        else st.hrBase += (raw - st.hrBase) * 0.004;
      }
      return raw - st.hrBase;
    },
    checks: [],
    partialMsg: "เขย่งให้สูงขึ้นอีกนิดครับ",
    holdMsg: "ค้างไว้ครับ",
    goodMsg: "ดีมากครับ",
  },
};

export const EXERCISE_LIST = Object.values(EXERCISES);

// รวมค่าตั้งต้นของท่ากับค่าที่นักกายภาพปรับให้ผู้ป่วยรายนั้น
export function resolveParams(ex, override = {}) {
  const p = { ...ex.defaults };
  for (const k of ["reps", "sets", "down", "up", "good"]) {
    const v = Number(override[k]);
    if (override[k] !== undefined && override[k] !== "" && Number.isFinite(v)) p[k] = v;
  }
  if (p.up <= p.down) p.up = p.down + 5;
  if (p.good < p.up) p.good = p.up;
  p.reps = Math.max(1, Math.round(p.reps));
  p.sets = Math.max(1, Math.round(p.sets));
  return p;
}

// =============================================================
//  ตัวนับครั้ง (State machine)
//  down ──(ค่า ≥ up)──▶ up ──(ค่า ≤ down)──▶ down  = 1 ครั้ง
// =============================================================
export class RepCounter {
  constructor(ex, params, opts = {}) {
    this.ex = ex;
    this.p = params;
    this.smooth = opts.smooth ?? 0.45; // ทำให้ค่าเรียบ ลดการกระตุก
    this.skip = new Set(opts.skipChecks || []); // ข้อที่ไม่นับเป็นความผิด (เช่น แขนไม่เท่ากันในผู้ป่วยอัมพฤกษ์)
    this.reset();
  }

  reset() {
    this.phase = "down";
    this.reps = 0;
    this.goodReps = 0;
    this.value = NaN;
    this.peak = -Infinity;
    this.upAt = 0;
    this.downAt = 0;
    this.holdDone = this.ex.holdSec === 0;
    this.attemptPeak = -Infinity;
    this.cycleStart = null;
    this.repStart = 0;
    this.flagFrames = {};
    this.topFrames = 0;
    this.issues = {}; // นับข้อผิดพลาดตลอดเซสชัน
    this.sideStats = { L: { reps: 0, sum: 0, max: 0 }, R: { reps: 0, sum: 0, max: 0 } };
    this.sidePeak = { L: -Infinity, R: -Infinity };
    this.state = {};
    this.side = null;
    this.lostSince = null;
  }

  // ป้อนจุดร่างกาย 1 เฟรม → คืนรายการเหตุการณ์ให้หน้าจอแสดง/พูด
  update(lm, t, aspect = 1) {
    const events = [];
    if (!lm) {
      if (this.lostSince === null) this.lostSince = t;
      if (t - this.lostSince > 1500) events.push({ type: "lost" });
      return events;
    }
    const ex = this.ex;
    if (ex.view === "side") {
      if (!this.side || this.reps === 0) this.side = pickSide(lm, ex.sideKeys || ["hip", "knee", "ank"]);
    } else this.side = "L";

    const req = ex.required(lm, this.side);
    if (!visibleAll(lm, req, 0.45)) {
      if (this.lostSince === null) this.lostSince = t;
      if (t - this.lostSince > 1500) events.push({ type: "lost" });
      return events;
    }
    this.lostSince = null;

    const ctx = { side: this.side, aspect, state: this.state, phase: this.phase, extra: null };
    const raw = ex.metric(lm, ctx);
    if (!Number.isFinite(raw)) return events;
    this.value = Number.isFinite(this.value) ? this.value + (raw - this.value) * this.smooth : raw;
    const v = this.value;
    const { up, down, good } = this.p;

    if (this.phase === "down") {
      if (v > this.attemptPeak) this.attemptPeak = v;
      if (v > down && this.cycleStart === null) this.cycleStart = t;
      if (v <= down) this.cycleStart = null;
      if (v >= up) {
        this.phase = "up";
        this.upAt = t;
        this.repStart = this.cycleStart ?? t;
        this.peak = v;
        this.holdDone = ex.holdSec === 0;
        this.flagFrames = {};
        this.topFrames = 0;
        this.sidePeak = { L: -Infinity, R: -Infinity };
        events.push({ type: "reached" });
        if (!this.holdDone && ex.holdMsg) events.push({ type: "hold", msg: ex.holdMsg });
      } else if (v <= down && this.attemptPeak > down + (up - down) * 0.55) {
        // ทำไปเกินครึ่งทาง แต่ยังไม่ถึง แล้วกลับลงมา
        events.push({ type: "partial", msg: ex.partialMsg });
        this.issues.partial = (this.issues.partial || 0) + 1;
        this.attemptPeak = -Infinity;
      } else if (v <= down) {
        this.attemptPeak = -Infinity;
      }
    } else {
      // phase === "up"
      if (v > this.peak) this.peak = v;
      this.topFrames++;
      if (ex.sideMetric) {
        const sv = ex.sideMetric(lm, ctx);
        for (const k of ["L", "R"]) if (Number.isFinite(sv[k]) && sv[k] > this.sidePeak[k]) this.sidePeak[k] = sv[k];
      }
      for (const c of ex.checks) {
        if (c.test(lm, { ...ctx, extra: ctx.extra })) this.flagFrames[c.key] = (this.flagFrames[c.key] || 0) + 1;
      }
      if (!this.holdDone && (t - this.upAt) / 1000 >= ex.holdSec) {
        this.holdDone = true;
        events.push({ type: "holdDone" });
      }
      if (v <= down) {
        const dur = (t - this.repStart) / 1000;
        if (!this.holdDone) {
          events.push({ type: "partial", msg: ex.holdMsg ? "ค้างไว้นานอีกนิดนะครับ" : ex.partialMsg });
          this.issues.hold = (this.issues.hold || 0) + 1;
        } else {
          this.reps++;
          const problems = [];
          if (this.peak < good) problems.push({ key: "range", msg: ex.partialMsg });
          for (const c of ex.checks) {
            if (this.skip.has(c.key)) continue;
            if ((this.flagFrames[c.key] || 0) >= Math.max(2, this.topFrames * 0.3)) problems.push({ key: c.key, msg: c.msgFn ? c.msgFn({ ...ctx, peaks: this.sidePeak }) : c.msg });
          }
          // บันทึกผลแยกซ้าย-ขวา
          let side = null;
          if (ex.sideMetric) {
            const sp = this.sidePeak;
            const sides = ex.sideMode === "both" ? ["L", "R"] : [sp.L >= sp.R ? "L" : "R"];
            if (ex.sideMode !== "both") side = sides[0];
            for (const k of sides) {
              if (!Number.isFinite(sp[k])) continue;
              const st = this.sideStats[k];
              st.reps++;
              st.sum += sp[k];
              st.max = Math.max(st.max, sp[k]);
            }
          }
          if (dur < ex.minRepSec) problems.push({ key: "fast", msg: "ทำช้า ๆ ได้เลยครับ ไม่ต้องรีบ" });
          for (const pr of problems) this.issues[pr.key] = (this.issues[pr.key] || 0) + 1;
          const isGood = problems.length === 0;
          if (isGood) this.goodReps++;
          events.push({ type: "rep", reps: this.reps, good: isGood, problems, peak: Math.round(this.peak), side });
        }
        this.phase = "down";
        this.downAt = t;
        this.attemptPeak = -Infinity;
        this.cycleStart = null;
      }
    }
    return events;
  }

  // สรุปผลแยกซ้าย-ขวาของเซสชัน: { L: {reps, avg, max}, R: {...} } หรือ null
  sideSummary() {
    if (!this.ex.sideMetric) return null;
    const o = {};
    for (const k of ["L", "R"]) {
      const st = this.sideStats[k];
      o[k] = { reps: st.reps, avg: st.reps ? Math.round(st.sum / st.reps) : null, max: st.reps ? Math.round(st.max) : null };
    }
    return o;
  }

  // ระดับความคืบหน้า 0–1 สำหรับแถบแสดงผล
  progress() {
    const { down, good } = this.p;
    if (!Number.isFinite(this.value)) return 0;
    return Math.max(0, Math.min(1, (this.value - down) / (good - down)));
  }
}

// =============================================================
//  ตัวตรวจการล้ม
//  ล้ม = (สะโพกตกลงเร็ว แล้วลำตัวอยู่แนวนอนเกิน 1 วินาที)
//     หรือ (สะโพกตกลงเร็ว แล้วหายไปจากกล้องเกิน 4 วินาที)
//     หรือ (ลำตัวอยู่แนวนอนต่อเนื่องเกิน 4 วินาที)
// =============================================================
export class FallDetector {
  constructor(opts = {}) {
    this.dropThresh = opts.dropThresh ?? 0.18; // สะโพกตกลง ≥ 18% ของความสูงภาพ
    this.dropWindow = opts.dropWindow ?? 900; // ภายใน 0.9 วินาที
    this.horizDeg = opts.horizDeg ?? 60;
    this.reset();
  }

  reset() {
    this.hist = []; // {t, hipY}
    this.lastDropAt = -Infinity;
    this.horizSince = null;
    this.lostSince = null;
    this.lostAfterDrop = false;
    this.triggered = false;
  }

  update(lm, t, aspect = 1) {
    if (this.triggered) return null;
    const hasBody =
      lm && visibleAll(lm, [LM.L_SHOULDER, LM.R_SHOULDER], 0.3) && (vis(lm[LM.L_HIP]) > 0.3 || vis(lm[LM.R_HIP]) > 0.3);

    if (!hasBody) {
      if (this.lostSince === null) {
        this.lostSince = t;
        this.lostAfterDrop = t - this.lastDropAt < 3000;
      }
      if (this.lostAfterDrop && t - this.lostSince > 4000) return this._fire("lost_after_drop");
      this.horizSince = null;
      return null;
    }
    this.lostSince = null;

    const sh = mid(lm[LM.L_SHOULDER], lm[LM.R_SHOULDER]);
    const hip = vis(lm[LM.L_HIP]) > 0.3 && vis(lm[LM.R_HIP]) > 0.3 ? mid(lm[LM.L_HIP], lm[LM.R_HIP]) : vis(lm[LM.L_HIP]) > 0.3 ? lm[LM.L_HIP] : lm[LM.R_HIP];

    this.hist.push({ t, y: hip.y });
    while (this.hist.length && t - this.hist[0].t > this.dropWindow) this.hist.shift();
    const minY = Math.min(...this.hist.map((h) => h.y));
    if (hip.y - minY >= this.dropThresh) this.lastDropAt = t;

    const torso = angleFromVertical(hip, sh, aspect);
    if (torso >= this.horizDeg) {
      if (this.horizSince === null) this.horizSince = t;
      const horizFor = t - this.horizSince;
      if (horizFor >= 1000 && t - this.lastDropAt < 3500) return this._fire("drop_then_horizontal");
      if (horizFor >= 4000) return this._fire("horizontal");
    } else this.horizSince = null;
    return null;
  }

  _fire(reason) {
    this.triggered = true;
    return { type: "fall", reason };
  }
}

export const PAIN_LABEL = { none: "ไม่มีอาการ", mild: "เจ็บเล็กน้อย", severe: "เจ็บมาก/เวียนศีรษะ" };
export const ISSUE_LABEL = {
  range: "ทำไม่สุดองศา",
  partial: "ทำไม่ถึงท่า",
  hold: "ค้างไม่ครบเวลา",
  fast: "ทำเร็วเกินไป",
  trunk: "ลำตัวเอียง/ไม่ตรง",
  elbow: "ศอกงอ",
  symmetry: "แขนสองข้างไม่เท่ากัน",
};
