// ตัวจำลอง Google Apps Script สำหรับทดสอบ Code.gs ในเครื่อง
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const code = fs.readFileSync(path.join(here, "../backend/Code.gs"), "utf8");

export function createGas() {
// ---------- จำลอง Google Apps Script ----------
const T = { clock: Date.now() };
const RealDate = Date;
class FakeDate extends RealDate {
  constructor(...a) { super(...(a.length ? a : [T.clock])); }
  static now() { return T.clock; }
}
function fmt(d, tz, pat) {
  const t = new RealDate(d.getTime() + 7 * 3600000); // Asia/Bangkok
  const p = (n, w = 2) => String(n).padStart(w, "0");
  const Y = t.getUTCFullYear(), M = t.getUTCMonth() + 1, D = t.getUTCDate(), h = t.getUTCHours(), m = t.getUTCMinutes(), s = t.getUTCSeconds();
  return pat
    .replace("yyyy-MM-dd'T'HH:mm:ssXXX", `${Y}-${p(M)}-${p(D)}T${p(h)}:${p(m)}:${p(s)}+07:00`)
    .replace("yyMMddHHmmss", `${String(Y).slice(2)}${p(M)}${p(D)}${p(h)}${p(m)}${p(s)}`)
    .replace("yyyy-MM-dd", `${Y}-${p(M)}-${p(D)}`)
    .replace("d/M/yyyy", `${D}/${M}/${Y}`)
    .replace("HH:mm", `${p(h)}:${p(m)}`);
}
function makeSheet(name) {
  const rows = [];
  const api = {
    name, rows,
    getLastRow: () => rows.length,
    getMaxRows: () => 1000,
    setFrozenRows() {},
    getRange(r, c, nr = 1, nc = 1) {
      return {
        setValues(v) { v.forEach((row, i) => { rows[r - 1 + i] = rows[r - 1 + i] || []; row.forEach((x, j) => (rows[r - 1 + i][c - 1 + j] = x)); }); return this; },
        setValue(x) { rows[r - 1] = rows[r - 1] || []; rows[r - 1][c - 1] = x; return this; },
        getValues() { return Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (rows[r - 1 + i] || [])[c - 1 + j] ?? "")); },
        setFontWeight() { return this; }, setBackground() { return this; }, setNumberFormat() { return this; },
      };
    },
  };
  return api;
}
const sheets = {};
const props = {};
const cache = {};
const pushes = [], replies = [];
const ctx = {
  console: { log() {}, error() {} },
  Date: FakeDate, Math, JSON, String, Number, isFinite, encodeURIComponent, Object, Array, Error, parseInt,
  SpreadsheetApp: { getActiveSpreadsheet: () => ({
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => (sheets[n] = makeSheet(n)),
    getSheets: () => Object.values(sheets),
    deleteSheet: (s) => delete sheets[s.name],
  }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => (props[k] = v) }) },
  CacheService: { getScriptCache: () => ({ get: (k) => cache[k] ?? null, put: (k, v) => (cache[k] = v) }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  ScriptApp: { getProjectTriggers: () => [], deleteTrigger() {}, newTrigger: () => { const t = { timeBased: () => t, atHour: () => t, everyDays: () => t, inTimezone: () => t, create: () => t }; return t; } },
  Utilities: { formatDate: fmt },
  Logger: { log() {} },
  ContentService: { MimeType: { JSON: "json" }, createTextOutput: (s) => ({ body: s, setMimeType() { return this; } }) },
  UrlFetchApp: {
    fetch(url, opt) {
      const ok200 = (body) => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify(body) });
      if (url.includes("/verify")) return opt.payload.id_token === "good-token" ? ok200({ sub: "Ufamily2", name: "หลานชาย" }) : { getResponseCode: () => 400, getContentText: () => "{}" };
      if (url.includes("/profile/")) return ok200({ displayName: "ลูกสาว" });
      if (url.endsWith("/push")) { pushes.push(JSON.parse(opt.payload)); return ok200({}); }
      if (url.endsWith("/reply")) { replies.push(JSON.parse(opt.payload)); return ok200({}); }
      throw new Error("unexpected " + url);
    },
  },
};
vm.createContext(ctx);
vm.runInContext(code + "\nthis.__ = { setup, doPost, doGet, dailyCheck };", ctx);
const G = ctx.__;
const call = (action, data = {}) => JSON.parse(G.doPost({ postData: { contents: JSON.stringify({ action, ...data }) } }).body);
const webhook = (events) => G.doPost({ postData: { contents: JSON.stringify({ destination: "x", events }) } });

  return { G, call, webhook, sheets, props, pushes, replies, T };
}
