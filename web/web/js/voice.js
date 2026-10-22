// เสียงพูดภาษาไทย (ใช้เสียงที่มีในเครื่อง ไม่ต้องต่ออินเทอร์เน็ต)
const THAI_NUM = ["ศูนย์", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า", "สิบ"];

export function thaiNumber(n) {
  n = Math.round(n);
  if (n <= 10) return THAI_NUM[n] ?? String(n);
  if (n < 100) {
    const t = Math.floor(n / 10), u = n % 10;
    const tens = t === 1 ? "สิบ" : t === 2 ? "ยี่สิบ" : THAI_NUM[t] + "สิบ";
    return tens + (u === 0 ? "" : u === 1 ? "เอ็ด" : THAI_NUM[u]);
  }
  return String(n);
}

class Voice {
  constructor() {
    this.enabled = localStorage.getItem("voice") !== "off";
    this.voice = null;
    this.last = {};
    this.busyUntil = 0;
    this.supported = "speechSynthesis" in window;
    if (this.supported) {
      const pick = () => {
        const vs = speechSynthesis.getVoices();
        this.voice = vs.find((v) => v.lang === "th-TH") || vs.find((v) => v.lang?.startsWith("th")) || null;
      };
      pick();
      speechSynthesis.onvoiceschanged = pick;
    }
  }
  setEnabled(on) {
    this.enabled = on;
    try { localStorage.setItem("voice", on ? "on" : "off"); } catch {}
    if (!on && this.supported) speechSynthesis.cancel();
  }
  // ต้องเรียกตอนผู้ใช้กดปุ่มครั้งแรก (iPhone บังคับ)
  unlock() {
    if (!this.supported) return;
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    speechSynthesis.speak(u);
  }
  /**
   * @param {string} text
   * @param {{priority?: boolean, key?: string, gap?: number}} opt
   *   priority = ตัดเสียงอื่นแล้วพูดทันที, key+gap = ไม่พูดข้อความเดิมซ้ำภายใน gap มิลลิวินาที
   */
  say(text, opt = {}) {
    if (!this.enabled || !this.supported || !text) return;
    const now = Date.now();
    const key = opt.key || text;
    if (opt.gap && this.last[key] && now - this.last[key] < opt.gap) return;
    if (!opt.priority && now < this.busyUntil) return;
    this.last[key] = now;
    if (opt.priority) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "th-TH";
    if (this.voice) u.voice = this.voice;
    u.rate = 0.95;
    this.busyUntil = now + Math.min(3500, 300 + text.length * 90);
    speechSynthesis.speak(u);
  }
  count(n) {
    this.say(thaiNumber(n), { priority: true });
  }
}

export const voice = new Voice();
