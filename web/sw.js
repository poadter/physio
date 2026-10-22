// Service worker: ทำให้ติดตั้งเป็นแอปได้ และเปิดได้แม้สัญญาณอ่อน
// เมื่อแก้ไฟล์แอป ให้เปลี่ยนเลขเวอร์ชันนี้ เพื่อให้เครื่องผู้ใช้โหลดของใหม่
const VERSION = "physio-v1";
const SHELL = [
  "./", "index.html", "home.html", "exercise.html", "admin.html", "config.js", "manifest.json",
  "css/app.css", "js/api.js", "js/ui.js", "js/voice.js", "js/pose-engine.js",
  "js/exercise.js", "js/home.js", "js/index.js", "js/admin.js",
  "icons/icon-192.png", "icons/icon-512.png",
];
// ไฟล์ AI และฟอนต์จากภายนอก เก็บไว้หลังโหลดครั้งแรก
const CDN = ["cdn.jsdelivr.net", "storage.googleapis.com", "cdnjs.cloudflare.com", "fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== "cdn").map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // ไม่ยุ่งกับเซิร์ฟเวอร์ Apps Script และ LINE
  if (url.hostname.endsWith("google.com") && !CDN.includes(url.hostname)) return;
  if (url.hostname.includes("line")) return;

  if (CDN.includes(url.hostname)) {
    // cache-first: ไฟล์ AI ใหญ่ โหลดครั้งเดียวพอ
    e.respondWith(
      caches.open("cdn").then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok || res.type === "opaque") c.put(req, res.clone());
        return res;
      })
    );
    return;
  }

  if (url.origin === location.origin) {
    // network-first: ได้ของใหม่เสมอเมื่อออนไลน์ ใช้ของในเครื่องเมื่อออฟไลน์
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }))
    );
  }
});
