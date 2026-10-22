// =============================================================
//  admin.js — หน้าจัดการสำหรับนักกายภาพ
// =============================================================
import { api, DEMO } from "./api.js";
import { EXERCISE_LIST, EXERCISES, resolveParams, ISSUE_LABEL, PAIN_LABEL } from "./pose-engine.js";
import { $, $$, esc, toast, modal, confirmBox, fmtDate, daysAgo, loadScript, drawQR, registerSW } from "./ui.js";

const CFG = window.APP_CONFIG;
const CHART_LIB = "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js";
const ALERT_INFO = {
  fall: ["🚨 ล้ม", "danger"], sos: ["🆘 ขอความช่วยเหลือ", "danger"], pain: ["⚠️ เจ็บ/เวียนศีรษะ", "warn"],
  missed: ["📅 ไม่ได้ฝึก", "warn"], decline: ["📉 ผลลดลง", "warn"],
};
let state = { tab: "patients", overview: null, cfg: {} };
let charts = [];
registerSW();

// ---------- เข้าสู่ระบบ ----------
if (DEMO) {
  $("#demoBanner").hidden = false;
  $("#app").hidden = false;
  $$("#tabs [data-tab]").forEach((b) => (b.hidden = b.dataset.tab !== "test"));
  go("test");
} else if (sessionStorage.getItem("adminPin")) {
  start();
} else $("#login").hidden = false;

$("#loginBtn").onclick = login;
$("#pin").onkeydown = (e) => e.key === "Enter" && login();
async function login() {
  sessionStorage.setItem("adminPin", $("#pin").value.trim());
  try {
    await start();
  } catch {}
}
async function start() {
  try {
    const r = await api("admin.login");
    state.cfg = { ...r.config, lineReady: r.lineReady };
  } catch (e) {
    sessionStorage.removeItem("adminPin");
    $("#login").hidden = false;
    $("#app").hidden = true;
    toast(e.message, "error", 6000);
    throw e;
  }
  $("#login").hidden = true;
  $("#app").hidden = false;
  $("#logoutBtn").hidden = false;
  go("patients");
}
$("#logoutBtn").onclick = () => {
  sessionStorage.removeItem("adminPin");
  location.reload();
};
$$("#tabs [data-tab]").forEach((b) => (b.onclick = () => go(b.dataset.tab)));

function go(tab) {
  state.tab = tab;
  $$("#tabs [data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  charts.forEach((c) => c.destroy());
  charts = [];
  ({ patients: viewPatients, alerts: viewAlerts, test: viewTest, system: viewSystem })[tab]();
}

// =============================================================
//  รายชื่อผู้ฝึก
// =============================================================
async function viewPatients() {
  const v = $("#view");
  v.innerHTML = `<div class="card muted">กำลังโหลด…</div>`;
  let ov;
  try {
    ov = state.overview = await api("admin.overview");
  } catch (e) {
    return (v.innerHTML = `<div class="card">โหลดไม่สำเร็จ: ${esc(e.message)}</div>`);
  }
  $("#alertCount").textContent = ov.alerts.length ? `(${ov.alerts.length})` : "";
  const ps = ov.patients.filter((p) => p.active);
  const trainedToday = ps.filter((p) => daysAgo(p.lastSessionAt) === 0).length;
  const notTrained = ps.filter((p) => p.lastSessionAt === "" || daysAgo(p.lastSessionAt) >= 2).length;
  v.innerHTML = `
    <div class="kpis" style="margin-bottom:14px">
      <div class="kpi"><b>${ps.length}</b><span>ผู้ฝึกทั้งหมด</span></div>
      <div class="kpi"><b>${trainedToday}</b><span>ฝึกแล้ววันนี้</span></div>
      <div class="kpi"><b>${notTrained}</b><span>ไม่ได้ฝึก ≥ 2 วัน</span></div>
      <div class="kpi"><b>${ov.alerts.length}</b><span>แจ้งเตือนรอตรวจ</span></div>
    </div>
    ${!ov.lineReady ? `<div class="note" style="margin-bottom:14px">⚠️ ยังไม่ได้ตั้งค่า LINE — ระบบบันทึกแจ้งเตือนไว้ แต่ยังไม่ส่งถึงญาติ (ดูแท็บ "สถานะระบบ")</div>` : ""}
    <div class="card">
      <div class="row between" style="margin-bottom:8px"><h2 style="margin:0">ผู้ฝึก</h2>
        <div class="row gap"><input id="search" placeholder="ค้นหาชื่อ/รหัส" style="min-height:42px;width:200px" />
        <button class="btn primary sm" id="addBtn">➕ เพิ่มผู้ฝึก</button></div></div>
      <div class="table-scroll"><table class="table" id="ptable">
        <thead><tr><th>ผู้ฝึก</th><th>ฝึกล่าสุด</th><th>7 วัน: วันที่ฝึก</th><th>7 วัน: จำนวนครั้ง</th><th>ทำถูก</th><th>ญาติ</th><th>แจ้งเตือน</th></tr></thead>
        <tbody></tbody></table></div>
    </div>`;
  const render = (q = "") => {
    const rows = ov.patients.filter((p) => !q || p.name.includes(q) || p.id.toLowerCase().includes(q.toLowerCase()));
    $("#ptable tbody").innerHTML = rows.length
      ? rows
          .map((p) => {
            const d = daysAgo(p.lastSessionAt);
            const last = p.lastSessionAt ? (d === 0 ? `<span class="badge good">วันนี้</span>` : d >= 2 ? `<span class="badge warn">${d} วันก่อน</span>` : `<span class="badge">เมื่อวาน</span>`) : `<span class="badge">ยังไม่เคย</span>`;
            return `<tr data-id="${p.id}" style="cursor:pointer;${p.active ? "" : "opacity:.5"}">
              <td><b>${esc(p.name)}</b><br><span class="muted small">${p.id}${p.age ? " · " + esc(p.age) + " ปี" : ""}${p.active ? "" : " · ปิดใช้งาน"}</span></td>
              <td>${last}</td><td>${p.daysActive7d}/7</td><td>${p.reps7d}</td>
              <td>${p.goodPct7d === null ? "-" : p.goodPct7d + "%"}</td>
              <td>${p.family}${p.pendingFamily ? ` <span class="badge warn">รอ ${p.pendingFamily}</span>` : ""}</td>
              <td>${p.newAlerts ? `<span class="badge danger">${p.newAlerts}</span>` : "-"}</td></tr>`;
          })
          .join("")
      : `<tr><td colspan="7" class="muted">ยังไม่มีผู้ฝึก กด "เพิ่มผู้ฝึก"</td></tr>`;
    $$("#ptable tbody tr[data-id]").forEach((tr) => (tr.onclick = () => viewDetail(tr.dataset.id)));
  };
  render();
  $("#search").oninput = (e) => render(e.target.value.trim());
  $("#addBtn").onclick = addPatient;
}

// ---------- ตัวแก้ไขแผนการฝึก ----------
function planEditor(plan) {
  const byId = Object.fromEntries((plan?.exercises || []).map((x) => [x.id, x]));
  return `<div id="planEd">
    ${EXERCISE_LIST.map((ex) => {
      const cur = byId[ex.id];
      const p = resolveParams(ex, cur || {});
      return `<div class="plan-row"><input type="checkbox" data-ex="${ex.id}" ${cur ? "checked" : ""} aria-label="${esc(ex.name)}" />
        <div><b>${ex.icon} ${esc(ex.name)}</b> <span class="muted small">— ${ex.view === "side" ? "ถ่ายด้านข้าง" : "ถ่ายด้านหน้า"} · วัด${esc(ex.metricLabel)} (${ex.unit})</span>
        <div class="plan-params">
          ${[["reps", "ครั้ง/เซต"], ["sets", "เซต"], ["down", "ท่าเริ่ม ≤"], ["up", "นับเมื่อ ≥"], ["good", "สมบูรณ์ ≥"]]
            .map(([k, l]) => `<div><label>${l}</label><input type="number" data-ex="${ex.id}" data-k="${k}" value="${p[k]}" /></div>`)
            .join("")}
        </div></div></div>`;
    }).join("")}
    <div class="field" style="margin-top:12px;max-width:220px"><label>พักระหว่างเซต (วินาที)</label><input type="number" id="restSec" value="${plan?.restSec ?? 30}" /></div>
    <p class="note small">ค่าองศา: "ท่าเริ่ม" = กลับสู่ท่าเริ่มต้น · "นับเมื่อ" = ถึงท่าแล้วนับ 1 ครั้ง · "สมบูรณ์" = ทำได้เต็มองศา (นับเป็นทำถูก)<br>
    ผู้ป่วยที่ข้อติดหรืออ่อนแรง ให้ลดค่า "นับเมื่อ" และ "สมบูรณ์" ลง แล้วค่อยเพิ่มขึ้นเมื่อดีขึ้น · ใช้แท็บ "ทดลองท่า" เพื่อดูองศาจริงของผู้ป่วยก่อนตั้งค่า</p>
  </div>`;
}
function readPlan(root) {
  const exercises = [];
  $$("input[type=checkbox][data-ex]", root).forEach((cb) => {
    if (!cb.checked) return;
    const o = { id: cb.dataset.ex };
    $$(`input[data-ex="${cb.dataset.ex}"][data-k]`, root).forEach((i) => (o[i.dataset.k] = Number(i.value)));
    exercises.push(o);
  });
  return { exercises, restSec: Number($("#restSec", root).value) || 30 };
}

function addPatient() {
  const m = modal(
    `<h2>เพิ่มผู้ฝึก</h2>
    <div class="grid2"><div class="field"><label>ชื่อ-นามสกุล *</label><input id="nName" /></div>
    <div class="field"><label>อายุ</label><input id="nAge" type="number" /></div></div>
    <div class="field"><label>เบอร์ติดต่อ</label><input id="nPhone" /></div>
    <div class="field"><label>บันทึก (โรค/ข้อควรระวัง)</label><textarea id="nNote" rows="2"></textarea></div>
    <h3 style="margin-top:16px">แผนการฝึก</h3>${planEditor({ exercises: [{ id: "sit_to_stand" }, { id: "arm_raise" }], restSec: 30 })}
    <div class="row gap" style="margin-top:14px"><button class="btn ghost" data-close>ยกเลิก</button><button class="btn primary" id="nSave">บันทึก</button></div>`,
    { wide: true }
  );
  $("#nSave", m.el).onclick = async () => {
    const name = $("#nName", m.el).value.trim();
    if (!name) return toast("กรุณาใส่ชื่อ", "error");
    try {
      const r = await api("admin.createPatient", { name, age: $("#nAge", m.el).value, phone: $("#nPhone", m.el).value, note: $("#nNote", m.el).value, plan: readPlan(m.el) });
      m.close();
      toast("เพิ่มผู้ฝึกแล้ว", "good");
      showPairQR(r.patient);
      viewPatients();
    } catch (e) {
      toast(e.message, "error");
    }
  };
}

function pairUrl(p) {
  const base = location.href.replace(/[^/]*$/, "");
  return `${base}index.html#pair=${p.id}.${p.token}`;
}
function showPairQR(p) {
  const m = modal(`<h2 class="center">ลงทะเบียนเครื่องของคุณ${esc(p.name)}</h2>
    <p class="center muted">ใช้กล้องมือถือของผู้ฝึกสแกน QR นี้ (หรือกด "สแกน QR" ในแอป)</p>
    <div class="qr-box" id="pq"></div>
    <p class="center" style="margin-top:10px">หรือพิมพ์รหัส: <b>${p.id}</b> · รหัสลับ <b>${p.token}</b></p>
    <p class="note small">QR นี้ใช้แทนรหัสผ่านของผู้ฝึก อย่าส่งให้คนอื่น หากหลุดให้กด "เปลี่ยนรหัสลับ"</p>
    <div class="row gap"><button class="btn ghost" id="cpy">คัดลอกลิงก์</button><button class="btn primary" data-close>เสร็จ</button></div>`);
  drawQR($("#pq", m.el), pairUrl(p), 260).catch(() => ($("#pq", m.el).innerHTML = `<p class="small" style="word-break:break-all">${esc(pairUrl(p))}</p>`));
  $("#cpy", m.el).onclick = () => navigator.clipboard?.writeText(pairUrl(p)).then(() => toast("คัดลอกแล้ว", "good"));
}

// =============================================================
//  รายละเอียดผู้ฝึก
// =============================================================
async function viewDetail(id) {
  charts.forEach((c) => c.destroy());
  charts = [];
  const v = $("#view");
  v.innerHTML = `<div class="card muted">กำลังโหลด…</div>`;
  let d;
  try {
    d = await api("admin.patientDetail", { id });
  } catch (e) {
    return (v.innerHTML = `<div class="card">โหลดไม่สำเร็จ: ${esc(e.message)}</div>`);
  }
  const p = d.patient;
  const s30 = d.sessions.filter((s) => daysAgo(s.at) < 30);
  const reps = s30.reduce((t, s) => t + s.reps, 0);
  const good = s30.reduce((t, s) => t + s.goodReps, 0);
  const days = new Set(s30.map((s) => s.at.slice(0, 10))).size;
  const issues = {};
  s30.forEach((s) => Object.entries(s.issues || {}).forEach(([k, n]) => (issues[k] = (issues[k] || 0) + n)));
  const painCount = s30.filter((s) => s.painAfter === "severe" || s.painBefore === "severe").length;

  v.innerHTML = `
    <button class="btn ghost sm" id="back">‹ รายชื่อผู้ฝึก</button>
    <div class="row between" style="margin:14px 0">
      <div><h1 style="margin:0">${esc(p.name)}</h1><div class="muted">${p.id}${p.age ? " · " + esc(p.age) + " ปี" : ""}${p.phone ? " · ☎ " + esc(p.phone) : ""}${p.active ? "" : ' · <span class="badge danger">ปิดใช้งาน</span>'}</div>
      ${p.note ? `<div class="note small" style="margin-top:6px">${esc(p.note)}</div>` : ""}</div>
      <div class="row gap"><button class="btn primary sm" id="qrBtn">📱 QR ลงทะเบียนเครื่อง</button><button class="btn ghost sm" id="editBtn">✏️ แก้ไขข้อมูล</button></div>
    </div>
    <div class="kpis">
      <div class="kpi"><b>${days}</b><span>วันที่ฝึก (30 วัน)</span></div>
      <div class="kpi"><b>${reps}</b><span>จำนวนครั้งรวม</span></div>
      <div class="kpi"><b>${reps ? Math.round((good / reps) * 100) + "%" : "-"}</b><span>ทำท่าถูก</span></div>
      <div class="kpi"><b>${painCount}</b><span>ครั้งที่แจ้งเจ็บมาก</span></div>
    </div>
    <div class="grid2" style="margin-top:14px">
      <div class="card"><h3>จำนวนครั้งต่อวัน (30 วัน)</h3><div class="chart-box"><canvas id="c1" role="img" aria-label="กราฟจำนวนครั้งต่อวัน"></canvas></div></div>
      <div class="card"><h3>ทำท่าถูก % ต่อวัน (30 วัน)</h3><div class="chart-box"><canvas id="c2" role="img" aria-label="กราฟเปอร์เซ็นต์ทำท่าถูกต่อวัน"></canvas></div></div>
    </div>
    <div class="card" style="margin-top:14px"><h3>จุดที่ทำผิดบ่อย (30 วัน)</h3>
      ${Object.keys(issues).length ? Object.entries(issues).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<span class="badge warn" style="margin:3px">${esc(ISSUE_LABEL[k] || k)}: ${n}</span>`).join("") : '<p class="muted">ไม่มี</p>'}
    </div>
    <div class="card" style="margin-top:14px"><div class="row between"><h3 style="margin:0">แผนการฝึก</h3><button class="btn primary sm" id="savePlan">บันทึกแผน</button></div>${planEditor(p.plan)}</div>
    <div class="grid2" style="margin-top:14px">
      <div class="card"><div class="row between"><h3 style="margin:0">ญาติที่รับแจ้งเตือน</h3><button class="btn ghost sm" id="testLine">ส่งข้อความทดสอบ</button></div><div id="famList"></div></div>
      <div class="card"><h3>แจ้งเตือน</h3><div id="alList"></div></div>
    </div>
    <div class="card" style="margin-top:14px"><h3>ประวัติการฝึก</h3><div class="table-scroll"><table class="table">
      <thead><tr><th>เวลา</th><th>ท่า</th><th>ครั้ง</th><th>ทำถูก</th><th>เวลาฝึก</th><th>อาการก่อน/หลัง</th><th>หมายเหตุ</th></tr></thead>
      <tbody>${d.sessions.slice().reverse().slice(0, 60).map((s) => `<tr><td>${fmtDate(s.at)}</td><td>${esc(s.exerciseName || EXERCISES[s.exercise]?.name || s.exercise)}</td>
        <td>${s.reps}/${s.targetReps * (s.targetSets || 1) || "-"}</td><td>${s.reps ? Math.round((s.goodReps / s.reps) * 100) + "%" : "-"}</td>
        <td>${Math.round(s.durationSec / 60)} นาที</td><td>${esc(PAIN_LABEL[s.painBefore] || "-")} / ${esc(PAIN_LABEL[s.painAfter] || "-")}</td>
        <td>${s.stoppedEarly ? '<span class="badge warn">หยุดกลางคัน</span> ' : ""}${Object.entries(s.issues || {}).map(([k, n]) => esc(ISSUE_LABEL[k] || k) + " " + n).join(", ")}</td></tr>`).join("") || '<tr><td colspan="7" class="muted">ยังไม่มีข้อมูล</td></tr>'}</tbody></table></div></div>
    <div class="row gap" style="margin-top:14px">
      <button class="btn ghost sm" id="resetTok">🔑 เปลี่ยนรหัสลับ (เครื่องเดิมจะใช้ไม่ได้)</button>
      <button class="btn ghost sm" id="toggleAct">${p.active ? "⏸ ปิดใช้งาน" : "▶️ เปิดใช้งาน"}</button>
    </div>`;

  $("#back").onclick = () => go("patients");
  $("#qrBtn").onclick = () => showPairQR(p);
  $("#editBtn").onclick = () => editInfo(p);
  $("#savePlan").onclick = async () => {
    try {
      await api("admin.updatePatient", { id: p.id, plan: readPlan($("#view")) });
      toast("บันทึกแผนแล้ว ผู้ฝึกจะเห็นแผนใหม่เมื่อเปิดแอป", "good", 5000);
    } catch (e) {
      toast(e.message, "error");
    }
  };
  $("#testLine").onclick = async () => {
    try {
      const r = await api("admin.testLine", { id: p.id });
      toast(r.notified ? `ส่งถึงญาติ ${r.notified} คน` : "ไม่มีญาติที่รับแจ้งเตือน หรือยังไม่ได้ตั้งค่า LINE", r.notified ? "good" : "error", 5000);
    } catch (e) {
      toast(e.message, "error");
    }
  };
  $("#resetTok").onclick = async () => {
    if (!(await confirmBox("เปลี่ยนรหัสลับ?", "เครื่องที่ลงทะเบียนไว้จะใช้ไม่ได้ ต้องสแกน QR ใหม่", "เปลี่ยน", true))) return;
    const r = await api("admin.resetToken", { id: p.id });
    showPairQR(r.patient);
  };
  $("#toggleAct").onclick = async () => {
    await api("admin.updatePatient", { id: p.id, active: !p.active });
    viewDetail(p.id);
  };

  // ญาติ
  $("#famList").innerHTML = d.family.length
    ? d.family.map((f) => `<div class="list-item"><div>👤 <b>${esc(f.displayName)}</b> <span class="badge">${esc(f.relation || "-")}</span><br><span class="muted small">${fmtDate(f.at)}</span></div>
        <div class="row gap">${f.status === "pending" ? `<span class="badge warn">รออนุมัติ</span><button class="btn good sm" data-fa="approve" data-id="${f.id}">อนุมัติ</button>` : ""}
        <button class="btn ghost sm" data-fa="${f.status === "pending" ? "reject" : "remove"}" data-id="${f.id}">${f.status === "pending" ? "ปฏิเสธ" : "ลบ"}</button></div></div>`).join("")
    : `<p class="muted">ยังไม่มี — ให้ผู้ฝึกกด "เชื่อมต่อญาติ" ในแอป แล้วญาติสแกน QR ด้วย LINE</p>`;
  $$("[data-fa]").forEach((b) => (b.onclick = async () => {
    try {
      await api("admin.familyAction", { id: b.dataset.id, op: b.dataset.fa });
      viewDetail(p.id);
    } catch (e) {
      toast(e.message, "error");
    }
  }));
  // แจ้งเตือน
  $("#alList").innerHTML = d.alerts.length ? d.alerts.slice(0, 20).map(alertRow).join("") : `<p class="muted">ไม่มี</p>`;
  bindAck(() => viewDetail(p.id));

  drawCharts(d.sessions);
}

function editInfo(p) {
  const m = modal(`<h2>แก้ไขข้อมูล</h2>
    <div class="grid2"><div class="field"><label>ชื่อ-นามสกุล</label><input id="eName" value="${esc(p.name)}" /></div>
    <div class="field"><label>อายุ</label><input id="eAge" type="number" value="${esc(p.age)}" /></div></div>
    <div class="field"><label>เบอร์ติดต่อ</label><input id="ePhone" value="${esc(p.phone)}" /></div>
    <div class="field"><label>บันทึก</label><textarea id="eNote" rows="3">${esc(p.note)}</textarea></div>
    <div class="row gap" style="margin-top:14px"><button class="btn ghost" data-close>ยกเลิก</button><button class="btn primary" id="eSave">บันทึก</button></div>`);
  $("#eSave", m.el).onclick = async () => {
    await api("admin.updatePatient", { id: p.id, name: $("#eName", m.el).value, age: $("#eAge", m.el).value, phone: $("#ePhone", m.el).value, note: $("#eNote", m.el).value });
    m.close();
    viewDetail(p.id);
  };
}

async function drawCharts(sessions) {
  let hasLib = true;
  try {
    await loadScript(CHART_LIB);
  } catch {
    hasLib = false;
  }
  const labels = [], reps = [], pct = [];
  for (let i = 29; i >= 0; i--) {
    const day = new Date(Date.now() - i * 86400000);
    const key = day.toLocaleDateString("sv-SE");
    const list = sessions.filter((s) => new Date(s.at).toLocaleDateString("sv-SE") === key);
    const r = list.reduce((t, s) => t + s.reps, 0);
    const g = list.reduce((t, s) => t + s.goodReps, 0);
    labels.push(day.toLocaleDateString("th-TH", { day: "numeric", month: "short" }));
    reps.push(r);
    pct.push(r ? Math.round((g / r) * 100) : null);
  }
  if (!hasLib) {
    // ออฟไลน์/โหลดไลบรารีกราฟไม่ได้ → วาดแท่งแบบง่าย
    const bars = (vals, max, unit) => `<div style="display:flex;gap:2px;align-items:flex-end;height:220px">${vals
      .map((v, i) => `<div title="${labels[i]}: ${v ?? "-"}${unit}" style="flex:1;border-radius:4px 4px 0 0;background:var(--chart);height:${v ? Math.max(3, (v / max) * 100) : 0}%"></div>`)
      .join("")}</div><div class="row between muted small"><span>${labels[0]}</span><span>${labels[29]}</span></div>`;
    $("#c1").parentElement.innerHTML = bars(reps, Math.max(10, ...reps), " ครั้ง");
    $("#c2").parentElement.innerHTML = bars(pct, 100, "%");
    return;
  }
  const css = getComputedStyle(document.documentElement);
  const color = css.getPropertyValue("--chart").trim();
  const ink = css.getPropertyValue("--ink-2").trim();
  const grid = css.getPropertyValue("--line").trim();
  /* global Chart */
  Chart.defaults.font.family = "Sarabun, sans-serif";
  Chart.defaults.color = ink;
  const scales = (max) => ({
    x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } },
    y: { beginAtZero: true, max, grid: { color: grid }, border: { display: false } },
  });
  const tooltip = { intersect: false, mode: "index" };
  charts.push(new Chart($("#c1"), {
    type: "bar",
    data: { labels, datasets: [{ label: "จำนวนครั้ง", data: reps, backgroundColor: color, borderRadius: 4, maxBarThickness: 18 }] },
    options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip }, scales: scales() },
  }));
  charts.push(new Chart($("#c2"), {
    type: "line",
    data: { labels, datasets: [{ label: "ทำท่าถูก %", data: pct, borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: 4, spanGaps: true }] },
    options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip }, scales: scales(100) },
  }));
}

// =============================================================
//  แจ้งเตือน
// =============================================================
function alertRow(a) {
  const [label, kind] = ALERT_INFO[a.type] || [a.type, ""];
  return `<div class="list-item"><div><span class="badge ${kind}">${label}</span> <b>${esc(a.patientName)}</b>
    <div class="small">${esc(a.detail || "")}</div><div class="muted small">${fmtDate(a.at)} · ส่ง LINE ${a.notified || 0} คน</div></div>
    ${a.status === "new" ? `<button class="btn ghost sm" data-ack="${a.id}">รับทราบ</button>` : `<span class="badge good">รับทราบแล้ว</span>`}</div>`;
}
function bindAck(after) {
  $$("[data-ack]").forEach((b) => (b.onclick = async () => {
    await api("admin.ackAlert", { id: b.dataset.ack });
    after();
  }));
}
async function viewAlerts() {
  const v = $("#view");
  v.innerHTML = `<div class="card muted">กำลังโหลด…</div>`;
  try {
    state.overview = await api("admin.overview");
  } catch (e) {
    return (v.innerHTML = `<div class="card">${esc(e.message)}</div>`);
  }
  const al = state.overview.alerts;
  $("#alertCount").textContent = al.length ? `(${al.length})` : "";
  v.innerHTML = `<div class="card"><h2>แจ้งเตือนที่ยังไม่ได้ตรวจ</h2>${al.length ? al.map(alertRow).join("") : '<p class="muted">ไม่มี 🎉</p>'}</div>`;
  bindAck(viewAlerts);
}

// =============================================================
//  ทดลองท่า (ใช้สอนและหาค่าองศาที่เหมาะกับผู้ป่วย)
// =============================================================
function viewTest() {
  $("#view").innerHTML = `<div class="card stack">
    <h2>ทดลองท่า</h2>
    <p class="muted">ใช้สาธิตให้ผู้ป่วยดู หรือวัดองศาจริงของผู้ป่วยก่อนตั้งค่าในแผนการฝึก หน้าจอจะแสดงองศาแบบเรียลไทม์ และไม่บันทึกผล</p>
    ${EXERCISE_LIST.map((ex) => `<div class="plan-row" style="grid-template-columns:64px 1fr">
      <div class="ex-icon">${ex.icon}</div>
      <div><b>${esc(ex.name)}</b> <span class="muted small">— ${esc(ex.benefit)}</span>
      <div class="plan-params">${[["reps", "ครั้ง/เซต"], ["sets", "เซต"], ["down", "ท่าเริ่ม ≤"], ["up", "นับเมื่อ ≥"], ["good", "สมบูรณ์ ≥"]]
        .map(([k, l]) => `<div><label>${l}</label><input type="number" data-t="${ex.id}" data-k="${k}" value="${ex.defaults[k]}" /></div>`).join("")}</div>
      <button class="btn primary sm" style="margin-top:8px" data-try="${ex.id}">▶️ ทดลอง</button></div></div>`).join("")}
  </div>`;
  $$("[data-try]").forEach((b) => (b.onclick = () => {
    const q = new URLSearchParams({ ex: b.dataset.try, test: "1" });
    $$(`[data-t="${b.dataset.try}"]`).forEach((i) => q.set(i.dataset.k, i.value));
    location.href = "exercise.html?" + q;
  }));
}

// =============================================================
//  สถานะระบบ
// =============================================================
function viewSystem() {
  const c = state.cfg;
  const row = (label, okv, hint) => `<div class="list-item"><span>${label}</span>${okv ? '<span class="badge good">พร้อม</span>' : `<span class="badge warn">ยังไม่ตั้งค่า</span>`}</div>${!okv && hint ? `<p class="muted small" style="margin:4px 0 8px">${hint}</p>` : ""}`;
  $("#view").innerHTML = `<div class="card stack">
    <h2>สถานะระบบ</h2>
    ${row("เซิร์ฟเวอร์ (Apps Script)", !!CFG.API_URL)}
    ${row("LINE ส่งแจ้งเตือน (Channel access token)", c.lineReady, "ใส่ LINE_CHANNEL_ACCESS_TOKEN ใน Script Properties")}
    ${row("LINE ID บัญชีทางการ", !!c.oaId, "ใส่ LINE_OA_ID ใน Script Properties เช่น @123abcde")}
    ${row("LIFF (สแกน QR เชื่อมต่อญาติ)", !!c.liffId, "ใส่ LIFF_ID และ LINE_LOGIN_CHANNEL_ID ใน Script Properties — ถ้ายังไม่ตั้ง ญาติยังเชื่อมต่อได้ด้วยการพิมพ์รหัสใน LINE")}
    <div class="list-item"><span>ลิงก์แอปสำหรับผู้ฝึก</span><a href="index.html">${esc(location.href.replace(/[^/]*$/, ""))}</a></div>
    <div class="row gap"><button class="btn ghost" id="runDaily">▶️ ตรวจรายวันตอนนี้ (ไม่ได้ฝึก/ผลลดลง)</button></div>
  </div>`;
  $("#runDaily").onclick = async () => {
    try {
      const r = await api("admin.runDailyCheck");
      toast(`ตรวจแล้ว: ไม่ได้ฝึก ${r.missed.length} คน · ผลลดลง ${r.decline.length} คน`, "good", 5000);
    } catch (e) {
      toast(e.message, "error");
    }
  };
}
