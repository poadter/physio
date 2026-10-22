// =============================================================
//  exercise.js — หน้าฝึกท่า: กล้อง → MediaPipe → นับครั้ง → เสียง → บันทึกผล
// =============================================================
import { EXERCISES, RepCounter, FallDetector, resolveParams, ISSUE_LABEL, PAIN_LABEL } from "./pose-engine.js";
import { api, saveSession, store, DEMO, getDevice } from "./api.js";
import { voice } from "./voice.js";
import { $, $$, toast, esc } from "./ui.js";
import { createFigure, hasFigure } from "./demo-figure.js";
import { Coach, isLearned, markLearned } from "./coach.js";
import { conditionOf, SIDE_LABEL } from "./conditions.js";

const CFG = window.APP_CONFIG;
const qs = new URLSearchParams(location.search);
const TEST = qs.get("test") === "1"; // โหมดนักกายภาพทดลองท่า: ไม่บันทึก ไม่แจ้งเตือน
let MODE = "train"; // "train" = ฝึกจริง, "learn" = เรียนท่า
const ex = EXERCISES[qs.get("ex")] || EXERCISES.sit_to_stand;

// ---------- หาค่าพารามิเตอร์ของท่านี้ ----------
const cached = store.get("cache_patient");
const planItem = cached?.patient?.plan?.exercises?.find((x) => x.id === ex.id) || {};
const override = TEST ? Object.fromEntries(["reps", "sets", "down", "up", "good"].map((k) => [k, qs.get(k) ?? undefined])) : planItem;
const P = resolveParams(ex, override);
const COND = conditionOf(cached?.patient);
const AFFECTED = cached?.patient?.affectedSide || "";
const CNT_OPTS = { skipChecks: COND.skipChecks || [] };
const REST_SEC = Number(cached?.patient?.plan?.restSec) || 30;

if (!TEST && !DEMO && !getDevice()) location.replace("index.html");

// ---------- เตรียมหน้าคำแนะนำ ----------
document.title = ex.name + " — " + CFG.APP_NAME;
$("#exTitle").textContent = ex.name;
$("#exIcon").textContent = ex.icon;
$("#exName").textContent = ex.name;
$("#exTarget").textContent = `${P.reps} ครั้ง × ${P.sets} เซต`;
$("#exBenefit").textContent = ex.benefit;
$("#exSetup").textContent = ex.setup;
$("#exSteps").innerHTML = ex.steps.map((s) => `<li>${esc(s)}</li>`).join("");
$("#repGoal").textContent = P.reps;
if (COND.precautions?.length && !TEST) {
  $("#precautions").hidden = false;
  $("#precautions").innerHTML = `<h3>⚠️ ข้อควรระวัง (${esc(COND.short)}${AFFECTED ? " · ข้าง" + SIDE_LABEL[AFFECTED] + "อ่อนแรง" : ""})</h3>
    <ul>${COND.precautions.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
}
if (TEST) {
  $("#testBanner").hidden = false;
  $("#backBtn").href = "admin.html";
  $("#doneHome").href = "admin.html";
}

const setVoiceIcon = () => ($("#voiceBtn").textContent = voice.enabled ? "🔊" : "🔇");
setVoiceIcon();
$("#voiceBtn").onclick = () => { voice.setEnabled(!voice.enabled); setVoiceIcon(); };

function show(id) {
  for (const s of ["sIntro", "sLearn", "sWarn", "sPain", "sTrain", "sRest", "sLearnDone", "sDone"]) $("#" + s).hidden = s !== id;
  if (id !== "sLearn") stopDemo();
  scrollTo(0, 0);
}

// ---------- ตัวการ์ตูนสาธิตท่า ----------
const introFig = hasFigure(ex.id) ? createFigure($("#introFig"), ex.id) : null;
if (introFig) introFig.start();
else $("#introFig").hidden = true;
const learned = isLearned(ex.id);
if (!learned) {
  $("#learnHint").hidden = false;
  $("#learnBtn").classList.add("primary");
  $("#startBtn").classList.remove("primary");
}
let learnFig = null, demoTimers = [];
function stopDemo() {
  demoTimers.forEach(clearTimeout);
  demoTimers = [];
  learnFig?.stop();
}
function playDemo() {
  stopDemo();
  if (!learnFig) learnFig = createFigure($("#learnFig"), ex.id);
  learnFig.start();
  const items = $$("#learnSteps li");
  const lines = [`มาเรียนท่า ${ex.name} กันครับ ดูตัวอย่างแล้วฟังทีละขั้น`, ...ex.steps.map((x, i) => `ขั้นที่ ${i + 1} ${x}`)];
  lines.forEach((line, i) => {
    demoTimers.push(setTimeout(() => {
      items.forEach((li, j) => li.classList.toggle("active", j === i - 1));
      voice.say(line, { priority: true });
    }, i * 4200));
  });
  demoTimers.push(setTimeout(() => {
    items.forEach((li) => li.classList.remove("active"));
    voice.say("พร้อมแล้ว กดปุ่ม ลองทำตาม ได้เลยครับ", { priority: true });
  }, lines.length * 4200));
}
$("#learnSteps").innerHTML = ex.steps.map((x) => `<li>${esc(x)}</li>`).join("");
$("#learnBtn").onclick = () => {
  voice.unlock();
  introFig?.stop();
  show("sLearn");
  playDemo();
};
$("#replayBtn").onclick = playDemo;
$("#tryBtn").onclick = () => {
  MODE = "learn";
  askPain("before");
};

// ---------- สถานะการฝึก ----------
const S = {
  painBefore: null,
  painAfter: null,
  set: 1,
  totalReps: 0,
  totalGood: 0,
  issues: {},
  startedAt: 0,
  stoppedEarly: false,
  running: false,
  paused: false,
  facing: store.get("facing", "user"),
  debug: TEST,
};
let counter = new RepCounter(ex, P, CNT_OPTS);
const fall = new FallDetector();
let landmarker = null, stream = null, raf = 0, lastVideoTime = -1, wakeLock = null;

// ---------- ขั้นตอน ----------
$("#startBtn").onclick = () => {
  voice.unlock();
  MODE = "train";
  askPain("before");
};

// ---------- สัญญาณเตือนโรคหลอดเลือดสมอง (ถามทุก 3 ชั่วโมงก่อนฝึก) ----------
function needWarnCheck() {
  if (!COND.warningCheck || TEST) return false;
  const last = store.get("warn_ok_at", 0);
  return Date.now() - last > 3 * 3600000;
}
function askWarning(next) {
  show("sWarn");
  voice.say("ก่อนฝึก มีอาการ หน้าเบี้ยว แขนขาอ่อนแรงมากขึ้น พูดไม่ชัด หรือมองไม่เห็น เกิดขึ้นใหม่ทันทีไหมครับ", { priority: true });
  $("#warnNo").onclick = () => {
    store.set("warn_ok_at", Date.now());
    next();
  };
  $("#warnYes").onclick = async () => {
    const box = document.createElement("div");
    box.className = "alert-screen";
    box.innerHTML = `<div class="stack" style="max-width:440px">
      <div style="font-size:3rem">🚨</div>
      <h1>โทร 1669 ทันที</h1>
      <p>อาการนี้อาจเป็นโรคหลอดเลือดสมองซ้ำ ยิ่งถึงโรงพยาบาลเร็ว ยิ่งรักษาได้ผล<br>ห้ามฝึกต่อ นั่งหรือนอนพัก จดเวลาที่เริ่มมีอาการ</p>
      <a class="btn xl block" href="tel:1669">📞 โทร 1669</a>
      <p id="warnSent">กำลังแจ้งญาติ…</p>
      <a class="btn xl block" href="home.html" style="background:transparent;color:#fff;border-color:#fff">กลับหน้าหลัก</a></div>`;
    document.body.appendChild(box);
    voice.say("อาการนี้อันตราย โทรหนึ่งหกหกเก้าทันทีครับ", { priority: true });
    const r = await sendAlert("stroke_warning", "ก่อนฝึกท่า" + ex.name + " ผู้ป่วยตอบว่ามีอาการเตือนเกิดขึ้นใหม่");
    const el = box.querySelector("#warnSent");
    if (el) el.textContent = r?.demo ? "โหมดทดลอง: ระบบจริงจะส่ง LINE ถึงญาติ" : r?.notified ? `แจ้งญาติแล้ว ${r.notified} คน` : "ยังแจ้งญาติไม่ได้ กรุณาโทรหาญาติด้วย";
  };
}

function askPain(when) {
  if (when === "before" && needWarnCheck()) return askWarning(() => askPainNow(when));
  askPainNow(when);
}
function askPainNow(when) {
  $("#painTitle").textContent = when === "before" ? "ก่อนเริ่ม วันนี้รู้สึกอย่างไรบ้าง?" : "หลังฝึก รู้สึกอย่างไรบ้าง?";
  show("sPain");
  voice.say(when === "before" ? "ก่อนเริ่ม วันนี้รู้สึกอย่างไรบ้างครับ" : "หลังฝึก รู้สึกอย่างไรบ้างครับ", { priority: true });
  $$("[data-pain]").forEach((b) => (b.onclick = () => onPain(when, b.dataset.pain)));
}

async function onPain(when, level) {
  if (when === "before") {
    S.painBefore = level;
    if (level === "severe") {
      voice.say("วันนี้พักก่อนนะครับ ถ้าอาการไม่ดีขึ้น ให้ติดต่อนักกายภาพหรือแพทย์", { priority: true });
      show("sDone");
      $("#doneTitle").textContent = "วันนี้พักก่อนนะครับ";
      $(".summary-nums").hidden = true;
      $("#sumIssues").hidden = false;
      $("#sumIssues").textContent = "ระบบแจ้งญาติ/ผู้ดูแลให้ทราบแล้ว หากเจ็บมาก แน่นหน้าอก หรือหน้ามืด โทร 1669";
      if (!TEST) sendAlert("pain", `ก่อนฝึกท่า${ex.name}: ${PAIN_LABEL.severe}`);
      return;
    }
    startTraining();
  } else {
    S.painAfter = level;
    if (level === "severe" && !TEST) sendAlert("pain", `หลังฝึกท่า${ex.name}: ${PAIN_LABEL.severe}`);
    finish();
  }
}

async function sendAlert(type, detail) {
  try {
    const r = await api("patient.alert", { type, detail });
    if (r.demo) toast("โหมดทดลอง: ระบบจริงจะส่ง LINE ถึงญาติตอนนี้", "info", 5000);
    return r;
  } catch (e) {
    toast("ส่งแจ้งเตือนไม่สำเร็จ: " + e.message, "error", 6000);
    return null;
  }
}

// ---------- โหลด AI ----------
async function loadVisionModule() {
  const v = CFG.MEDIAPIPE_VERSION;
  const urls = [
    `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${v}/vision_bundle.mjs`,
    `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${v}`,
  ];
  let lastErr;
  for (const u of urls) {
    try {
      const mod = await import(/* @vite-ignore */ u);
      return mod.PoseLandmarker ? mod : mod.default;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

async function loadModel() {
  const vision = await loadVisionModule();
  const fileset = await vision.FilesetResolver.forVisionTasks(
    `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${CFG.MEDIAPIPE_VERSION}/wasm`
  );
  const opts = (delegate) => ({
    baseOptions: { modelAssetPath: CFG.POSE_MODEL_URL, delegate },
    runningMode: "VIDEO",
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  try {
    return await vision.PoseLandmarker.createFromOptions(fileset, opts("GPU"));
  } catch {
    return await vision.PoseLandmarker.createFromOptions(fileset, opts("CPU"));
  }
}

async function startCamera() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: S.facing, width: { ideal: 640 }, height: { ideal: 480 } },
    audio: false,
  });
  const v = $("#video");
  v.srcObject = stream;
  await v.play();
  $("#stage").classList.toggle("mirror", S.facing === "user");
  const c = $("#canvas");
  c.width = v.videoWidth;
  c.height = v.videoHeight;
}

let coach = null, pipFig = null;
async function startTraining() {
  show("sTrain");
  $("#setInfo").textContent = `เซต ${S.set}/${P.sets}`;
  $("#gaugeTarget").style.bottom = Math.round(((P.up - P.down) / (P.good - P.down)) * 100) + "%";
  if (hasFigure(ex.id)) {
    pipFig = pipFig || createFigure($("#pip"), ex.id);
    pipFig.start();
  } else $("#pip").hidden = true;
  if (MODE === "learn") {
    coach = new Coach(ex, P);
    counter = new RepCounter(ex, P, CNT_OPTS);
    $("#repNow").textContent = 0;
    $("#repGoal").textContent = coach.goal;
    $("#repGoal").parentElement.lastChild.textContent = " ครั้ง";
    $("#repGoal").parentElement.firstChild.textContent = "ผ่าน ";
    $("#setInfo").textContent = "ขั้นที่ 1/3: ตั้งกล้อง";
  }
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("เบราว์เซอร์นี้เปิดกล้องไม่ได้ (ต้องเปิดผ่าน https)");
    const camPromise = startCamera();
    if (!landmarker) landmarker = await loadModel();
    await camPromise;
  } catch (e) {
    console.error(e);
    $("#loading").innerHTML = `เปิดกล้องหรือโหลด AI ไม่สำเร็จ<br><small>${esc(e.message || e)}</small><br><br>
      <small>ตรวจว่าอนุญาตให้ใช้กล้อง และมีอินเทอร์เน็ตในการเปิดครั้งแรก</small>`;
    return;
  }
  $("#loading").hidden = true;
  try { wakeLock = await navigator.wakeLock?.request("screen"); } catch {}
  S.startedAt = S.startedAt || Date.now();
  S.running = true;
  if (MODE === "learn") {
    setFeedback("ตั้งกล้องให้เห็นทั้งตัว");
  } else {
    setFeedback("เข้าท่าเริ่มต้นได้เลยครับ");
    voice.say(`เริ่มได้เลยครับ ${ex.name} ${P.reps} ครั้ง`, { priority: true });
  }
  loop();
}

// ---------- วาดโครงร่าง ----------
const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [27, 29], [29, 31], [27, 31], [28, 30], [30, 32], [28, 32]];
function draw(lm) {
  const c = $("#canvas"), g = c.getContext("2d");
  g.clearRect(0, 0, c.width, c.height);
  if (!lm) return;
  const W = c.width, H = c.height;
  const color = counter.phase === "up" ? "#4ade80" : "#ffd34d";
  g.lineWidth = Math.max(4, W / 120);
  g.lineCap = "round";
  g.strokeStyle = color;
  for (const [a, b] of BONES) {
    if ((lm[a].visibility ?? 1) < 0.3 || (lm[b].visibility ?? 1) < 0.3) continue;
    g.beginPath();
    g.moveTo(lm[a].x * W, lm[a].y * H);
    g.lineTo(lm[b].x * W, lm[b].y * H);
    g.stroke();
  }
  g.fillStyle = "#fff";
  for (let i = 11; i < 33; i++) {
    if ((lm[i].visibility ?? 1) < 0.3) continue;
    g.beginPath();
    g.arc(lm[i].x * W, lm[i].y * H, g.lineWidth * 0.9, 0, Math.PI * 2);
    g.fill();
  }
}

function setFeedback(text, kind = "") {
  const f = $("#feedback");
  f.textContent = text;
  f.className = "feedback " + kind;
}

// ---------- วนประมวลผลทุกเฟรม ----------
function loop() {
  if (!S.running) return;
  raf = requestAnimationFrame(loop);
  const v = $("#video");
  if (S.paused || v.readyState < 2 || v.currentTime === lastVideoTime) return;
  lastVideoTime = v.currentTime;
  const t = performance.now();
  let lm = null;
  try {
    const res = landmarker.detectForVideo(v, t);
    lm = res.landmarks && res.landmarks[0] ? res.landmarks[0] : null;
  } catch (e) {
    console.warn(e);
  }
  const aspect = v.videoWidth / v.videoHeight || 1;
  draw(lm);

  const f = fall.update(lm, t, aspect);
  if (f) return onFall(f);

  const events = counter.update(lm, t, aspect);
  if (MODE === "learn") handleCoach(coach.update(lm, t, aspect, events, counter));
  else for (const e of events) handleEvent(e);
  const p = counter.progress();
  const bar = $("#gaugeBar");
  bar.style.height = Math.round(p * 100) + "%";
  bar.classList.toggle("full", p >= 1);
  if (S.debug) {
    const d = $("#debug");
    d.hidden = false;
    d.innerHTML = `${ex.metricLabel}: ${Number.isFinite(counter.value) ? Math.round(counter.value) + ex.unit : "-"}<br>
      ลง ≤${P.down} ขึ้น ≥${P.up} ดี ≥${P.good}<br>สถานะ: ${counter.phase === "up" ? "ถึงท่า" : "ท่าเริ่ม"} · ด้าน ${counter.side || "-"}`;
  } else $("#debug").hidden = true;
}

function handleEvent(e) {
  switch (e.type) {
    case "lost":
      setFeedback("ถอยให้กล้องเห็นทั้งตัวครับ", "warn");
      voice.say("ถอยห่างจากกล้องอีกนิด ให้เห็นทั้งตัวครับ", { key: "lost", gap: 7000 });
      break;
    case "reached":
      if (!ex.holdSec) setFeedback("ดีครับ กลับท่าเริ่มต้นช้า ๆ");
      break;
    case "hold":
      setFeedback(e.msg);
      voice.say(e.msg, { key: "hold", gap: 2500, priority: true });
      break;
    case "holdDone":
      setFeedback("ลงได้เลยครับ", "good");
      voice.say("ลงได้ครับ", { priority: true });
      break;
    case "partial":
      setFeedback(e.msg, "warn");
      voice.say(e.msg, { key: "partial", gap: 5000 });
      break;
    case "rep": {
      $("#repNow").textContent = e.reps;
      voice.count(e.reps);
      if (e.good && AFFECTED && e.side === AFFECTED) {
        setFeedback(`ครั้งที่ ${e.reps} — ข้าง${SIDE_LABEL[AFFECTED]}ทำได้ดีมาก!`, "good");
        setTimeout(() => voice.say(`ข้าง${SIDE_LABEL[AFFECTED]}ทำได้ดีมากครับ`, { key: "aff_good", gap: 8000 }), 900);
      } else if (e.good) setFeedback(`ครั้งที่ ${e.reps} — ${ex.goodMsg}`, "good");
      else {
        const m = e.problems[0].msg;
        setFeedback(m, "warn");
        setTimeout(() => voice.say(m, { key: "p_" + e.problems[0].key, gap: 9000 }), 900);
      }
      if (e.reps >= P.reps) setTimeout(endSet, 900);
      break;
    }
  }
}

// ---------- โหมดเรียนท่า ----------
function handleCoach(r) {
  $("#setInfo").textContent = r.title;
  $("#repNow").textContent = r.good;
  if (r.text) setFeedback(r.text, r.kind);
  for (const [text, opt] of r.say) voice.say(text, opt);
  if (r.finished) {
    stopCamera();
    pipFig?.stop();
    setTimeout(() => learnDone(r.finished), r.finished.passed ? 1800 : 3500);
  }
}

function learnDone(f) {
  show("sLearnDone");
  if (f.passed && !TEST) markLearned(ex.id);
  $("#ldIcon").textContent = f.passed ? "🎓" : "💪";
  $("#ldTitle").textContent = f.passed ? "ผ่านการเรียนท่าแล้ว!" : "เกือบแล้วครับ";
  $("#ldText").textContent = f.passed
    ? `ทำถูก ${f.good} ครั้ง จากที่ลอง ${f.attempts} ครั้ง พร้อมฝึกจริงแล้ว`
    : `ทำถูก ${f.good} จาก ${f.attempts} ครั้ง ลองดูตัวอย่างอีกครั้ง หรือปรึกษานักกายภาพ`;
  if (f.tips.length) {
    $("#ldTips").hidden = false;
    $("#ldTips").innerHTML = "<b>สิ่งที่ควรระวัง:</b><br>" + f.tips.slice(0, 3).map(esc).join("<br>");
  } else $("#ldTips").hidden = true;
  $("#ldStart").classList.toggle("primary", f.passed);
  $("#ldAgain").classList.toggle("primary", !f.passed);
  if (TEST) $("#ldHome").href = "admin.html";
}
$("#ldStart").onclick = () => {
  const u = new URL(location.href);
  u.searchParams.delete("learn");
  u.searchParams.set("start", "1");
  u.searchParams.set("pain", S.painBefore || "none");
  location.href = u.toString();
};
$("#ldAgain").onclick = () => {
  S.startedAt = 0;
  show("sLearn");
  playDemo();
};

// ---------- จบเซต / พัก ----------
function collectSet() {
  const sd = counter.sideSummary();
  if (sd) {
    S.sides = S.sides || { L: { reps: 0, sum: 0, max: 0 }, R: { reps: 0, sum: 0, max: 0 } };
    for (const k of ["L", "R"]) {
      const v = sd[k];
      if (!v.reps) continue;
      S.sides[k].reps += v.reps;
      S.sides[k].sum += v.avg * v.reps;
      S.sides[k].max = Math.max(S.sides[k].max, v.max);
    }
  }
  S.totalReps += counter.reps;
  S.totalGood += counter.goodReps;
  for (const [k, n] of Object.entries(counter.issues)) S.issues[k] = (S.issues[k] || 0) + n;
}

function stopCamera() {
  S.running = false;
  cancelAnimationFrame(raf);
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  try { wakeLock?.release(); } catch {}
}

let restTimer = 0;
function endSet() {
  if (!S.running) return;
  collectSet();
  if (S.set >= P.sets) {
    stopCamera();
    voice.say("ครบแล้วครับ เก่งมาก", { priority: true });
    return askPain("after");
  }
  S.running = false;
  cancelAnimationFrame(raf);
  show("sRest");
  let n = REST_SEC;
  $("#restCount").textContent = n;
  voice.say(`ครบเซตที่ ${S.set} แล้ว พัก ${n} วินาทีครับ`, { priority: true });
  clearInterval(restTimer);
  restTimer = setInterval(() => {
    n--;
    $("#restCount").textContent = n;
    if (n === 3) voice.say("เตรียมตัวครับ", { priority: true });
    if (n <= 0) nextSet();
  }, 1000);
}

function nextSet() {
  clearInterval(restTimer);
  S.set++;
  counter = new RepCounter(ex, P, CNT_OPTS);
  $("#repNow").textContent = 0;
  show("sTrain");
  $("#setInfo").textContent = `เซต ${S.set}/${P.sets}`;
  S.running = true;
  setFeedback("เริ่มเซตใหม่ได้เลยครับ");
  voice.say(`เซตที่ ${S.set} เริ่มได้ครับ`, { priority: true });
  loop();
}
$("#skipRest").onclick = nextSet;
$("#endFromRest").onclick = () => {
  clearInterval(restTimer);
  stopCamera();
  askPain("after");
};

$("#stopBtn").onclick = () => {
  if (MODE === "learn") {
    stopCamera();
    pipFig?.stop();
    voice.say("หยุดแล้วครับ", { priority: true });
    return learnDone({ passed: false, good: coach?.good || 0, attempts: coach?.attempts || 0, tips: [] });
  }
  if (S.running) collectSet();
  S.stoppedEarly = true;
  stopCamera();
  voice.say("หยุดแล้วครับ", { priority: true });
  askPain("after");
};

$("#flipBtn").onclick = async () => {
  S.facing = S.facing === "user" ? "environment" : "user";
  store.set("facing", S.facing);
  try {
    await startCamera();
  } catch (e) {
    toast("สลับกล้องไม่ได้", "error");
  }
};
$("#debugBtn").onclick = () => (S.debug = !S.debug);

// ---------- ตรวจพบการล้ม ----------
let fallTimer = 0, fallVoice = 0;
function onFall(f) {
  S.paused = true;
  const secs = CFG.FALL_CONFIRM_SECONDS || 20;
  let n = secs;
  const wrap = document.createElement("div");
  wrap.className = "alert-screen";
  wrap.innerHTML = `<div class="stack" style="max-width:420px">
      <div style="font-size:3rem">⚠️</div>
      <h1>เป็นอะไรไหมครับ?</h1>
      <p>ระบบตรวจพบว่าอาจล้ม<br>ถ้าไม่เป็นไร กดปุ่มสีขาวด้านล่าง</p>
      <div class="count" id="fallCount">${n}</div>
      <button class="btn xl block" id="imOk">✅ ฉันไม่เป็นไร</button>
      <button class="btn xl block" id="needHelp" style="background:#ffd34d;color:#3a2400">🆘 ขอความช่วยเหลือ</button>
    </div>`;
  document.body.appendChild(wrap);
  const ask = () => voice.say("คุณเป็นอะไรไหมครับ ถ้าไม่เป็นไร กดปุ่มสีขาว", { priority: true });
  ask();
  fallVoice = setInterval(ask, 6000);
  const close = () => {
    clearInterval(fallTimer);
    clearInterval(fallVoice);
    wrap.remove();
  };
  const send = async (why) => {
    close();
    const box = document.createElement("div");
    box.className = "alert-screen";
    box.innerHTML = `<div class="stack" style="max-width:420px"><h1>กำลังแจ้งญาติ…</h1></div>`;
    document.body.appendChild(box);
    voice.say("กำลังแจ้งญาติครับ อย่าเพิ่งลุกเร็ว ๆ", { priority: true });
    let r = null;
    if (!TEST) r = await sendAlert(why === "help" ? "sos" : "fall", `ระหว่างฝึกท่า${ex.name} (${f.reason})`);
    const n = r?.notified ?? 0;
    box.innerHTML = `<div class="stack" style="max-width:420px">
      <h1>${TEST ? "โหมดทดลอง" : n > 0 ? `แจ้งญาติแล้ว ${n} คน` : "ยังแจ้งญาติไม่ได้"}</h1>
      <p>${TEST ? "ระบบจริงจะส่ง LINE ถึงญาติที่เชื่อมต่อไว้" : n > 0 ? "นอนพักนิ่ง ๆ รอคนมาช่วยนะครับ" : "กรุณาโทรหาญาติ หรือโทร 1669"}</p>
      <a class="btn xl block" href="tel:1669">📞 โทร 1669 (ฉุกเฉิน)</a>
      <button class="btn xl block" id="closeAlert" style="background:transparent;color:#fff;border-color:#fff">ปิด</button></div>`;
    box.querySelector("#closeAlert").onclick = () => {
      box.remove();
      if (MODE === "learn") {
        stopCamera();
        return show("sIntro");
      }
      if (S.running) collectSet();
      S.stoppedEarly = true;
      stopCamera();
      finish();
    };
  };
  wrap.querySelector("#imOk").onclick = () => {
    close();
    fall.reset();
    S.paused = false;
    voice.say("ดีครับ ฝึกต่อได้ ค่อย ๆ ทำนะครับ", { priority: true });
  };
  wrap.querySelector("#needHelp").onclick = () => send("help");
  fallTimer = setInterval(() => {
    n--;
    const el = wrap.querySelector("#fallCount");
    if (el) el.textContent = n;
    if (n <= 0) send("fall");
  }, 1000);
}

// ---------- สรุปและบันทึก ----------
async function finish() {
  show("sDone");
  const mins = S.startedAt ? (Date.now() - S.startedAt) / 60000 : 0;
  const pct = S.totalReps ? Math.round((S.totalGood / S.totalReps) * 100) : 0;
  $("#sumReps").textContent = S.totalReps;
  $("#sumGood").textContent = pct + "%";
  $("#sumTime").textContent = mins < 1 ? "<1" : Math.round(mins);
  const iss = Object.entries(S.issues).sort((a, b) => b[1] - a[1]);
  if (iss.length) {
    $("#sumIssues").hidden = false;
    $("#sumIssues").innerHTML = "<b>จุดที่ควรระวัง:</b> " + iss.map(([k, n]) => `${ISSUE_LABEL[k] || k} (${n})`).join(", ");
  }
  if (S.totalReps >= P.reps * P.sets) voice.say(`ทำได้ ${S.totalReps} ครั้ง ถูกต้อง ${pct} เปอร์เซ็นต์ เก่งมากครับ`);
  if (TEST) return ($("#saveState").textContent = "โหมดทดลองท่า: ไม่บันทึกผล");

  const session = {
    exercise: ex.id,
    exerciseName: ex.name,
    targetReps: P.reps,
    targetSets: P.sets,
    sets: S.set,
    reps: S.totalReps,
    goodReps: S.totalGood,
    durationSec: Math.round(mins * 60),
    painBefore: S.painBefore,
    painAfter: S.painAfter,
    issues: S.issues,
    stoppedEarly: S.stoppedEarly,
    params: { down: P.down, up: P.up, good: P.good },
    sides: S.sides
      ? Object.fromEntries(["L", "R"].map((k) => [k, { reps: S.sides[k].reps, avg: S.sides[k].reps ? Math.round(S.sides[k].sum / S.sides[k].reps) : null, max: S.sides[k].reps ? Math.round(S.sides[k].max) : null }]))
      : null,
    clientAt: new Date().toISOString(),
  };
  $("#saveState").textContent = "กำลังบันทึก…";
  try {
    const r = await saveSession(session);
    $("#saveState").textContent = r.queued ? "ยังไม่มีอินเทอร์เน็ต — จะส่งให้อัตโนมัติเมื่อกลับมาออนไลน์" : DEMO ? "บันทึกในเครื่องแล้ว (โหมดทดลอง)" : "✅ บันทึกผลแล้ว";
  } catch (e) {
    $("#saveState").textContent = "บันทึกไม่สำเร็จ: " + e.message;
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden && S.running) {
    S.paused = true;
  } else if (!document.hidden && S.running && !document.querySelector(".alert-screen")) {
    S.paused = false;
  }
});

// เปิดตรงจากลิงก์: ?learn=1 = เข้าโหมดเรียนท่าเลย, ?start=1 = เริ่มฝึกจริง (หลังเรียนผ่าน)
if (qs.get("learn") === "1") setTimeout(() => $("#learnBtn").click(), 50);
else if (qs.get("start") === "1") {
  // มาจากการเรียนท่าผ่านแล้ว: ถามอาการไปแล้ว จึงเริ่มฝึกได้ทันที
  const pain = qs.get("pain");
  if (pain && pain !== "severe") {
    MODE = "train";
    S.painBefore = pain;
    setTimeout(startTraining, 50);
  } else setTimeout(() => $("#startBtn").click(), 50);
}
