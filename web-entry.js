import express from "express";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_PORT = Number(process.env.PORT) || 8787;
const INTERNAL_PORT = Number(process.env.INTERNAL_PORT) || 8788;
const HOST = "0.0.0.0";
const DIST = path.join(__dirname, "web", "dist");

const app = express();
app.disable("x-powered-by");

let gateway = null;
let shuttingDown = false;

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function proxyToGateway(req, res) {
  const options = {
    hostname: "127.0.0.1",
    port: INTERNAL_PORT,
    path: req.originalUrl,
    method: req.method,
    headers: {
      ...req.headers,
      host: `127.0.0.1:${INTERNAL_PORT}`,
      connection: "keep-alive",
    },
  };

  const proxy = http.request(options, (upstream) => {
    res.statusCode = upstream.statusCode || 502;
    for (const [key, value] of Object.entries(upstream.headers)) {
      if (value !== undefined) res.setHeader(key, value);
    }
    upstream.pipe(res);
  });

  proxy.setTimeout(20000, () => proxy.destroy(new Error("Gateway timeout")));

  proxy.on("error", (error) => {
    log("[PROXY]", error.message);
    if (!res.headersSent) {
      res.status(502).json({ ok: false, error: "Gateway bağlantısı kurulamadı." });
    } else {
      res.end();
    }
  });

  req.pipe(proxy);
  req.on("aborted", () => proxy.destroy());
  res.on("close", () => {
    if (!res.writableEnded) proxy.destroy();
  });
}

// API ve radyo stream istekleri gateway'e gider.
app.use("/api", proxyToGateway);

// React/Vite production build aynı public porttan sunulur.
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST, { index: "index.html", maxAge: "1h" }));

  // Express 5 uyumlu SPA fallback.
  app.use((req, res) => {
    if (req.method === "GET" && !req.path.startsWith("/api")) {
      return res.sendFile(path.join(DIST, "index.html"));
    }
    return res.status(404).end();
  });
} else {
  app.get("/", (_req, res) => {
    res.status(503).send("Web build bulunamadı. Lütfen yeniden deploy edin.");
  });
}

function startGateway() {
  gateway = spawn(process.execPath, [path.join(__dirname, "server", "server.js")], {
    env: {
      ...process.env,
      PORT: String(INTERNAL_PORT),
      HOST: "127.0.0.1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  gateway.stdout.on("data", (data) => process.stdout.write(`[GATEWAY] ${data}`));
  gateway.stderr.on("data", (data) => process.stderr.write(`[GATEWAY] ${data}`));
  gateway.on("error", (error) => log("[GATEWAY ERROR]", error.message));
  gateway.on("exit", (code, signal) => {
    log(`[GATEWAY EXIT] code=${code ?? "null"} signal=${signal ?? "null"}`);
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

startGateway();

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`${signal} alındı. Sunucular kapatılıyor...`);

  server.close(() => {
    if (gateway && !gateway.killed) gateway.kill("SIGTERM");
    process.exit(0);
  });

  setTimeout(() => {
    try { if (gateway && !gateway.killed) gateway.kill("SIGKILL"); } catch {}
    process.exit(1);
  }, 10000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
