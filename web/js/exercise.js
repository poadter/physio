// =============================================================
//  exercise.js — หน้าฝึกท่า: กล้อง → MediaPipe → นับครั้ง → เสียง → บันทึกผล
// =============================================================
import { EXERCISES, RepCounter, FallDetector, resolveParams, ISSUE_LABEL, PAIN_LABEL } from "./pose-engine.js";
import { api, saveSession, store, DEMO, getDevice } from "./api.js";
import { voice } from "./voice.js";
import { $, $$, toast, esc } from "./ui.js";

const CFG = window.APP_CONFIG;
const qs = new URLSearchParams(location.search);
const TEST = qs.get("test") === "1"; // โหมดนักกายภาพทดลองท่า: ไม่บันทึก ไม่แจ้งเตือน
const ex = EXERCISES[qs.get("ex")] || EXERCISES.sit_to_stand;

// ---------- หาค่าพารามิเตอร์ของท่านี้ ----------
const cached = store.get("cache_patient");
const planItem = cached?.patient?.plan?.exercises?.find((x) => x.id === ex.id) || {};
const override = TEST ? Object.fromEntries(["reps", "sets", "down", "up", "good"].map((k) => [k, qs.get(k) ?? undefined])) : planItem;
const P = resolveParams(ex, override);
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
if (TEST) {
  $("#testBanner").hidden = false;
  $("#backBtn").href = "admin.html";
  $("#doneHome").href = "admin.html";
}

const setVoiceIcon = () => ($("#voiceBtn").textContent = voice.enabled ? "🔊" : "🔇");
setVoiceIcon();
$("#voiceBtn").onclick = () => { voice.setEnabled(!voice.enabled); setVoiceIcon(); };

function show(id) {
  for (const s of ["sIntro", "sPain", "sTrain", "sRest", "sDone"]) $("#" + s).hidden = s !== id;
  scrollTo(0, 0);
}

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
let counter = new RepCounter(ex, P);
const fall = new FallDetector();
let landmarker = null, stream = null, raf = 0, lastVideoTime = -1, wakeLock = null;

// ---------- ขั้นตอน ----------
$("#startBtn").onclick = () => {
  voice.unlock();
  askPain("before");
};

function askPain(when) {
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

async function startTraining() {
  show("sTrain");
  $("#setInfo").textContent = `เซต ${S.set}/${P.sets}`;
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
  setFeedback("เข้าท่าเริ่มต้นได้เลยครับ");
  voice.say(`เริ่มได้เลยครับ ${ex.name} ${P.reps} ครั้ง`, { priority: true });
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

  for (const e of counter.update(lm, t, aspect)) handleEvent(e);
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
      if (e.good) setFeedback(`ครั้งที่ ${e.reps} — ${ex.goodMsg}`, "good");
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

// ---------- จบเซต / พัก ----------
function collectSet() {
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
  counter = new RepCounter(ex, P);
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
