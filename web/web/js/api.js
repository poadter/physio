// =============================================================
//  api.js — คุยกับเซิร์ฟเวอร์ (Google Apps Script)
//  ถ้ายังไม่ตั้งค่า API_URL จะทำงานแบบ "โหมดทดลอง" เก็บข้อมูลในเครื่อง
// =============================================================
import { EXERCISES } from "./pose-engine.js";

const CFG = window.APP_CONFIG || {};
export const DEMO = !CFG.API_URL;

// ---------- ที่เก็บข้อมูลในเครื่อง ----------
export const store = {
  get(k, d = null) {
    try {
      const v = localStorage.getItem(k);
      return v === null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
  },
  del(k) {
    try { localStorage.removeItem(k); } catch {}
  },
};

export function getDevice() {
  return store.get("device"); // {patientId, token, name}
}
export function setDevice(d) {
  store.set("device", d);
}
export function clearDevice() {
  store.del("device");
  store.del("cache_patient");
}

export class ApiError extends Error {
  constructor(msg, network = false) {
    super(msg);
    this.network = network;
  }
}

// ---------- เรียกเซิร์ฟเวอร์ ----------
async function remote(action, data = {}) {
  let res;
  try {
    res = await fetch(CFG.API_URL, {
      method: "POST",
      // ใช้ text/plain เพื่อไม่ให้เบราว์เซอร์ส่งคำขอ preflight (Apps Script ไม่รองรับ)
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, ...data }),
      redirect: "follow",
    });
  } catch (e) {
    throw new ApiError("เชื่อมต่ออินเทอร์เน็ตไม่ได้", true);
  }
  let json;
  try {
    json = await res.json();
  } catch {
    throw new ApiError("เซิร์ฟเวอร์ตอบกลับผิดรูปแบบ (ตรวจลิงก์ API_URL และการ Deploy)", true);
  }
  if (!json.ok) throw new ApiError(json.error || "เกิดข้อผิดพลาด");
  return json.data;
}

function withPatient(data) {
  const d = getDevice();
  if (!d) throw new ApiError("เครื่องนี้ยังไม่ได้ลงทะเบียน");
  return { patientId: d.patientId, token: d.token, ...data };
}

// ---------- โหมดทดลอง ----------
const DEMO_PLAN = {
  exercises: [
    { id: "sit_to_stand", reps: 5, sets: 1 },
    { id: "arm_raise", reps: 5, sets: 1 },
    { id: "knee_extension", reps: 5, sets: 1 },
    { id: "march", reps: 10, sets: 1 },
    { id: "heel_raise", reps: 5, sets: 1 },
  ],
  restSec: 20,
};
function todayKey(d = new Date()) {
  return d.toLocaleDateString("sv-SE"); // yyyy-mm-dd ตามเวลาเครื่อง
}
const demo = {
  "patient.get"() {
    const sessions = store.get("demo_sessions", []);
    const today = sessions.filter((s) => new Date(s.at).toLocaleDateString("sv-SE") === todayKey());
    return {
      patient: { id: "DEMO", name: store.get("demo_name", "ผู้ทดลองใช้"), plan: DEMO_PLAN },
      today,
      family: [],
      lineReady: false,
    };
  },
  "patient.saveSession"({ session }) {
    const all = store.get("demo_sessions", []);
    all.push({ ...session, at: new Date().toISOString() });
    store.set("demo_sessions", all.slice(-300));
    return { saved: true };
  },
  "patient.alert"({ type }) {
    return { notified: 0, demo: true, type };
  },
  "patient.linkCode"() {
    return { code: "000000", expiresAt: new Date(Date.now() + 600000).toISOString(), demo: true };
  },
  "patient.history"() {
    return { sessions: store.get("demo_sessions", []) };
  },
  "patient.familyAction"() {
    return {};
  },
};

export async function api(action, data = {}) {
  if (DEMO) {
    if (demo[action]) return demo[action](data);
    throw new ApiError("โหมดทดลอง: ฟังก์ชันนี้ต้องตั้งค่าเซิร์ฟเวอร์ก่อน");
  }
  if (action.startsWith("patient.")) data = withPatient(data);
  if (action.startsWith("admin.")) data = { pin: sessionStorage.getItem("adminPin") || "", ...data };
  return remote(action, data);
}

// ---------- คิวส่งข้อมูลย้อนหลัง (กรณีเน็ตหลุดระหว่างฝึก) ----------
export async function saveSession(session) {
  try {
    await api("patient.saveSession", { session });
    return { queued: false };
  } catch (e) {
    if (e.network) {
      const q = store.get("pending_sessions", []);
      q.push(session);
      store.set("pending_sessions", q);
      return { queued: true };
    }
    throw e;
  }
}

export async function flushQueue() {
  const q = store.get("pending_sessions", []);
  if (!q.length || DEMO) return 0;
  const rest = [];
  let sent = 0;
  for (const s of q) {
    try {
      await api("patient.saveSession", { session: s });
      sent++;
    } catch (e) {
      if (e.network) rest.push(s);
    }
  }
  store.set("pending_sessions", rest);
  return sent;
}

// แผนการฝึกของผู้ป่วย → รายการท่าพร้อมชื่อ
export function planItems(plan) {
  const list = (plan && plan.exercises) || [];
  return list.filter((x) => EXERCISES[x.id]).map((x) => ({ ...x, ex: EXERCISES[x.id] }));
}
