// เซิร์ฟเวอร์ทดสอบในเครื่อง: เสิร์ฟหน้าเว็บ + จำลอง Apps Script API
//   node tests/e2e/server.mjs  → เว็บ http://localhost:8000  API http://localhost:8001
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createGas } from "../gas-mock.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(here, "../../web");
const gas = createGas();
gas.G.setup();
Object.assign(gas.props, { ADMIN_PIN: "246810", LINE_CHANNEL_ACCESS_TOKEN: "tok", LINE_OA_ID: "@physio", LINE_LOGIN_CHANNEL_ID: "123", LIFF_ID: "123-abc" });

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png" };

http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p === "/") p = "/index.html";
  if (p === "/config.js") {
    res.writeHead(200, { "Content-Type": TYPES[".js"] });
    return res.end(fs.readFileSync(path.join(WEB, "config.js"), "utf8").replace('API_URL: ""', 'API_URL: "http://localhost:8001/exec"'));
  }
  if (p === "/__fake_vision.mjs") {
    res.writeHead(200, { "Content-Type": TYPES[".js"] });
    return res.end(fs.readFileSync(path.join(here, "fake-vision.mjs")));
  }
  const f = path.join(WEB, p);
  if (!f.startsWith(WEB) || !fs.existsSync(f)) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
}).listen(8000);

http.createServer((req, res) => {
  const cors = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    gas.T.clock = Date.now();
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/__state") {
      res.writeHead(200, cors);
      return res.end(JSON.stringify({ sheets: Object.fromEntries(Object.entries(gas.sheets).map(([k, v]) => [k, v.rows])), pushes: gas.pushes, replies: gas.replies }));
    }
    if (url.pathname === "/__webhook") {
      gas.webhook(JSON.parse(body).events);
      res.writeHead(200, cors);
      return res.end("{}");
    }
    if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
    const out = gas.G.doPost({ postData: { contents: body } });
    res.writeHead(200, cors);
    res.end(out.body);
  });
}).listen(8001);
console.log("ready");
