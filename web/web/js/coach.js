// =============================================================
//  coach.js — โหมดเรียนท่า: สอนผู้ป่วยทีละขั้นด้วยเสียง
//  ขั้นที่ 1 ตั้งกล้อง → 2 ท่าเริ่มต้น → 3 ลองทำทีละครั้ง (ผ่านเมื่อทำถูกครบ goal ครั้ง)
//  ไม่ยุ่งกับหน้าจอ: คืนข้อความที่ต้องแสดงและพูด ให้ exercise.js เป็นคนแสดง
// =============================================================
import { LM, vis, dist, mid } from "./pose-engine.js";

export const STAGES = ["ตั้งกล้อง", "ท่าเริ่มต้น", "ลองทำ"];

// ตรวจว่าผู้ป่วยหันถูกด้าน: ด้านข้าง = ไหล่สองข้างซ้อนกัน, ด้านหน้า = เห็นไหล่กว้าง
export function facing(lm, aspect = 1) {
  const ls = lm[LM.L_SHOULDER], rs = lm[LM.R_SHOULDER], lh = lm[LM.L_HIP], rh = lm[LM.R_HIP];
  if (![ls, rs, lh, rh].every((p) => vis(p) > 0.3)) return null;
  const torso = dist(mid(ls, rs), mid(lh, rh), aspect);
  if (!torso) return null;
  const r = dist(ls, rs, aspect) / torso;
  return r < 0.35 ? "side" : r > 0.5 ? "front" : "between";
}

export class Coach {
  constructor(ex, params, opts = {}) {
    this.ex = ex;
    this.p = params;
    this.goal = opts.goal ?? 3;
    this.maxAttempts = opts.maxAttempts ?? 6;
    this.stage = 0;
    this.okSince = null;
    this.good = 0;
    this.attempts = 0;
    this.tips = {};
    this.best = -Infinity;
    this.lastBestAt = 0;
    this.finished = null;
    this.started = false;
  }

  // คืน { stage, title, text, kind, say: [[ข้อความ, ตัวเลือก]], finished }
  update(lm, t, aspect, events, counter) {
    const ex = this.ex, cue = ex.cue || {};
    const out = { say: [], kind: "" };
    if (!this.started) {
      this.started = true;
      out.say.push([`ขั้นแรก ตั้งกล้อง ${ex.view === "side" ? "หันข้างเข้าหากล้อง" : "หันหน้าเข้าหากล้อง"} ให้เห็นทั้งตัวครับ`, { priority: true }]);
    }
    if (this.finished) return { ...this.ui(), finished: this.finished, say: [] };

    // ---------- ขั้นที่ 1: ตั้งกล้อง ----------
    if (this.stage === 0) {
      const lost = events.some((e) => e.type === "lost") || !lm || counter.lostSince !== null || !Number.isFinite(counter.value);
      const f = lm ? facing(lm, aspect) : null;
      const wrongWay = f && f !== "between" && f !== ex.view;
      if (lost) {
        this.okSince = null;
        this.text = "ถอยให้กล้องเห็นตั้งแต่ศีรษะถึงเท้า";
        out.kind = "warn";
        out.say.push(["ถอยห่างจากกล้องอีกนิด ให้เห็นทั้งตัวครับ", { key: "c_lost", gap: 7000 }]);
      } else if (wrongWay) {
        this.okSince = null;
        this.text = ex.view === "side" ? "หันข้างเข้าหากล้อง" : "หันหน้าเข้าหากล้อง";
        out.kind = "warn";
        out.say.push([ex.view === "side" ? "หันข้างให้กล้องครับ" : "หันหน้าเข้าหากล้องครับ", { key: "c_face", gap: 6000 }]);
      } else {
        if (this.okSince === null) this.okSince = t;
        this.text = "เห็นทั้งตัวแล้ว อยู่นิ่ง ๆ สักครู่…";
        if (t - this.okSince > 1500) {
          this.stage = 1;
          this.okSince = null;
          this.text = cue.start;
          out.say.push([`ดีมากครับ ขั้นที่สอง ท่าเริ่มต้น ${cue.start}`, { priority: true }]);
        }
      }
      return { ...this.ui(), ...out };
    }

    // ---------- ขั้นที่ 2: อยู่ในท่าเริ่มต้นนิ่ง ๆ ----------
    if (this.stage === 1) {
      const v = counter.value;
      if (Number.isFinite(v) && v <= this.p.down && counter.lostSince === null) {
        if (this.okSince === null) this.okSince = t;
        this.text = "ท่าเริ่มต้นถูกต้อง อยู่นิ่ง ๆ…";
        out.kind = "good";
        if (t - this.okSince > 1200) {
          this.stage = 2;
          this.text = cue.go;
          this.lastBestAt = t;
          this.best = v;
          out.say.push([`ถูกต้องครับ ขั้นที่สาม ลองทำทีละครั้ง ${cue.go}`, { priority: true }]);
        }
      } else {
        this.okSince = null;
        this.text = cue.start;
        out.say.push([cue.start, { key: "c_start", gap: 7000 }]);
      }
      return { ...this.ui(), ...out };
    }

    // ---------- ขั้นที่ 3: ลองทำ ----------
    const v = counter.value;
    if (counter.phase === "down" && Number.isFinite(v)) {
      if (v > this.best + 2) {
        this.best = v;
        this.lastBestAt = t;
      }
      // ขยับไปแล้วแต่ค้างอยู่กลางทาง → ให้กำลังใจ
      if (v > this.p.down + 5 && v < this.p.up && t - this.lastBestAt > 2500) {
        out.say.push(["อีกนิดครับ " + ex.partialMsg, { key: "c_more", gap: 4500 }]);
        this.text = "อีกนิด… " + ex.partialMsg;
        out.kind = "warn";
      }
    }
    for (const e of events) {
      if (e.type === "lost") {
        this.text = "ถอยให้กล้องเห็นทั้งตัว";
        out.kind = "warn";
        out.say.push(["ถอยให้กล้องเห็นทั้งตัวครับ", { key: "c_lost", gap: 7000 }]);
      } else if (e.type === "reached") {
        this.text = ex.holdSec ? `ถึงแล้ว ค้างไว้ ${ex.holdSec} วินาที` : "ถึงแล้ว " + cue.back;
        out.kind = "good";
        out.say.push([ex.holdSec ? "ถึงแล้วครับ ค้างไว้" : "ถึงแล้วครับ " + cue.back, { priority: true }]);
      } else if (e.type === "holdDone") {
        this.text = cue.back;
        out.kind = "good";
        out.say.push([cue.back, { priority: true }]);
      } else if (e.type === "partial") {
        this.attempts++;
        this.tips[e.msg] = (this.tips[e.msg] || 0) + 1;
        this.text = e.msg;
        out.kind = "warn";
        out.say.push([e.msg + " ลองใหม่ครับ", { priority: true }]);
        this.resetTry(t, v);
      } else if (e.type === "rep") {
        this.attempts++;
        if (e.good) {
          this.good++;
          this.text = `ถูกต้อง! ผ่าน ${this.good}/${this.goal}`;
          out.kind = "good";
          out.say.push([this.good >= this.goal ? "ถูกต้องครับ ผ่านแล้ว เก่งมาก" : `ถูกต้องครับ ผ่าน ${this.good} ครั้ง ${cue.go}`, { priority: true }]);
        } else {
          const m = e.problems[0].msg;
          for (const p of e.problems) this.tips[p.msg] = (this.tips[p.msg] || 0) + 1;
          this.text = m;
          out.kind = "warn";
          out.say.push([`เกือบแล้วครับ ${m} ลองใหม่อีกครั้ง`, { priority: true }]);
        }
        this.resetTry(t, v);
      }
    }
    if (this.good >= this.goal || this.attempts >= this.maxAttempts) {
      const tips = Object.entries(this.tips).sort((a, b) => b[1] - a[1]).map(([m]) => m);
      this.finished = { passed: this.good >= this.goal, good: this.good, attempts: this.attempts, tips };
      if (!this.finished.passed) out.say.push(["วันนี้ฝึกเรียนท่าพอแค่นี้ก่อนครับ ลองดูคำแนะนำแล้วเรียนอีกครั้ง", { priority: true }]);
    }
    return { ...this.ui(), ...out, finished: this.finished };
  }

  resetTry(t, v) {
    this.best = Number.isFinite(v) ? v : -Infinity;
    this.lastBestAt = t;
  }

  ui() {
    return {
      stage: this.stage,
      title: `ขั้นที่ ${this.stage + 1}/3: ${STAGES[this.stage]}`,
      text: this.text || "",
      good: this.good,
      goal: this.goal,
    };
  }
}

// จำว่าผู้ป่วยเคยเรียนท่าไหนผ่านแล้ว (เก็บในเครื่อง)
export function isLearned(id) {
  try {
    return !!JSON.parse(localStorage.getItem("learned") || "{}")[id];
  } catch {
    return false;
  }
}
export function markLearned(id) {
  try {
    const o = JSON.parse(localStorage.getItem("learned") || "{}");
    o[id] = new Date().toISOString();
    localStorage.setItem("learned", JSON.stringify(o));
  } catch {}
}
