const express = require("express");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");

const ROOT = __dirname;
const PUBLIC_PORT = Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 8787;
const INTERNAL_PORT = 8788;
const HOST = "0.0.0.0";
const DIST = path.join(ROOT, "web", "dist");
const GATEWAY = path.join(ROOT, "server", "server.js");

const app = express();
app.disable("x-powered-by");
let gateway = null;
let shuttingDown = false;

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function proxyToGateway(req, res) {
  const proxy = http.request({
    hostname: "127.0.0.1",
    port: INTERNAL_PORT,
    path: req.originalUrl || req.url,
    method: req.method,
    headers: {
      ...req.headers,
      host: `127.0.0.1:${INTERNAL_PORT}`,
    },
  }, (upstream) => {
    res.statusCode = upstream.statusCode || 502;
    for (const [key, value] of Object.entries(upstream.headers)) {
      if (value !== undefined) {
        try { res.setHeader(key, value); } catch {}
      }
    }
    upstream.pipe(res);
  });

  proxy.setTimeout(20000, () => proxy.destroy(new Error("Gateway timeout")));
  proxy.on("error", (error) => {
    log("[PROXY ERROR]", error.message);
    if (!res.headersSent) res.status(502).json({ ok: false, error: "Gateway bağlantısı kurulamadı." });
    else res.end();
  });
  req.pipe(proxy);
  req.on("aborted", () => proxy.destroy());
  res.on("close", () => { if (!res.writableEnded) proxy.destroy(); });
}

app.use("/api", proxyToGateway);

if (fs.existsSync(path.join(DIST, "index.html"))) {
  app.use(express.static(DIST, { index: "index.html", maxAge: "1h" }));
  app.get("*", (req, res) => {
    if (req.method === "GET" || req.method === "HEAD") return res.sendFile(path.join(DIST, "index.html"));
    res.status(404).json({ ok: false, error: "Not found" });
  });
} else {
  app.get("/", (_req, res) => res.status(503).json({ ok: false, error: "Web build bulunamadı." }));
}

function startGateway() {
  if (shuttingDown) return;
  gateway = spawn(process.execPath, [GATEWAY], {
    cwd: path.join(ROOT, "server"),
    env: { ...process.env, PORT: String(INTERNAL_PORT), HOST: "127.0.0.1", NODE_ENV: process.env.NODE_ENV || "production" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  gateway.stdout.on("data", (data) => process.stdout.write(`[GATEWAY] ${data}`));
  gateway.stderr.on("data", (data) => process.stderr.write(`[GATEWAY] ${data}`));
  gateway.on("error", (error) => log("[GATEWAY ERROR]", error.message));
  gateway.on("exit", (code, signal) => {
    log(`[GATEWAY EXIT] code=${code == null ? "null" : code} signal=${signal || "null"}`);
    if (!shuttingDown && code !== 0) setTimeout(startGateway, 1500).unref();
  });
}

const server = app.listen(PUBLIC_PORT, HOST, () => {
  log("================================================");
  log("KEYFE KEDER RADYO WEB + GATEWAY");
  log(`PUBLIC PORT: ${PUBLIC_PORT}`);
  log(`GATEWAY: 127.0.0.1:${INTERNAL_PORT}`);
  log(`DIST: ${DIST}`);
  log("================================================");
});

server.on("error", (error) => {
  log("[PUBLIC SERVER ERROR]", error.message);
  process.exitCode = 1;
});

startGateway();

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`${signal} alındı. Kapatılıyor...`);
  try { server.close(); } catch {}
  try { if (gateway && !gateway.killed) gateway.kill("SIGTERM"); } catch {}
  setTimeout(() => {
    try { if (gateway && !gateway.killed) gateway.kill("SIGKILL"); } catch {}
    process.exit(0);
  }, 5000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("uncaughtException", (error) => log("[UNCAUGHT]", error.stack || error));
process.on("unhandledRejection", (reason) => log("[UNHANDLED]", reason));
