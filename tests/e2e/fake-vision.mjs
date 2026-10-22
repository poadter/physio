// แทนที่ MediaPipe ตอนทดสอบ: ส่งโครงร่างคนทำท่าลุก-นั่ง รอบละ 4 วินาที
const ASPECT = 640 / 480;
function body(knee) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.95 }));
  const K = { x: 0.5, y: 0.7 }, A = { x: 0.5, y: 0.9 };
  const r = (knee * Math.PI) / 180;
  const H = { x: K.x + 0.15 * Math.sin(r), y: K.y + 0.15 * Math.cos(r) };
  const S = { x: H.x, y: H.y - 0.25 };
  const put = (i, p) => Object.assign(lm[i], { x: 0.5 + (p.x - 0.5) / ASPECT, y: p.y });
  [[23, H], [24, H], [25, K], [26, K], [27, A], [28, A], [11, S], [12, S], [13, S], [14, S]].forEach(([i, p]) => put(i, p));
  [24, 26, 28].forEach((i) => (lm[i].visibility = 0.4));
  return lm;
}
export const FilesetResolver = { forVisionTasks: async () => ({}) };
export const PoseLandmarker = {
  createFromOptions: async () => ({
    detectForVideo(v, t) {
      const ph = (t % 4000) / 4000; // 0→0.5 ลุกขึ้น, 0.5→1 นั่งลง
      const k = ph < 0.5 ? 90 + 85 * Math.sin(ph * Math.PI) : 90 + 85 * Math.sin(ph * Math.PI);
      return { landmarks: [body(k)] };
    },
  }),
};
