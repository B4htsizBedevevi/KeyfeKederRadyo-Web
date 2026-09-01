import express from "express";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "web", "dist");
const BACKEND = path.join(__dirname, "server.js");

const port = Number(process.env.PORT) || 10000;
const backendPort = 8788;
const host = "0.0.0.0";
let shuttingDown = false;
let backend = null;
let server = null;

const log = (...args) => console.log(new Date().toISOString(), ...args);

if (!fs.existsSync(path.join(DIST, "index.html"))) {
  throw new Error(`Frontend build bulunamadı: ${DIST}`);
}
if (!fs.existsSync(BACKEND)) {
  throw new Error(`Backend bulunamadı: ${BACKEND}`);
}

function startBackend() {
  backend = spawn(process.execPath, [BACKEND], {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: String(backendPort),
      HOST: "127.0.0.1",
      NODE_ENV: "production",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  backend.stdout.on("data", d => process.stdout.write(`[BACKEND] ${d}`));
  backend.stderr.on("data", d => process.stderr.write(`[BACKEND] ${d}`));
  backend.on("error", e => log("[BACKEND ERROR]", e.message));
  backend.on("exit", (code, signal) => {
    log(`[BACKEND EXIT] code=${code ?? "null"} signal=${signal ?? "null"}`);
    if (!shuttingDown && code !== 0) setTimeout(startBackend, 1500).unref();
  });
}

const app = express();
app.disable("x-powered-by");

app.use("/api", (req, res) => {
  const headers = { ...req.headers, host: `127.0.0.1:${backendPort}` };
  const proxy = http.request({
    host: "127.0.0.1",
    port: backendPort,
    method: req.method,
    path: req.originalUrl || req.url,
    headers,
  }, upstream => {
    res.status(upstream.statusCode || 502);
    for (const [key, value] of Object.entries(upstream.headers)) {
      if (value !== undefined) res.setHeader(key, value);
    }
    upstream.pipe(res);
  });
  proxy.setTimeout(20000, () => proxy.destroy(new Error("Backend timeout")));
  proxy.on("error", err => {
    log("[PROXY ERROR]", err.message);
    if (!res.headersSent) res.status(502).json({ ok: false, error: "Gateway bağlantısı kurulamadı." });
  });
  req.pipe(proxy);
  req.on("aborted", () => proxy.destroy());
  res.on("close", () => { if (!res.writableEnded) proxy.destroy(); });
});

app.use(express.static(DIST, { index: "index.html", maxAge: "1h" }));
app.get("*", (req, res) => res.sendFile(path.join(DIST, "index.html")));

startBackend();

server = app.listen(port, host, () => {
  log("================================================");
  log("KEYFE KEDER RADYO READY");
  log(`PUBLIC PORT: ${port}`);
  log(`BACKEND: 127.0.0.1:${backendPort}`);
  log("================================================");
});

server.on("error", err => {
  log("[SERVER ERROR]", err.stack || err.message);
  process.exit(1);
});

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`${signal} alındı. Kapatılıyor...`);
  try { server?.close(); } catch {}
  try { backend?.kill("SIGTERM"); } catch {}
  setTimeout(() => {
    try { backend?.kill("SIGKILL"); } catch {}
    process.exit(0);
  }, 5000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("uncaughtException", err => log("[UNCAUGHT]", err.stack || err));
process.on("unhandledRejection", reason => log("[UNHANDLED]", reason));
