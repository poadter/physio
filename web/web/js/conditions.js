// =============================================================
//  conditions.js — โปรแกรมฝึกเริ่มต้นตามโรค/ภาวะ
//  เป็น "จุดเริ่มต้น" ให้นักกายภาพปรับต่อรายบุคคล ไม่ใช่แนวทางการรักษา
//  ค่าองศา: down = ท่าเริ่ม, up = นับเมื่อถึง, good = ทำได้สมบูรณ์
// =============================================================
export const CONDITIONS = {
  stroke: {
    id: "stroke",
    name: "โรคหลอดเลือดสมอง (อัมพฤกษ์ครึ่งซีก)",
    short: "Stroke",
    needsSide: true,
    warningCheck: true, // ถามสัญญาณเตือนสโตรคก่อนฝึกทุกครั้ง
    skipChecks: ["symmetry"], // แขนสองข้างไม่เท่ากันเป็นเรื่องปกติของโรค ไม่นับเป็นทำผิด
    plan: {
      restSec: 60,
      exercises: [
        { id: "sit_to_stand", reps: 5, sets: 2, down: 110, up: 145, good: 160 },
        { id: "arm_raise", reps: 8, sets: 2, down: 40, up: 90, good: 120 },
        { id: "knee_extension", reps: 8, sets: 2, down: 115, up: 140, good: 155 },
        { id: "march", reps: 10, sets: 1, down: 15, up: 28, good: 40 },
      ],
    },
    precautions: [
      "ต้องมีญาติหรือผู้ดูแลอยู่ข้าง ๆ ทุกครั้ง โดยเฉพาะท่ายืน และยืนด้านข้างที่อ่อนแรง",
      "แขนข้างอ่อนแรง: ยกเท่าที่ไม่ปวด ห้ามดึงหรือกระชากแขน เสี่ยงข้อไหล่เคลื่อนและปวดไหล่",
      "ท่ายืนให้จับพนักเก้าอี้หรือราวที่มั่นคงด้วยมือข้างปกติ",
      "หยุดทันทีถ้าเหนื่อยมาก ใจสั่น เวียนศีรษะ หรือแขนขาอ่อนแรงมากขึ้น",
    ],
  },
  knee_oa: {
    id: "knee_oa",
    name: "ข้อเข่าเสื่อม",
    short: "เข่าเสื่อม",
    needsSide: true,
    plan: {
      restSec: 30,
      exercises: [
        { id: "knee_extension", reps: 10, sets: 2, down: 115, up: 145, good: 160 },
        { id: "sit_to_stand", reps: 8, sets: 2, down: 110, up: 150, good: 160 },
        { id: "heel_raise", reps: 10, sets: 2 },
      ],
    },
    precautions: ["ปวดเล็กน้อยระหว่างฝึกพอรับได้ ถ้าปวดมากขึ้นหลังฝึกเกิน 2 ชั่วโมง ให้ลดจำนวนครั้ง", "ใช้เก้าอี้ที่สูงพอ ไม่ต้องย่อเข่ามาก"],
  },
  tkr: {
    id: "tkr",
    name: "หลังผ่าตัดเปลี่ยนข้อเข่า",
    short: "เปลี่ยนข้อเข่า",
    needsSide: true,
    plan: {
      restSec: 45,
      exercises: [
        { id: "knee_extension", reps: 10, sets: 3, down: 120, up: 140, good: 155 },
        { id: "sit_to_stand", reps: 5, sets: 2, down: 110, up: 145, good: 160 },
      ],
    },
    precautions: ["ปฏิบัติตามข้อจำกัดของแพทย์ผู้ผ่าตัด", "ค่อย ๆ เพิ่มองศาทีละสัปดาห์ตามการประเมิน", "สังเกตแผล บวม แดง ร้อน มีไข้ ให้ติดต่อโรงพยาบาล"],
  },
  frozen_shoulder: {
    id: "frozen_shoulder",
    name: "ข้อไหล่ติด",
    short: "ไหล่ติด",
    needsSide: true,
    skipChecks: ["symmetry"],
    plan: { restSec: 30, exercises: [{ id: "arm_raise", reps: 10, sets: 3, down: 40, up: 100, good: 130 }] },
    precautions: ["ยกช้า ๆ ถึงจุดตึง ไม่กระชาก", "ประคบอุ่นก่อนฝึกช่วยให้ยกได้ง่ายขึ้น"],
  },
  fall_risk: {
    id: "fall_risk",
    name: "ผู้สูงอายุเสี่ยงล้ม",
    short: "เสี่ยงล้ม",
    plan: {
      restSec: 45,
      exercises: [
        { id: "sit_to_stand", reps: 8, sets: 2 },
        { id: "heel_raise", reps: 10, sets: 2 },
        { id: "march", reps: 16, sets: 1 },
      ],
    },
    precautions: ["จับพนักเก้าอี้ที่มั่นคงทุกท่าที่ยืน", "ฝึกบนพื้นไม่ลื่น ใส่รองเท้าหรือเท้าเปล่า ไม่ใส่ถุงเท้า"],
  },
  general: {
    id: "general",
    name: "ทั่วไป / อื่น ๆ",
    short: "ทั่วไป",
    plan: { restSec: 30, exercises: [{ id: "sit_to_stand", reps: 10, sets: 2 }, { id: "arm_raise", reps: 10, sets: 2 }] },
    precautions: [],
  },
};

export const CONDITION_LIST = Object.values(CONDITIONS);
export const SIDE_LABEL = { L: "ซ้าย", R: "ขวา", "": "-" };

export function conditionOf(p) {
  return CONDITIONS[p?.condition] || CONDITIONS.general;
}

// สัดส่วนการเคลื่อนไหวของข้างอ่อนแรงเทียบข้างปกติ (%)
// base = องศาตอนอยู่นิ่ง เช่น นั่งงอเข่า 90° → วัดเฉพาะช่วงที่ขยับได้จริง
export function symmetryPct(sides, affected, base = 0) {
  if (!sides || !affected) return null;
  const other = affected === "L" ? "R" : "L";
  const a = sides[affected]?.avg, b = sides[other]?.avg;
  if (a == null || b == null || b - base <= 0) return null;
  return Math.max(0, Math.round(((a - base) / (b - base)) * 100));
}
