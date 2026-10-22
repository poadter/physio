// =============================================================
//  demo-figure.js — ตัวการ์ตูนเส้นสาธิตท่า (วาดด้วย SVG ไม่ต้องโหลดรูปหรือวิดีโอ)
//  ใช้: const fig = createFigure(element, "sit_to_stand"); fig.start(); ... fig.stop();
// =============================================================
const D = Math.PI / 180;
const sin = (a) => Math.sin(a * D);
const cos = (a) => Math.cos(a * D);
const add = (p, x, y) => ({ x: p.x + x, y: p.y + y });
const rot = (x, y, a) => ({ x: x * cos(a) - y * sin(a), y: x * sin(a) + y * cos(a) });
const GROUND = 268;
const L = { shank: 60, thigh: 62, torso: 72, upper: 34, fore: 30 };

// ค่าระหว่างจุดสำคัญของท่า (keyframes) แบบนุ่มนวล
function keyed(keys, p) {
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, a] = keys[i], [t1, b] = keys[i + 1];
    if (p >= t0 && p <= t1) {
      let u = (p - t0) / (t1 - t0 || 1);
      u = u * u * (3 - 2 * u);
      const o = {};
      for (const k in a) o[k] = a[k] + (b[k] - a[k]) * u;
      return o;
    }
  }
  return { ...keys[keys.length - 1][1] };
}

// ท่าทางด้านข้าง (หันขวา): ลำตัว ศีรษะ แขน จากสะโพก H และองศาเอนตัว l
function upperBody(H, l, armMode, armTarget) {
  const S = { x: H.x + L.torso * sin(l), y: H.y - L.torso * cos(l) };
  const head = { x: S.x + 22 * sin(l), y: S.y - 22 * cos(l) };
  let E, W;
  if (armMode === "cross") {
    const e = rot(16, 24, l), w = rot(10, 4, l);
    E = add(S, e.x, e.y);
    W = add(S, w.x, w.y);
  } else if (armMode === "reach") {
    E = { x: S.x + 20, y: S.y + 26 };
    W = armTarget;
  } else {
    const e = rot(4, L.upper, l), w = rot(16, 28, l);
    E = add(S, e.x, e.y);
    W = add(E, w.x, w.y);
  }
  return { S, head, E, W };
}

function foot(A, a = 0) {
  const h = rot(-7, 6, -a), t = rot(22, 6, -a);
  return { heel: add(A, h.x, h.y), toe: add(A, t.x, t.y) };
}

const CHAIR = (x = 78) => ({ type: "chair", x });
const RAIL = { type: "rail", x: 212 };

const POSES = {
  sit_to_stand: {
    loop: 5000,
    pose(p) {
      const v = keyed([
        [0, { s: 0, th: 90, l: 8 }],
        [0.18, { s: 0, th: 90, l: 8 }],
        [0.3, { s: 12, th: 80, l: 38 }],
        [0.5, { s: 0, th: 0, l: 0 }],
        [0.66, { s: 0, th: 0, l: 0 }],
        [0.82, { s: 12, th: 70, l: 32 }],
        [0.95, { s: 0, th: 90, l: 8 }],
        [1, { s: 0, th: 90, l: 8 }],
      ], p);
      const A = { x: 170, y: GROUND - 6 };
      const K = { x: A.x + L.shank * sin(v.s), y: A.y - L.shank * cos(v.s) };
      const H = { x: K.x - L.thigh * sin(v.th), y: K.y - L.thigh * cos(v.th) };
      const u = upperBody(H, v.l, "cross");
      const f = foot(A);
      return { props: [CHAIR(70)], near: { H, K, A, ...f }, far: { H, K, A, ...f }, ...u };
    },
  },
  knee_extension: {
    loop: 5000,
    pose(p) {
      const v = keyed([[0, { e: 0 }], [0.15, { e: 0 }], [0.35, { e: 82 }], [0.7, { e: 82 }], [0.9, { e: 0 }], [1, { e: 0 }]], p);
      const H = { x: 108, y: GROUND - 6 - L.shank };
      const K = { x: H.x + L.thigh, y: H.y };
      const A = { x: K.x + L.shank * sin(v.e), y: K.y + L.shank * cos(v.e) };
      const A0 = { x: K.x, y: K.y + L.shank };
      const u = upperBody(H, -4, "rest");
      u.W = { x: H.x + 40, y: H.y - 4 };
      u.E = { x: u.S.x + 6, y: u.S.y + 34 };
      return { props: [CHAIR(70)], near: { H, K, A, ...foot(A, v.e) }, far: { H, K: add(K, -4, 0), A: add(A0, -4, 0), ...foot(add(A0, -4, 0)) }, ...u };
    },
  },
  march: {
    loop: 4000,
    pose(p) {
      const v = keyed([[0, { a: 0, b: 0 }], [0.22, { a: 75, b: 0 }], [0.45, { a: 0, b: 0 }], [0.5, { a: 0, b: 0 }], [0.72, { a: 0, b: 75 }], [0.95, { a: 0, b: 0 }], [1, { a: 0, b: 0 }]], p);
      const H = { x: 150, y: GROUND - 6 - L.shank - L.thigh };
      const leg = (a, dx) => {
        const h = add(H, dx, 0);
        const K = { x: h.x + L.thigh * sin(a), y: h.y + L.thigh * cos(a) };
        const A = { x: K.x - L.shank * sin(a * 0.15), y: K.y + L.shank * cos(a * 0.15) };
        return { H: h, K, A, ...foot(A, -a * 0.1) };
      };
      const u = upperBody(H, 0, "reach", { x: RAIL.x - 4, y: H.y - 18 });
      return { props: [RAIL], near: leg(v.a, 0), far: leg(v.b, -4), ...u };
    },
  },
  heel_raise: {
    loop: 4500,
    pose(p) {
      const v = keyed([[0, { r: 0 }], [0.15, { r: 0 }], [0.38, { r: 14 }], [0.62, { r: 14 }], [0.85, { r: 0 }], [1, { r: 0 }]], p);
      const toe = { x: 176, y: GROUND };
      const A = { x: 154, y: GROUND - 6 - v.r };
      const K = { x: A.x, y: A.y - L.shank };
      const H = { x: A.x, y: K.y - L.thigh };
      const u = upperBody(H, 0, "reach", { x: RAIL.x - 4, y: H.y - 18 });
      const f = { heel: { x: A.x - 7, y: A.y + 6 }, toe };
      return { props: [RAIL], near: { H, K, A, ...f }, far: { H, K, A, ...f }, ...u };
    },
  },
  arm_raise: {
    loop: 4500,
    front: true,
    pose(p) {
      const v = keyed([[0, { a: 12 }], [0.12, { a: 12 }], [0.4, { a: 172 }], [0.62, { a: 172 }], [0.9, { a: 12 }], [1, { a: 12 }]], p);
      const LS = { x: 126, y: 112 }, RS = { x: 174, y: 112 };
      const arm = (S, side) => {
        const d = { x: side * sin(v.a), y: cos(v.a) };
        const E = { x: S.x + L.upper * d.x * 1.3, y: S.y + L.upper * d.y * 1.3 };
        return { E, W: { x: E.x + L.fore * d.x * 1.3, y: E.y + L.fore * d.y * 1.3 } };
      };
      return { front: true, LS, RS, la: arm(LS, -1), ra: arm(RS, 1) };
    },
  },
};

// ---------- วาด ----------
function seg(a, b, cls) {
  return `<line class="${cls}" x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}"/>`;
}
function dot(p, r = 4.5) {
  return `<circle class="fj" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r}"/>`;
}
function drawProps(props) {
  return (props || [])
    .map((pr) => {
      if (pr.type === "chair") {
        const x = pr.x, y = GROUND - 6 - L.shank + 4;
        return `<g class="fprop"><line x1="${x}" y1="${y}" x2="${x + 58}" y2="${y}"/><line x1="${x}" y1="${y}" x2="${x}" y2="${y - 70}"/>
          <line x1="${x + 4}" y1="${y}" x2="${x + 4}" y2="${GROUND}"/><line x1="${x + 54}" y1="${y}" x2="${x + 54}" y2="${GROUND}"/></g>`;
      }
      if (pr.type === "rail")
        return `<g class="fprop"><line x1="${pr.x - 26}" y1="${GROUND - 136}" x2="${pr.x + 14}" y2="${GROUND - 136}"/><line x1="${pr.x}" y1="${GROUND - 136}" x2="${pr.x}" y2="${GROUND}"/></g>`;
      return "";
    })
    .join("");
}
function render(P) {
  let g = `<line class="fground" x1="20" y1="${GROUND}" x2="280" y2="${GROUND}"/>`;
  if (P.front) {
    const H1 = { x: 138, y: 186 }, H2 = { x: 162, y: 186 };
    const K1 = { x: 137, y: 226 }, K2 = { x: 163, y: 226 }, A1 = { x: 136, y: 262 }, A2 = { x: 164, y: 262 };
    g += seg(P.LS, P.RS, "fb") + seg(P.LS, H1, "fb") + seg(P.RS, H2, "fb") + seg(H1, H2, "fb");
    g += seg(H1, K1, "fb") + seg(K1, A1, "fb") + seg(H2, K2, "fb") + seg(K2, A2, "fb");
    g += seg(A1, add(A1, -14, 4), "fb") + seg(A2, add(A2, 14, 4), "fb");
    g += seg(P.LS, P.la.E, "fa") + seg(P.la.E, P.la.W, "fa") + seg(P.RS, P.ra.E, "fa") + seg(P.ra.E, P.ra.W, "fa");
    g += `<circle class="fhead" cx="150" cy="84" r="17"/>`;
    g += [P.LS, P.RS, P.la.E, P.ra.E, P.la.W, P.ra.W].map((p) => dot(p)).join("");
    return g;
  }
  g += drawProps(P.props);
  const legs = (l, cls) => seg(l.H, l.K, cls) + seg(l.K, l.A, cls) + seg(l.heel, l.toe, cls) + seg(l.A, l.heel, cls);
  g += legs(P.far, "ff");
  g += seg(P.near.H, P.S, "fb");
  g += legs(P.near, "fb");
  g += seg(P.S, P.E, "fa") + seg(P.E, P.W, "fa");
  g += `<circle class="fhead" cx="${P.head.x.toFixed(1)}" cy="${P.head.y.toFixed(1)}" r="17"/>`;
  g += [P.S, P.near.H, P.near.K, P.near.A, P.E].map((p) => dot(p)).join("");
  return g;
}

export function hasFigure(id) {
  return !!POSES[id];
}

export function figurePhase(id, ms) {
  const def = POSES[id];
  return def ? (ms % def.loop) / def.loop : 0;
}

export function createFigure(el, id) {
  const def = POSES[id];
  el.innerHTML = `<svg viewBox="0 0 300 290" class="figure" role="img" aria-label="ภาพเคลื่อนไหวสาธิตท่า"><g></g></svg>`;
  const g = el.querySelector("g");
  let raf = 0, t0 = 0, paused = false, pausedAt = 0;
  const frame = (now) => {
    if (!t0) t0 = now;
    const p = ((now - t0) % def.loop) / def.loop;
    g.innerHTML = render(def.pose(p));
    raf = requestAnimationFrame(frame);
  };
  if (def) g.innerHTML = render(def.pose(0));
  return {
    start() {
      if (!def || raf) return;
      if (paused) t0 += performance.now() - pausedAt;
      paused = false;
      raf = requestAnimationFrame(frame);
    },
    stop() {
      cancelAnimationFrame(raf);
      raf = 0;
      paused = true;
      pausedAt = performance.now();
    },
    // ใช้ทดสอบ: วาดท่าที่จุดเวลา p (0–1)
    draw(p) {
      if (def) g.innerHTML = render(def.pose(p));
    },
  };
}
