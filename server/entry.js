import express from "express";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const WEB = path.join(ROOT, "web");
const DIST = path.join(WEB, "dist");
const BACKEND = path.join(__dirname, "server.js");

const rawPort = Number(process.env.PORT);
const PORT = Number.isInteger(rawPort) && rawPort > 0 && rawPort <= 65535 ? rawPort : 8787;
const BACKEND_PORT = PORT === 65535 ? 8787 : PORT + 1;
const HOST = "0.0.0.0";
const BACKEND_HOST = "127.0.0.1";

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function fail(message) {
  console.error(`[ENTRY] ${message}`);
}

if (!fs.existsSync(BACKEND)) {
  throw new Error(`Backend bulunamadı: ${BACKEND}`);
}

if (!fs.existsSync(path.join(DIST, "index.html"))) {
  throw new Error(`Frontend build bulunamadı: ${path.join(DIST, "index.html")}`);
}

const backendEnv = {
  ...process.env,
  PORT: String(BACKEND_PORT),
  NODE_ENV: process.env.NODE_ENV || "production",
};

const backend = spawn(process.execPath, [BACKEND], {
  cwd: ROOT,
  env: backendEnv,
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});

backend.stdout.on("data", (chunk) => process.stdout.write(`[BACKEND] ${chunk}`));
backend.stderr.on("data", (chunk) => process.stderr.write(`[BACKEND] ${chunk}`));
backend.on("error", (error) => fail(`Backend başlatılamadı: ${error.message}`));
backend.on("exit", (code, signal) => {
  if (!shuttingDown) {
    fail(`Backend kapandı. code=${code ?? "null"} signal=${signal ?? "null"}`);
  }
});

const app = express();
app.disable("x-powered-by");

app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

app.use(express.static(DIST, {
  index: false,
  fallthrough: true,
  maxAge: "1h",
}));

function proxyToBackend(req, res) {
  const headers = { ...req.headers };
  delete headers.host;
  headers["x-forwarded-host"] = req.headers.host || "";
  headers["x-forwarded-proto"] = req.headers["x-forwarded-proto"] || "http";
  headers.host = `${BACKEND_HOST}:${BACKEND_PORT}`;

  const proxyReq = http.request({
    host: BACKEND_HOST,
    port: BACKEND_PORT,
    method: req.method,
    path: req.originalUrl || req.url,
    headers,
    agent: false,
  }, (proxyRes) => {
    res.status(proxyRes.statusCode || 502);

    for (const [name, value] of Object.entries(proxyRes.headers)) {
      if (value !== undefined) {
        try {
          res.setHeader(name, value);
        } catch {}
      }
    }

    proxyRes.pipe(res);

    proxyRes.on("error", (error) => {
      fail(`Proxy response: ${error.message}`);
      if (!res.headersSent) {
        res.status(502).end("Gateway bağlantı hatası.");
      } else {
        res.destroy();
      }
    });
  });

  proxyReq.setTimeout(20000, () => {
    proxyReq.destroy(new Error("Backend timeout."));
  });

  proxyReq.on("error", (error) => {
    if (res.headersSent) {
      try { res.destroy(); } catch {}
      return;
    }

    fail(`Proxy request: ${error.message}`);
    res.status(502).json({
      ok: false,
      success: false,
      error: "Gateway geçici olarak kullanılamıyor.",
    });
  });

  req.on("aborted", () => {
    proxyReq.destroy();
  });

  res.on("close", () => {
    if (!res.writableEnded) {
      proxyReq.destroy();
    }
  });

  req.pipe(proxyReq);
}

app.use("/api", proxyToBackend);

app.use((req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return next();
  }

  const indexFile = path.join(DIST, "index.html");
  if (!fs.existsSync(indexFile)) return next();
  return res.sendFile(indexFile);
});

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    success: false,
    error: "Sayfa bulunamadı.",
    path: req.path,
  });
});

let shuttingDown = false;
let server = null;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`${signal} alındı. Web entrypoint kapatılıyor...`);

  if (server) {
    server.close(() => log("Web server kapandı."));
  }

  try {
    if (!backend.killed) backend.kill("SIGTERM");
  } catch {}

  setTimeout(() => {
    try {
      if (!backend.killed) backend.kill("SIGKILL");
    } catch {}
    process.exit(0);
  }, 8000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

server = app.listen(PORT, HOST, () => {
  log(`WEB READY ${HOST}:${PORT}`);
  log(`FRONTEND ${DIST}`);
  log(`BACKEND  ${BACKEND_HOST}:${BACKEND_PORT}`);
});

server.on("error", (error) => {
  fail(`Web server: ${error.message}`);
  if (error.code === "EADDRINUSE") process.exit(1);
});
