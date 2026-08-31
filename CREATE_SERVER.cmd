@echo off
setlocal EnableExtensions
title Keyfe Keder Radyo - Server Kurulum

cd /d "%~dp0"

echo.
echo ============================================================
echo        KEYFE KEDER RADYO - SERVER V5 KURULUM
echo ============================================================
echo.

set "SERVER_DIR=%~dp0web\server"
set "BACKUP_DIR=%~dp0web\server_backup_%RANDOM%"

if not exist "%SERVER_DIR%" (
    echo [HATA] web\server klasoru bulunamadi.
    pause
    exit /b 1
)

echo [1/6] Mevcut server yedekleniyor...
mkdir "%BACKUP_DIR%" >nul 2>&1

for %%F in (
    server.js
    db.js
    auth.js
    package.json
    package-lock.json
) do (
    if exist "%SERVER_DIR%\%%F" (
        copy /y "%SERVER_DIR%\%%F" "%BACKUP_DIR%\%%F" >nul
    )
)

echo [OK] Yedek: %BACKUP_DIR%
echo.

echo [2/6] server.js olusturuluyor...

> "%SERVER_DIR%\server.js" (
echo const express = require("express");
echo const cors = require("cors");
echo const fs = require("fs");
echo const path = require("path");
echo const http = require("http");
echo const https = require("https");
echo const { spawn } = require("child_process");
echo.
echo const app = express();
echo.
echo // ============================================================
echo // HOST / PORT
echo // ============================================================
echo.
echo const HOST = "0.0.0.0";
echo const PORT = Number(process.env.PORT^) ^|^| 22021;
echo.
echo if (!Number.isInteger(PORT^) ^|^| PORT ^< 1 ^|^| PORT ^> 65535^) {
echo   throw new Error("Gecersiz PORT: " + process.env.PORT);
echo }
echo.
echo // ============================================================
echo // PATHS
echo // ============================================================
echo.
echo const SERVER_DIR = __dirname;
echo const ROOT = path.resolve(SERVER_DIR, "..", "..");
echo const WEB = path.join(ROOT, "web");
echo const PUBLIC = path.join(WEB, "public");
echo.
echo const ROOT_STATIONS = path.join(ROOT, "stations.json");
echo const PUBLIC_STATIONS = path.join(PUBLIC, "stations.json");
echo const UPDATER = path.join(ROOT, "station_updater.py");
echo.
echo // ============================================================
echo // MIDDLEWARE
echo // ============================================================
echo.
echo app.disable("x-powered-by");
echo.
echo app.use(cors({
echo   origin: true,
echo   credentials: false,
echo   methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
echo   allowedHeaders: ["Content-Type", "Authorization", "Range", "Accept"]
echo }));
echo.
echo app.use(express.json({ limit: "1mb" }));
echo.
echo // ============================================================
echo // HELPERS
echo // ============================================================
echo.
echo function log(...args^) {
echo   console.log(new Date().toISOString(), ...args);
echo }
echo.
echo function parseUrl(raw^) {
echo   if (typeof raw !== "string" ^|^| !raw.trim()) return null;
echo.
echo   try {
echo     const url = new URL(raw.trim());
echo.
echo     if (url.protocol !== "http:" ^&^& url.protocol !== "https:") {
echo       return null;
echo     }
echo.
echo     return url;
echo   } catch {
echo     return null;
echo   }
echo }
echo.
echo function countStations(file^) {
echo   try {
echo     if (!fs.existsSync(file^)) return 0;
echo.
echo     const data = JSON.parse(fs.readFileSync(file, "utf8"^));
echo     return Array.isArray(data^) ? data.length : 0;
echo   } catch {
echo     return 0;
echo   }
echo }
echo.
echo function requestFollowingRedirects(
echo   targetUrl,
echo   headers,
echo   onResponse,
echo   onError,
echo   maxRedirects = 5
echo ^) {
echo   let redirects = 0;
echo   let currentRequest = null;
echo   let destroyed = false;
echo.
echo   function request(urlObj^) {
echo     if (destroyed^) return;
echo.
echo     const transport =
echo       urlObj.protocol === "https:" ? https : http;
echo.
echo     currentRequest = transport.get(
echo       urlObj.href,
echo       { headers },
echo       upstream =^> {
echo         const status = upstream.statusCode ^|^| 0;
echo         const location = upstream.headers.location;
echo.
echo         if (
echo           status ^>= 300 ^&^&
echo           status ^< 400 ^&^&
echo           location
echo         ) {
echo           upstream.resume();
echo.
echo           if (redirects ^>= maxRedirects^) {
echo             onError(new Error("Cok fazla redirect."));
echo             return;
echo           }
echo.
echo           redirects++;
echo.
echo           try {
echo             const nextUrl = new URL(location, urlObj);
echo             request(nextUrl);
echo           } catch {
echo             onError(new Error("Gecersiz redirect URL."));
echo           }
echo.
echo           return;
echo         }
echo.
echo         onResponse(upstream, urlObj);
echo       }
echo     );
echo.
echo     currentRequest.on("error", onError);
echo   }
echo.
echo   request(targetUrl);
echo.
echo   return {
echo     destroy() {
echo       destroyed = true;
echo       try {
echo         currentRequest?.destroy();
echo       } catch {}
echo     }
echo   };
echo }
echo.
echo // ============================================================
echo // HEALTH
echo // ============================================================
echo.
echo app.get("/api/health", (_req, res^) =^> {
echo   res.json({
echo     ok: true,
echo     service: "keyfe-keder-radyo-gateway",
echo     version: "5.0.0",
echo     host: HOST,
echo     port: PORT,
echo     node: process.version,
echo     platform: process.platform,
echo     uptime: Math.floor(process.uptime()),
echo     rootStations: fs.existsSync(ROOT_STATIONS^),
echo     publicStations: fs.existsSync(PUBLIC_STATIONS^),
echo     updater: fs.existsSync(UPDATER^),
echo     rootCount: countStations(ROOT_STATIONS^),
echo     publicCount: countStations(PUBLIC_STATIONS^),
echo     timestamp: new Date().toISOString()
echo   });
echo });
echo.
echo // ============================================================
echo // ROOT
echo // ============================================================
echo.
echo app.get("/", (_req, res^) =^> {
echo   res.json({
echo     ok: true,
echo     service: "Keyfe Keder Radyo Gateway",
echo     version: "5.0.0",
echo     health: "/api/health"
echo   });
echo });
echo.
echo // ============================================================
echo // CHECK
echo // ============================================================
echo.
echo app.get("/api/check", (req, res^) =^> {
echo   const target = parseUrl(req.query.url^);
echo.
echo   if (!target^) {
echo     return res.status(400^).json({
echo       success: false,
echo       message: "Gecerli URL gerekli."
echo     });
echo   }
echo.
echo   const started = Date.now();
echo   let request = null;
echo   let finished = false;
echo.
echo   const finish = payload =^> {
echo     if (finished^) return;
echo     finished = true;
echo     res.json(payload^);
echo   };
echo.
echo   const timeout = setTimeout(() =^> {
echo     try { request?.destroy(); } catch {}
echo.
echo     finish({
echo       success: false,
echo       statusCode: 504,
echo       latency: Date.now() - started,
echo       message: "Yayin zaman asimi."
echo     });
echo   }, 7000^);
echo.
echo   request = requestFollowingRedirects(
echo     target,
echo     {
echo       "User-Agent": "Keyfe-Keder-Radyo/5.0",
echo       "Accept": "*/*",
echo       "Icy-MetaData": "1",
echo       "Range": "bytes=0-1024"
echo     },
echo     upstream =^> {
echo       clearTimeout(timeout^);
echo       upstream.resume();
echo.
echo       finish({
echo         success:
echo           upstream.statusCode ^>= 200 ^&^&
echo           upstream.statusCode ^< 300,
echo         statusCode: upstream.statusCode,
echo         latency: Date.now() - started,
echo         contentType:
echo           upstream.headers["content-type"] ^|^| "",
echo         icyMetaInt:
echo           upstream.headers["icy-metaint"] ^|^| null
echo       });
echo     },
echo     error =^> {
echo       clearTimeout(timeout^);
echo.
echo       finish({
echo         success: false,
echo         statusCode: 502,
echo         latency: Date.now() - started,
echo         message: error.message
echo       });
echo     }
echo   );
echo });
echo.
echo // ============================================================
echo // RELAY
echo // ============================================================
echo.
echo app.get("/api/relay", (req, res^) =^> {
echo   const target = parseUrl(req.query.url^);
echo.
echo   if (!target^) {
echo     return res.status(400^).send("Bad URL");
echo   }
echo.
echo   const request = requestFollowingRedirects(
echo     target,
echo     {
echo       "User-Agent": "Keyfe-Keder-Radyo/5.0",
echo       "Accept": "*/*",
echo       "Icy-MetaData": "1"
echo     },
echo     upstream =^> {
echo       res.statusCode = upstream.statusCode ^|^| 200;
echo.
echo       res.setHeader(
echo         "Access-Control-Allow-Origin",
echo         "*"
echo       );
echo.
echo       res.setHeader(
echo         "Access-Control-Allow-Headers",
echo         "*"
echo       );
echo.
echo       if (upstream.headers["content-type"]) {
echo         res.setHeader(
echo           "Content-Type",
echo           upstream.headers["content-type"]
echo         );
echo       }
echo.
echo       if (upstream.headers["icy-metaint"]) {
echo         res.setHeader(
echo           "icy-metaint",
echo           upstream.headers["icy-metaint"]
echo         );
echo       }
echo.
echo       upstream.pipe(res^);
echo.
echo       upstream.on("error", () =^> {
echo         try { res.end(); } catch {}
echo       });
echo     },
echo     error =^> {
echo       log("Relay:", error.message^);
echo.
echo       if (!res.headersSent^) {
echo         res.status(502^).send("Relay failed");
echo       } else {
echo         try { res.end(); } catch {}
echo       }
echo     }
echo   );
echo.
echo   req.on("close", () =^> {
echo     try { request.destroy(); } catch {}
echo   });
echo });
echo.
echo // ============================================================
echo // TRANSCODE
echo // ============================================================
echo.
echo app.get("/api/transcode", (req, res^) =^> {
echo   const target = parseUrl(req.query.url^);
echo.
echo   if (!target^) {
echo     return res.status(400^).send("Bad URL");
echo   }
echo.
echo   const ffmpeg = process.env.FFMPEG_PATH ^|^| "ffmpeg";
echo.
echo   res.setHeader("Content-Type", "audio/mpeg");
echo   res.setHeader("Cache-Control", "no-cache, no-store");
echo   res.setHeader("Access-Control-Allow-Origin", "*");
echo.
echo   const args = [
echo     "-hide_banner",
echo     "-loglevel", "error",
echo     "-reconnect", "1",
echo     "-reconnect_streamed", "1",
echo     "-reconnect_delay_max", "3",
echo     "-i", target.href,
echo     "-vn",
echo     "-ac", "2",
echo     "-ar", "44100",
echo     "-c:a", "libmp3lame",
echo     "-b:a", "128k",
echo     "-f", "mp3",
echo     "pipe:1"
echo   ];
echo.
echo   const child = spawn(ffmpeg, args, {
echo     windowsHide: true,
echo     stdio: ["ignore", "pipe", "pipe"]
echo   });
echo.
echo   let stderr = "";
echo.
echo   child.stderr.on("data", chunk =^> {
echo     stderr += chunk.toString();
echo     if (stderr.length ^> 5000^) {
echo       stderr = stderr.slice(-5000^);
echo     }
echo   });
echo.
echo   child.stdout.pipe(res^);
echo.
echo   child.on("error", error =^> {
echo     log("FFmpeg:", error.message^);
echo.
echo     if (!res.headersSent^) {
echo       res.status(500^).send("FFmpeg baslatilamadi.");
echo     }
echo   });
echo.
echo   child.on("close", code =^> {
echo     if (code !== 0^) {
echo       log("FFmpeg cikis:", code, stderr^);
echo     }
echo   });
echo.
echo   req.on("close", () =^> {
echo     try { child.kill("SIGKILL"); } catch {}
echo   });
echo });
echo.
echo // ============================================================
echo // METADATA
echo // ============================================================
echo.
echo app.get("/api/metadata", (req, res^) =^> {
echo   const target = parseUrl(req.query.url^);
echo.
echo   if (!target^) {
echo     return res.json({ success: false });
echo   }
echo.
echo   const transport =
echo     target.protocol === "https:" ? https : http;
echo.
echo   let request;
echo   let finished = false;
echo.
echo   const finish = payload =^> {
echo     if (finished^) return;
echo     finished = true;
echo.
echo     try { request?.destroy(); } catch {}
echo     res.json(payload^);
echo   };
echo.
echo   const timeout = setTimeout(() =^> {
echo     finish({
echo       success: false,
echo       artist: "",
echo       title: "",
echo       raw: ""
echo     });
echo   }, 8000^);
echo.
echo   request = transport.get(
echo     target.href,
echo     {
echo       headers: {
echo         "User-Agent": "Keyfe-Keder-Radyo/5.0",
echo         "Accept": "*/*",
echo         "Icy-MetaData": "1"
echo       }
echo     },
echo     stream =^> {
echo       const metaInt = Number(
echo         stream.headers["icy-metaint"]
echo       );
echo.
echo       if (!Number.isFinite(metaInt^) ^|^| metaInt ^<= 0^) {
echo         clearTimeout(timeout^);
echo         stream.destroy();
echo         finish({ success: false });
echo         return;
echo       }
echo.
echo       let audioRemaining = metaInt;
echo       let metadataRemaining = 0;
echo       let readingMetadata = false;
echo       let buffer = Buffer.alloc(0^);
echo.
echo       stream.on("data", chunk =^> {
echo         let offset = 0;
echo.
echo         while (offset ^< chunk.length ^&^& !finished^) {
echo           if (!readingMetadata^) {
echo             const available = chunk.length - offset;
echo             const take = Math.min(
echo               available,
echo               audioRemaining
echo             );
echo.
echo             offset += take;
echo             audioRemaining -= take;
echo.
echo             if (audioRemaining ^> 0^) continue;
echo             if (offset ^>= chunk.length^) continue;
echo.
echo             const lengthByte = chunk[offset];
echo             offset++;
echo.
echo             metadataRemaining = lengthByte * 16;
echo             buffer = Buffer.alloc(0^);
echo             readingMetadata = metadataRemaining ^> 0;
echo.
echo             if (!readingMetadata^) {
echo               audioRemaining = metaInt;
echo             }
echo           }
echo.
echo           if (readingMetadata^) {
echo             const available = chunk.length - offset;
echo             const take = Math.min(
echo               available,
echo               metadataRemaining
echo             );
echo.
echo             buffer = Buffer.concat([
echo               buffer,
echo               chunk.subarray(offset, offset + take)
echo             ]);
echo.
echo             offset += take;
echo             metadataRemaining -= take;
echo.
echo             if (metadataRemaining ^<= 0^) {
echo               const metadata = buffer
echo                 .toString("utf8")
echo                 .replace(/[\0\r\n]/g, " ")
echo                 .trim();
echo.
echo               const match =
echo                 metadata.match(
echo                   /StreamTitle='([^']*)'/i
echo                 );
echo.
echo               if (match ^&^& match[1]) {
echo                 const raw = match[1].trim();
echo.
echo                 const separators = [
echo                   " - ",
echo                   " – ",
echo                   " — ",
echo                   " | ",
echo                   " / "
echo                 ];
echo.
echo                 let artist = "";
echo                 let title = raw;
echo.
echo                 for (const separator of separators^) {
echo                   if (raw.includes(separator^)) {
echo                     const parts = raw.split(separator^);
echo                     artist = parts.shift()?.trim() ^|^| "";
echo                     title = parts.join(separator^).trim();
echo                     break;
echo                   }
echo                 }
echo.
echo                 clearTimeout(timeout^);
echo.
echo                 finish({
echo                   success: true,
echo                   raw,
echo                   artist,
echo                   title
echo                 });
echo.
echo                 return;
echo               }
echo.
echo               readingMetadata = false;
echo               audioRemaining = metaInt;
echo             }
echo           }
echo         }
echo       });
echo.
echo       stream.on("error", () =^> {
echo         clearTimeout(timeout^);
echo         finish({ success: false });
echo       });
echo     }
echo   );
echo.
echo   request.on("error", () =^> {
echo     clearTimeout(timeout^);
echo     finish({ success: false });
echo   });
echo });
echo.
echo // ============================================================
echo // COVER
echo // ============================================================
echo.
echo app.get("/api/cover", async (req, res^) =^> {
echo   const artist = String(req.query.artist ^|^| "").trim();
echo   const title = String(req.query.title ^|^| "").trim();
echo.
echo   if (!title^) {
echo     return res.json({
echo       success: false,
echo       cover: ""
echo     });
echo   }
echo.
echo   const query = [artist, title]
echo     .filter(Boolean)
echo     .join(" ");
echo.
echo   const url =
echo     "https://itunes.apple.com/search?term=" +
echo     encodeURIComponent(query) +
echo     "^&entity=song^&limit=5";
echo.
echo   try {
echo     const response = await fetch(url, {
echo       headers: {
echo         "User-Agent": "Keyfe-Keder-Radyo/5.0"
echo       }
echo     });
echo.
echo     if (!response.ok^) {
echo       throw new Error(
echo         "Cover HTTP " + response.status
echo       );
echo     }
echo.
echo     const data = await response.json();
echo.
echo     const result = data.results?.find(
echo       item =^> item.artworkUrl100
echo     );
echo.
echo     const cover = result?.artworkUrl100
echo       ? result.artworkUrl100.replace(
echo           "100x100",
echo           "600x600"
echo         )
echo       : "";
echo.
echo     res.json({
echo       success: Boolean(cover^),
echo       cover
echo     });
echo   } catch (error^) {
echo     log("Cover:", error.message^);
echo.
echo     res.json({
echo       success: false,
echo       cover: ""
echo     });
echo   }
echo });
echo.
echo // ============================================================
echo // STATIONS
echo // ============================================================
echo.
echo function copyStationsToPublic() {
echo   if (!fs.existsSync(ROOT_STATIONS^)) {
echo     throw new Error(
echo       "stations.json bulunamadi: " + ROOT_STATIONS
echo     );
echo   }
echo.
echo   const content =
echo     fs.readFileSync(ROOT_STATIONS, "utf8");
echo.
echo   const parsed = JSON.parse(content^);
echo.
echo   if (!Array.isArray(parsed^)) {
echo     throw new Error(
echo       "stations.json array olmali."
echo     );
echo   }
echo.
echo   fs.mkdirSync(PUBLIC, { recursive: true });
echo.
echo   const temp = PUBLIC_STATIONS + ".tmp";
echo.
echo   fs.writeFileSync(
echo     temp,
echo     JSON.stringify(parsed, null, 2^),
echo     "utf8"
echo   );
echo.
echo   fs.renameSync(temp, PUBLIC_STATIONS);
echo.
echo   return parsed.length;
echo }
echo.
echo app.get("/api/stations", (_req, res^) =^> {
echo   try {
echo     if (!fs.existsSync(PUBLIC_STATIONS^)) {
echo       if (fs.existsSync(ROOT_STATIONS^)) {
echo         copyStationsToPublic();
echo       }
echo     }
echo.
echo     if (!fs.existsSync(PUBLIC_STATIONS^)) {
echo       return res.status(404^).json({
echo         success: false,
echo         stations: []
echo       });
echo     }
echo.
echo     const stations =
echo       JSON.parse(
echo         fs.readFileSync(
echo           PUBLIC_STATIONS,
echo           "utf8"
echo         )
echo       );
echo.
echo     res.json({
echo       success: true,
echo       total: Array.isArray(stations^) ? stations.length : 0,
echo       stations: Array.isArray(stations^) ? stations : []
echo     });
echo   } catch (error^) {
echo     res.status(500^).json({
echo       success: false,
echo       message: error.message
echo     });
echo   }
echo });
echo.
echo // ============================================================
echo // STATIC WEB
echo // ============================================================
echo.
echo if (fs.existsSync(PUBLIC^)) {
echo   app.use(express.static(PUBLIC^));
echo }
echo.
echo // ============================================================
echo // ERROR HANDLER
echo // ============================================================
echo.
echo app.use((err, _req, res, _next^) =^> {
echo   log("Express:", err.message^);
echo.
echo   if (res.headersSent^) return;
echo.
echo   res.status(500^).json({
echo     success: false,
echo     error: "Sunucu hatasi."
echo   });
echo });
echo.
echo // ============================================================
echo // SERVER
echo // ============================================================
echo.
echo const server = app.listen(
echo   PORT,
echo   HOST,
echo   () =^> {
echo     console.log("");
echo     console.log("================================================");
echo     console.log("       KEYFE KEDER RADYO GATEWAY v5");
echo     console.log("================================================");
echo     console.log("Host:       " + HOST);
echo     console.log("Port:       " + PORT);
echo     console.log("Local:      http://127.0.0.1:" + PORT);
echo     console.log("Network:    http://0.0.0.0:" + PORT);
echo     console.log("Health:     http://0.0.0.0:" + PORT + "/api/health");
echo     console.log("Stations:   " + ROOT_STATIONS);
echo     console.log("Web list:   " + PUBLIC_STATIONS);
echo     console.log("Relay:      enabled");
echo     console.log("Transcode:  FFmpeg fallback");
echo     console.log("Metadata:   ICY");
echo     console.log("Cover:      iTunes");
echo     console.log("================================================");
echo     console.log("");
echo   }
echo );
echo.
echo server.on("error", error =^> {
echo   console.error("[SERVER ERROR]", error.message^);
echo.
echo   if (error.code === "EADDRINUSE") {
echo     console.error(
echo       "PORT " + PORT + " zaten kullanimda."
echo     );
echo   }
echo.
echo   process.exitCode = 1;
echo });
echo.
echo process.on("SIGTERM", () =^> {
echo   log("SIGTERM alindi, sunucu kapatiliyor...");
echo.
echo   server.close(() =^> {
echo     process.exit(0^);
echo   });
echo.
echo   setTimeout(() =^> {
echo     process.exit(1^);
echo   }, 5000^).unref();
echo });
echo.
echo process.on("SIGINT", () =^> {
echo   log("SIGINT alindi, sunucu kapatiliyor...");
echo.
echo   server.close(() =^> {
echo     process.exit(0^);
echo   });
echo });