import { api, DEMO, getDevice, clearDevice, store, flushQueue, planItems } from "./api.js";
import { $, $$, esc, toast, modal, confirmBox, registerSW, setupInstall, drawQR } from "./ui.js";
import { voice } from "./voice.js";
import { isLearned } from "./coach.js";
import { conditionOf, SIDE_LABEL } from "./conditions.js";

const CFG = window.APP_CONFIG;
registerSW();
$("#appName").textContent = CFG.APP_NAME;
if (DEMO) $("#demoBanner").hidden = false;
else if (!getDevice()) location.replace("index.html");
setupInstall($("#installBtn"), "หลังติดตั้งแล้ว ถ้าแอปถามรหัส ให้สแกน QR จากนักกายภาพอีกครั้ง");

$("#today").textContent = new Date().toLocaleDateString("th-TH", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

let data = store.get("cache_patient");
if (data) render(data);
load();

async function load() {
  try {
    const sent = await flushQueue();
    if (sent) toast(`ส่งผลการฝึกที่ค้างไว้แล้ว ${sent} รายการ`, "good");
    data = await api("patient.get");
    store.set("cache_patient", data);
    render(data);
    loadWeek();
  } catch (e) {
    if (!data) $("#plan").innerHTML = `<div class="card">โหลดข้อมูลไม่สำเร็จ: ${esc(e.message)}</div>`;
    else toast("ออฟไลน์ — ใช้ข้อมูลล่าสุดในเครื่อง", "info");
    if (/ไม่ถูกต้อง|ไม่พบ/.test(e.message) && !e.network) {
      clearDevice();
      location.replace("index.html");
    }
  }
}

function render(d) {
  const name = d.patient.name || "";
  $("#hello").textContent = `สวัสดีครับ คุณ${name}`;
  const items = planItems(d.patient.plan);
  const todayByEx = {};
  for (const s of d.today || []) todayByEx[s.exercise] = (todayByEx[s.exercise] || 0) + Number(s.reps || 0);
  let done = 0;
  $("#plan").innerHTML = items.length
    ? items
        .map((it) => {
          const goal = (it.reps || it.ex.defaults.reps) * (it.sets || it.ex.defaults.sets);
          const got = todayByEx[it.id] || 0;
          const pct = Math.min(100, Math.round((got / goal) * 100));
          if (pct >= 100) done++;
          return `<a class="ex-tile ${pct >= 100 ? "done" : ""}" href="exercise.html?ex=${it.id}">
            <div class="ex-icon">${pct >= 100 ? "✅" : it.ex.icon}</div>
            <div style="flex:1">
              <div class="name">${esc(it.ex.name)}</div>
              <div class="muted">${it.reps || it.ex.defaults.reps} ครั้ง × ${it.sets || it.ex.defaults.sets} เซต · วันนี้ทำแล้ว ${got} ครั้ง</div>
              ${isLearned(it.id) ? "" : `<span class="learn-badge">📖 ยังไม่ได้เรียนท่า</span>`}
              <div class="progress"><i style="width:${pct}%"></i></div>
            </div></a>`;
        })
        .join("")
    : `<div class="card muted">ยังไม่มีแผนการฝึก กรุณาติดต่อนักกายภาพ</div>`;
  $("#doneBadge").textContent = items.length ? `เสร็จ ${done}/${items.length}` : "";
  const cond = conditionOf(d.patient);
  if (cond.precautions.length) {
    $("#precBox").hidden = false;
    $("#precBox").innerHTML = `<h3>⚠️ ข้อควรระวังสำหรับคุณ${d.patient.affectedSide ? ` (ข้าง${SIDE_LABEL[d.patient.affectedSide]}อ่อนแรง)` : ""}</h3>
      <ul>${cond.precautions.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      ${cond.warningCheck ? `<p style="margin:0"><b>ถ้ามีหน้าเบี้ยว แขนขาอ่อนแรงทันที พูดไม่ชัด ให้โทร 1669 ทันที</b></p>` : ""}`;
  } else $("#precBox").hidden = true;
  renderFamily(d.family || [], d.lineReady);
}

function renderFamily(fam, lineReady) {
  const approved = fam.filter((f) => f.status === "approved");
  const pending = fam.filter((f) => f.status === "pending");
  let html = approved.length
    ? approved.map((f) => `<div class="list-item"><span>👤 ${esc(f.displayName)} <span class="badge">${esc(f.relation || "ญาติ")}</span></span></div>`).join("")
    : `<p>ยังไม่มีญาติที่เชื่อมต่อ</p>`;
  if (pending.length) {
    html += pending
      .map(
        (f) => `<div class="card stack" style="border-color:var(--warn);margin-top:10px">
        <b>มีคนขอรับแจ้งเตือน</b>
        <div>${esc(f.displayName)} (${esc(f.relation || "ไม่ระบุ")})</div>
        <div class="row gap"><button class="btn good" data-approve="${f.id}">อนุญาต</button>
        <button class="btn ghost" data-reject="${f.id}">ไม่อนุญาต</button></div></div>`
      )
      .join("");
  }
  if (!DEMO && lineReady === false) html += `<p class="note">ผู้ดูแลระบบยังไม่ได้ตั้งค่า LINE การแจ้งเตือนจะยังไม่ถูกส่ง</p>`;
  $("#family").innerHTML = html;
  $$("[data-approve]").forEach((b) => (b.onclick = () => familyAction(b.dataset.approve, true)));
  $$("[data-reject]").forEach((b) => (b.onclick = () => familyAction(b.dataset.reject, false)));
}

async function familyAction(id, approve) {
  try {
    await api("patient.familyAction", { familyId: id, approve });
    toast(approve ? "อนุญาตแล้ว ญาติจะได้รับแจ้งเตือน" : "ปฏิเสธแล้ว", "good");
    load();
  } catch (e) {
    toast(e.message, "error");
  }
}

async function loadWeek() {
  try {
    const { sessions } = await api("patient.history");
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      const key = d.toLocaleDateString("sv-SE");
      const list = sessions.filter((s) => new Date(s.at).toLocaleDateString("sv-SE") === key);
      days.push({ d, reps: list.reduce((t, s) => t + Number(s.reps || 0), 0) });
    }
    const max = Math.max(10, ...days.map((x) => x.reps));
    $("#week").innerHTML = `<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px;align-items:end;height:120px">
      ${days
        .map(
          (x) => `<div style="display:flex;flex-direction:column;align-items:center;gap:4px;height:100%;justify-content:flex-end">
          <small>${x.reps || ""}</small>
          <div style="width:100%;border-radius:6px;background:${x.reps ? "var(--primary)" : "var(--surface-2)"};height:${Math.max(4, (x.reps / max) * 80)}px"></div>
          <small class="muted">${x.d.toLocaleDateString("th-TH", { weekday: "short" })}</small></div>`
        )
        .join("")}</div>`;
  } catch {}
}

// ---------- ปุ่มขอความช่วยเหลือ ----------
$("#sosBtn").onclick = async () => {
  if (!(await confirmBox("ขอความช่วยเหลือ?", "ระบบจะส่งข้อความด่วนไปหาญาติทุกคนที่เชื่อมต่อไว้", "ส่งเลย", true))) return;
  try {
    const r = await api("patient.alert", { type: "sos", detail: "กดปุ่มขอความช่วยเหลือจากหน้าหลัก" });
    voice.say("แจ้งญาติแล้วครับ", { priority: true });
    modal(`<h2>${r.demo ? "โหมดทดลอง" : r.notified ? `แจ้งญาติแล้ว ${r.notified} คน` : "ยังไม่มีญาติที่รับแจ้งเตือน"}</h2>
      <p>${r.notified ? "รอสักครู่ ญาติจะติดต่อกลับ" : "กรุณาโทรหาญาติ หรือโทรฉุกเฉิน 1669"}</p>
      <a class="btn danger block" href="tel:1669">📞 โทร 1669</a><br>
      <button class="btn ghost block" data-close>ปิด</button>`);
  } catch (e) {
    modal(`<h2>ส่งไม่สำเร็จ</h2><p>${esc(e.message)}</p><a class="btn danger block" href="tel:1669">📞 โทร 1669</a><br><button class="btn ghost block" data-close>ปิด</button>`);
  }
};

// ---------- เชื่อมต่อญาติด้วย QR ----------
$("#linkBtn").onclick = async () => {
  if (DEMO) return toast("โหมดทดลอง: ต้องตั้งค่าเซิร์ฟเวอร์และ LINE ก่อน", "info", 5000);
  let r;
  try {
    r = await api("patient.linkCode");
  } catch (e) {
    return toast(e.message, "error");
  }
  const url = r.liffUrl || r.oaUrl;
  const m = modal(
    `<h2 class="center">ให้ญาติสแกนด้วย LINE</h2>
     <div class="qr-box" id="qr"></div>
     <p class="center muted" style="margin-top:10px">หรือพิมพ์รหัสนี้ในแชท LINE ${r.oaId ? `<b>${esc(r.oaId)}</b>` : ""}</p>
     <div class="code-big">${esc(r.code)}</div>
     <p class="center muted small" id="exp"></p>
     <div id="pendingBox"></div>
     <button class="btn ghost block" data-close>ปิด</button>`,
    { onClose: () => clearInterval(poll) }
  );
  if (url) drawQR(m.el.querySelector("#qr"), url, 240).catch(() => (m.el.querySelector("#qr").textContent = url));
  else m.el.querySelector("#qr").innerHTML = `<p class="muted">ยังไม่ได้ตั้งค่า LINE (ดูคู่มือ ขั้นที่ 4)</p>`;
  const exp = new Date(r.expiresAt).getTime();
  let tick = 0;
  const poll = setInterval(async () => {
    const left = Math.max(0, Math.round((exp - Date.now()) / 1000));
    const el = m.el.querySelector("#exp");
    if (el) el.textContent = left ? `รหัสหมดอายุใน ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} นาที` : "รหัสหมดอายุแล้ว กดปิดแล้วสร้างใหม่";
    if (++tick % 4 === 0) {
      try {
        const d = await api("patient.get");
        store.set("cache_patient", d);
        const pend = (d.family || []).filter((f) => f.status === "pending");
        if (pend.length) {
          clearInterval(poll);
          m.close();
          render(d);
          voice.say("มีญาติขอเชื่อมต่อ กดอนุญาตได้เลยครับ", { priority: true });
          document.querySelector("[data-approve]")?.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      } catch {}
    }
  }, 1000);
};

// ---------- ตั้งค่า ----------
$("#settingsBtn").onclick = () => {
  const dev = getDevice();
  const m = modal(`<h2>ตั้งค่า</h2>
    <div class="list-item"><span>เสียงพูดแนะนำ</span><button class="btn sm" id="vt">${voice.enabled ? "เปิดอยู่" : "ปิดอยู่"}</button></div>
    <div class="list-item"><span>ทดสอบเสียง</span><button class="btn sm" id="vtest">▶️ ฟัง</button></div>
    ${dev ? `<div class="list-item"><span>รหัสผู้ฝึก</span><b>${esc(dev.patientId)}</b></div>` : ""}
    ${!voice.voice && voice.supported ? `<p class="note">เครื่องนี้ไม่พบเสียงภาษาไทย ให้ติดตั้งเสียงไทยในการตั้งค่ามือถือ (การช่วยการเข้าถึง → อ่านออกเสียง)</p>` : ""}
    ${dev ? `<button class="btn ghost block" id="unpair" style="margin-top:12px">ยกเลิกการลงทะเบียนเครื่องนี้</button>` : ""}
    <button class="btn primary block" data-close style="margin-top:12px">ปิด</button>`);
  m.el.querySelector("#vt").onclick = (e) => {
    voice.setEnabled(!voice.enabled);
    e.target.textContent = voice.enabled ? "เปิดอยู่" : "ปิดอยู่";
  };
  m.el.querySelector("#vtest").onclick = () => {
    voice.unlock();
    voice.say("สวัสดีครับ พร้อมฝึกกายภาพแล้วครับ", { priority: true });
  };
  const un = m.el.querySelector("#unpair");
  if (un)
    un.onclick = async () => {
      if (await confirmBox("ยกเลิกการลงทะเบียน?", "ต้องสแกน QR จากนักกายภาพใหม่เพื่อใช้งานอีกครั้ง", "ยกเลิกการลงทะเบียน", true)) {
        clearDevice();
        location.replace("index.html");
      }
    };
};
