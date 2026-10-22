// แทนที่ MediaPipe ตอนทดสอบ: ส่งโครงร่างคนทำท่าลุก-นั่ง รอบละ 5 วินาที
const ASPECT = 640 / 480;
export function body(knee) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.95 }));
  const K = { x: 0.5, y: 0.7 }, A = { x: 0.5, y: 0.9 };
  const r = (knee * Math.PI) / 180;
  const H = { x: K.x + 0.15 * Math.sin(r), y: K.y + 0.15 * Math.cos(r) };
  const S = { x: H.x, y: H.y - 0.25 };
  const put = (i, p) => Object.assign(lm[i], { x: 0.5 + (p.x - 0.5) / ASPECT, y: p.y });
  [[23, H], [24, H], [25, K], [26, K], [27, A], [28, A], [11, S], [12, S]].forEach(([i, p]) => put(i, p));
  // แขน: ยกพร้อมจังหวะลุกยืน ซ้ายยกได้ 160° ขวา (ข้างอ่อนแรง) 100°
  const u = (knee - 90) / 85;
  for (const [el, wr, deg] of [[13, 15, 10 + 150 * u], [14, 16, 10 + 90 * u]]) {
    const r = (deg * Math.PI) / 180;
    put(el, { x: S.x + 0.12 * Math.sin(r), y: S.y + 0.12 * Math.cos(r) });
    put(wr, { x: S.x + 0.22 * Math.sin(r), y: S.y + 0.22 * Math.cos(r) });
  }
  [26, 28].forEach((i) => (lm[i].visibility = 0.4));
  return lm;
}
export const FilesetResolver = { forVisionTasks: async () => ({}) };
export const PoseLandmarker = {
  createFromOptions: async () => ({
    detectForVideo(v, t) {
      // รอบละ 5 วินาที: นั่ง 1.5 วิ → ลุก 1.2 วิ → ยืน 0.8 วิ → นั่งลง 1.2 วิ → นั่ง 0.3 วิ
      const ms = t % 5000;
      const ease = (u) => u * u * (3 - 2 * u);
      const k = ms < 1500 ? 90 : ms < 2700 ? 90 + 85 * ease((ms - 1500) / 1200) : ms < 3500 ? 175 : ms < 4700 ? 175 - 85 * ease((ms - 3500) / 1200) : 90;
      return { landmarks: [body(k)] };
    },
  }),
};
