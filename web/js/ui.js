// ตัวช่วยหน้าจอที่ใช้ร่วมกันทุกหน้า
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export function toast(msg, kind = "info", ms = 3500) {
  let box = $("#toasts");
  if (!box) {
    box = document.createElement("div");
    box.id = "toasts";
    document.body.appendChild(box);
  }
  const t = document.createElement("div");
  t.className = "toast " + kind;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

export function modal(html, { onClose, wide } = {}) {
  const wrap = document.createElement("div");
  wrap.className = "modal-wrap";
  wrap.innerHTML = `<div class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(wrap);
  const close = () => {
    wrap.remove();
    onClose && onClose();
  };
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap || e.target.closest("[data-close]")) close();
  });
  return { el: wrap.firstElementChild, close };
}

export function confirmBox(title, text, okLabel = "ยืนยัน", danger = false) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal(
      `<h2>${esc(title)}</h2><p>${esc(text)}</p>
       <div class="row gap"><button class="btn ghost" data-close>ยกเลิก</button>
       <button class="btn ${danger ? "danger" : "primary"}" id="cfOk">${esc(okLabel)}</button></div>`,
      { onClose: () => !done && resolve(false) }
    );
    m.el.querySelector("#cfOk").onclick = () => {
      done = true;
      m.close();
      resolve(true);
    };
  });
}

export function fmtDate(iso, withTime = true) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  const opt = { day: "numeric", month: "short", year: "2-digit" };
  if (withTime) Object.assign(opt, { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleString("th-TH", opt);
}

export function daysAgo(iso) {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

// ลงทะเบียน service worker (ทำให้ติดตั้งเป็นแอปได้ และเปิดเร็วขึ้น)
export function registerSW() {
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

// ปุ่มติดตั้งแอปลงหน้าจอ
export function setupInstall(btn, hint) {
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  if (standalone || !btn) return;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  let deferred = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e;
    btn.hidden = false;
  });
  if (ios) btn.hidden = false;
  btn.onclick = async () => {
    if (deferred) {
      deferred.prompt();
      await deferred.userChoice;
      deferred = null;
      btn.hidden = true;
    } else if (ios) {
      modal(`<h2>ติดตั้งแอปบน iPhone</h2>
        <ol class="big-list"><li>กดปุ่ม <b>แชร์</b> (สี่เหลี่ยมมีลูกศรชี้ขึ้น) ด้านล่างของ Safari</li>
        <li>เลื่อนลงแล้วเลือก <b>เพิ่มไปยังหน้าจอโฮม</b></li><li>กด <b>เพิ่ม</b></li></ol>
        ${hint ? `<p class="note">${hint}</p>` : ""}
        <button class="btn primary block" data-close>เข้าใจแล้ว</button>`);
    }
  };
}

export function loadScript(src) {
  return new Promise((res, rej) => {
    if ([...document.scripts].some((s) => s.src === src)) return res();
    const s = document.createElement("script");
    s.src = src;
    s.onload = res;
    s.onerror = () => rej(new Error("โหลดไม่สำเร็จ: " + src));
    document.head.appendChild(s);
  });
}

export const QR_LIB = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";
export const JSQR_LIB = "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js";

export async function drawQR(el, text, size = 240) {
  await loadScript(QR_LIB);
  el.innerHTML = "";
  // eslint-disable-next-line no-undef
  new QRCode(el, { text, width: size, height: size, correctLevel: QRCode.CorrectLevel.M });
}
