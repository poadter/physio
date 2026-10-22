// =============================================================
//  ตั้งค่าระบบ PhysioAI — แก้ไฟล์นี้ไฟล์เดียว
// =============================================================
window.APP_CONFIG = {
  // ใส่ลิงก์ Web App ของ Google Apps Script (ลงท้ายด้วย /exec)
  // ถ้าเว้นว่างไว้ ระบบจะทำงานใน "โหมดทดลอง" (ฝึกท่าได้ แต่ไม่บันทึกขึ้นเซิร์ฟเวอร์และไม่ส่ง LINE)
  API_URL: "",

  // ชื่อที่แสดงบนแอป
  APP_NAME: "กายภาพ AI",
  ORG_NAME: "หน่วยกายภาพบำบัด",

  // ไลบรารี AI (ปกติไม่ต้องแก้)
  MEDIAPIPE_VERSION: "0.10.14",
  POSE_MODEL_URL:
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",

  // เวลานับถอยหลังก่อนแจ้งญาติเมื่อตรวจพบการล้ม (วินาที)
  FALL_CONFIRM_SECONDS: 20,
};
