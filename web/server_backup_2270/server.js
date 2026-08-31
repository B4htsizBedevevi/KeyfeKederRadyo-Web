"use strict";

/*
 * ============================================================
 * KEYFE KEDER RADYO — STREAM GATEWAY
 * v4.1 HOSTING FIX
 *
 * - Dynamic PORT
 * - 0.0.0.0 binding
 * - Health endpoint
 * - Stream relay
 * - FFmpeg transcode
 * - ICY metadata
 * - iTunes cover
 * - Station updater
 * - Redirect support
 * - Graceful shutdown
 * ============================================================
 */

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const { spawn } = require("child_process");

const app = express();

/* ============================================================
   CONFIG
============================================================ */

const PORT = Number(process.env.PORT) || 8787;

const HOST = "0.0.0.0";

const ROOT = path.resolve(__dirname, "..");

const WEB = path.join(ROOT, "web");

const PUBLIC = path.join(WEB, "public");

const ROOT_STATIONS = path.join(
  ROOT,
  "stations.json"
);

const PUBLIC_STATIONS = path.join(
  PUBLIC,
  "stations.json"
);

const UPDATER = path.join(
  ROOT,
  "station_updater.py"
);

/* ============================================================
   EXPRESS
============================================================ */

app.disable("x-powered-by");

app.use(
  cors({
    origin: "*",
    methods: [
      "GET",
      "POST",
      "OPTIONS",
      "HEAD",
    ],
    allowedHeaders: "*",
  })
);

app.use(
  express.json({
    limit: "1mb",
  })
);

/* ============================================================
   LOG
============================================================ */

function log(...args) {
  console.log(
    new Date().toISOString(),
    ...args
  );
}

/* ============================================================
   ROOT
============================================================ */

app.get("/", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "keyfe-keder-radyo-gateway",
    version: "4.1",
    status: "online",
    port: PORT,
  });
});

/* ============================================================
   URL PARSER
============================================================ */

function parseUrl(raw) {
  try {
    if (
      typeof raw !== "string" ||
      !raw.trim()
    ) {
      return null;
    }

    const url = new URL(raw.trim());

    if (
      url.protocol !== "http:" &&
      url.protocol !== "https:"
    ) {
      return null;
    }

    return url;
  } catch {
    return null;
  }
}

/* ============================================================
   REDIRECT REQUEST
============================================================ */

function requestFollowingRedirects(
  targetUrl,
  headers,
  onResponse,
  onError,
  maxRedirects = 5
) {
  let redirectCount = 0;
  let currentRequest = null;
  let destroyed = false;

  function makeRequest(urlObj) {
    if (destroyed) {
      return;
    }

    const transport =
      urlObj.protocol === "https:"
        ? https
        : http;

    currentRequest = transport.get(
      urlObj.href,
      {
        headers,
        timeout: 10000,
      },
      (upstream) => {
        const status =
          upstream.statusCode || 0;

        const location =
          upstream.headers.location;

        /*
         * Redirect
         */
        if (
          status >= 300 &&
          status < 400 &&
          location
        ) {
          upstream.resume();

          if (
            redirectCount >=
            maxRedirects
          ) {
            onError(
              new Error(
                "Çok fazla yönlendirme."
              )
            );

            return;
          }

          redirectCount++;

          let nextUrl;

          try {
            nextUrl = new URL(
              location,
              urlObj
            );
          } catch {
            onError(
              new Error(
                "Geçersiz redirect adresi."
              )
            );

            return;
          }

          makeRequest(nextUrl);

          return;
        }

        onResponse(
          upstream,
          urlObj
        );
      }
    );

    currentRequest.on(
      "timeout",
      () => {
        currentRequest.destroy(
          new Error(
            "Upstream timeout."
          )
        );
      }
    );

    currentRequest.on(
      "error",
      (error) => {
        if (!destroyed) {
          onError(error);
        }
      }
    );
  }

  makeRequest(targetUrl);

  return {
    destroy() {
      destroyed = true;

      try {
        currentRequest?.destroy();
      } catch {}
    },
  };
}

/* ============================================================
   STATION COUNT
============================================================ */

function countStations(file) {
  try {
    if (!fs.existsSync(file)) {
      return 0;
    }

    const data =
      JSON.parse(
        fs.readFileSync(
          file,
          "utf8"
        )
      );

    return Array.isArray(data)
      ? data.length
      : 0;
  } catch {
    return 0;
  }
}

/* ============================================================
   HEALTH
============================================================ */

function healthPayload() {
  return {
    ok: true,

    service:
      "keyfe-keder-radyo-gateway",

    version: "4.1",

    status: "online",

    port: PORT,

    host: HOST,

    uptime:
      Math.floor(
        process.uptime()
      ),

    node:
      process.version,

    updater:
      fs.existsSync(
        UPDATER
      ),

    rootStations:
      fs.existsSync(
        ROOT_STATIONS
      ),

    publicStations:
      fs.existsSync(
        PUBLIC_STATIONS
      ),

    rootCount:
      countStations(
        ROOT_STATIONS
      ),

    publicCount:
      countStations(
        PUBLIC_STATIONS
      ),
  };
}

app.get(
  "/api/health",
  (_req, res) => {
    res.status(200).json(
      healthPayload()
    );
  }
);

app.head(
  "/api/health",
  (_req, res) => {
    res.status(200).end();
  }
);

/* ============================================================
   CHECK STREAM
============================================================ */

app.get(
  "/api/check",
  (req, res) => {
    const target =
      parseUrl(
        req.query.url
      );

    if (!target) {
      return res
        .status(400)
        .json({
          success: false,
          message:
            "Geçerli URL gerekli.",
        });
    }

    const start =
      Date.now();

    let request = null;
    let finished = false;

    const finish = (
      payload
    ) => {
      if (finished) {
        return;
      }

      finished = true;

      res.json(payload);
    };

    const timeout =
      setTimeout(() => {
        try {
          request?.destroy();
        } catch {}

        finish({
          success: false,
          statusCode: 504,
          latency:
            Date.now() -
            start,
          message:
            "Yayın zaman aşımı.",
        });
      }, 7000);

    request =
      requestFollowingRedirects(
        target,

        {
          "User-Agent":
            "Keyfe-Keder-Radyo/4.1",

          Accept: "*/*",

          "Icy-MetaData": "1",

          Range:
            "bytes=0-1024",
        },

        (upstream) => {
          clearTimeout(
            timeout
          );

          const status =
            upstream.statusCode ||
            0;

          const contentType =
            upstream.headers[
              "content-type"
            ] || "";

          const icyMetaInt =
            upstream.headers[
              "icy-metaint"
            ] || null;

          upstream.resume();

          finish({
            success:
              status >= 200 &&
              status < 300,

            statusCode:
              status,

            latency:
              Date.now() -
              start,

            contentType,

            icyMetaInt,
          });
        },

        (error) => {
          clearTimeout(
            timeout
          );

          finish({
            success: false,

            statusCode: 502,

            latency:
              Date.now() -
              start,

            message:
              error.message,
          });
        }
      );
  }
);

/* ============================================================
   RELAY
============================================================ */

app.get(
  "/api/relay",
  (req, res) => {
    const target =
      parseUrl(
        req.query.url
      );

    if (!target) {
      return res
        .status(400)
        .send("Bad URL");
    }

    let connected = false;

    const request =
      requestFollowingRedirects(
        target,

        {
          "User-Agent":
            "Keyfe-Keder-Radyo/4.1",

          Accept: "*/*",

          "Icy-MetaData": "1",
        },

        (upstream) => {
          connected = true;

          res.statusCode =
            upstream.statusCode ||
            200;

          res.setHeader(
            "Access-Control-Allow-Origin",
            "*"
          );

          res.setHeader(
            "Access-Control-Allow-Headers",
            "*"
          );

          res.setHeader(
            "Cache-Control",
            "no-cache, no-store"
          );

          if (
            upstream.headers[
              "content-type"
            ]
          ) {
            res.setHeader(
              "Content-Type",
              upstream.headers[
                "content-type"
              ]
            );
          }

          if (
            upstream.headers[
              "icy-metaint"
            ]
          ) {
            res.setHeader(
              "icy-metaint",
              upstream.headers[
                "icy-metaint"
              ]
            );
          }

          upstream.pipe(res);

          upstream.on(
            "error",
            (error) => {
              log(
                "Relay upstream:",
                error.message
              );

              try {
                res.end();
              } catch {}
            }
          );
        },

        (error) => {
          log(
            "Relay:",
            error.message
          );

          if (
            !res.headersSent
          ) {
            res
              .status(502)
              .send(
                "Relay failed"
              );
          } else {
            try {
              res.end();
            } catch {}
          }
        }
      );

    req.on(
      "close",
      () => {
        if (!connected) {
          try {
            request.destroy();
          } catch {}
        }
      }
    );
  }
);

/* ============================================================
   TRANSCODE
============================================================ */

app.get(
  "/api/transcode",
  (req, res) => {
    const target =
      parseUrl(
        req.query.url
      );

    if (!target) {
      return res
        .status(400)
        .send("Bad URL");
    }

    const ffmpeg =
      process.env.FFMPEG_PATH ||
      "ffmpeg";

    res.status(200);

    res.setHeader(
      "Content-Type",
      "audio/mpeg"
    );

    res.setHeader(
      "Cache-Control",
      "no-cache, no-store"
    );

    res.setHeader(
      "Access-Control-Allow-Origin",
      "*"
    );

    const args = [
      "-hide_banner",

      "-loglevel",
      "error",

      "-reconnect",
      "1",

      "-reconnect_streamed",
      "1",

      "-reconnect_delay_max",
      "3",

      "-i",
      target.href,

      "-vn",

      "-ac",
      "2",

      "-ar",
      "44100",

      "-c:a",
      "libmp3lame",

      "-b:a",
      "128k",

      "-f",
      "mp3",

      "pipe:1",
    ];

    const child =
      spawn(
        ffmpeg,
        args,
        {
          windowsHide: true,

          stdio: [
            "ignore",
            "pipe",
            "pipe",
          ],
        }
      );

    let stderr = "";

    child.stderr.on(
      "data",
      (chunk) => {
        stderr +=
          chunk.toString();

        if (
          stderr.length >
          5000
        ) {
          stderr =
            stderr.slice(
              -5000
            );
        }
      }
    );

    child.stdout.pipe(res);

    child.on(
      "error",
      (error) => {
        log(
          "FFmpeg:",
          error.message
        );

        if (
          !res.headersSent
        ) {
          res
            .status(500)
            .send(
              "FFmpeg başlatılamadı."
            );
        }
      }
    );

    child.on(
      "close",
      (code) => {
        if (
          code !== 0
        ) {
          log(
            "FFmpeg çıkış:",
            code,
            stderr
          );
        }
      }
    );

    req.on(
      "close",
      () => {
        try {
          child.kill(
            "SIGKILL"
          );
        } catch {}
      }
    );
  }
);

/* ============================================================
   ICY METADATA
============================================================ */

app.get(
  "/api/metadata",
  (req, res) => {
    const target =
      parseUrl(
        req.query.url
      );

    if (!target) {
      return res.json({
        success: false,
        artist: "",
        title: "",
        raw: "",
      });
    }

    const transport =
      target.protocol ===
      "https:"
        ? https
        : http;

    let request = null;
    let finished = false;

    const finish = (
      payload
    ) => {
      if (finished) {
        return;
      }

      finished = true;

      try {
        request?.destroy();
      } catch {}

      res.json(payload);
    };

    const timeout =
      setTimeout(
        () => {
          finish({
            success: false,
            artist: "",
            title: "",
            raw: "",
          });
        },
        8000
      );

    request =
      transport.get(
        target.href,

        {
          headers: {
            "User-Agent":
              "Keyfe-Keder-Radyo/4.1",

            Accept: "*/*",

            "Icy-MetaData": "1",
          },

          timeout: 9000,
        },

        (stream) => {
          const metaInt =
            Number(
              stream.headers[
                "icy-metaint"
              ]
            );

          if (
            !Number.isFinite(
              metaInt
            ) ||
            metaInt <= 0
          ) {
            clearTimeout(
              timeout
            );

            stream.destroy();

            finish({
              success: false,
            });

            return;
          }

          let audioRemaining =
            metaInt;

          let metadataRemaining =
            0;

          let readingMetadata =
            false;

          let buffer =
            Buffer.alloc(0);

          stream.on(
            "data",
            (chunk) => {
              let offset = 0;

              while (
                offset <
                  chunk.length &&
                !finished
              ) {
                /*
                 * AUDIO
                 */
                if (
                  !readingMetadata
                ) {
                  const available =
                    chunk.length -
                    offset;

                  const take =
                    Math.min(
                      available,
                      audioRemaining
                    );

                  offset +=
                    take;

                  audioRemaining -=
                    take;

                  if (
                    audioRemaining >
                    0
                  ) {
                    continue;
                  }

                  if (
                    offset >=
                    chunk.length
                  ) {
                    continue;
                  }

                  const lengthByte =
                    chunk[offset];

                  offset++;

                  metadataRemaining =
                    lengthByte *
                    16;

                  buffer =
                    Buffer.alloc(0);

                  readingMetadata =
                    metadataRemaining >
                    0;

                  if (
                    !readingMetadata
                  ) {
                    audioRemaining =
                      metaInt;
                  }
                }

                /*
                 * METADATA
                 */
                if (
                  readingMetadata
                ) {
                  const available =
                    chunk.length -
                    offset;

                  const take =
                    Math.min(
                      available,
                      metadataRemaining
                    );

                  buffer =
                    Buffer.concat([
                      buffer,
                      chunk.subarray(
                        offset,
                        offset +
                          take
                      ),
                    ]);

                  offset +=
                    take;

                  metadataRemaining -=
                    take;

                  if (
                    metadataRemaining <=
                    0
                  ) {
                    const metadata =
                      buffer
                        .toString(
                          "utf8"
                        )
                        .replace(
                          /[\0\r\n]/g,
                          " "
                        )
                        .trim();

                    const match =
                      metadata.match(
                        /StreamTitle='([^']*)'/i
                      );

                    if (
                      match?.[1]
                    ) {
                      const raw =
                        match[1].trim();

                      const separators =
                        [
                          " - ",
                          " – ",
                          " — ",
                          " | ",
                          " / ",
                        ];

                      let artist =
                        "";

                      let title =
                        raw;

                      for (
                        const separator of
                        separators
                      ) {
                        if (
                          raw.includes(
                            separator
                          )
                        ) {
                          const parts =
                            raw.split(
                              separator
                            );

                          artist =
                            parts
                              .shift()
                              ?.trim() ||
                            "";

                          title =
                            parts
                              .join(
                                separator
                              )
                              .trim();

                          break;
                        }
                      }

                      clearTimeout(
                        timeout
                      );

                      finish({
                        success: true,

                        raw,

                        artist,

                        title,
                      });

                      return;
                    }

                    readingMetadata =
                      false;

                    audioRemaining =
                      metaInt;
                  }
                }
              }
            }
          );

          stream.on(
            "error",
            () => {
              clearTimeout(
                timeout
              );

              finish({
                success: false,
              });
            }
          );
        }
      );

    request.on(
      "timeout",
      () => {
        clearTimeout(
          timeout
        );

        try {
          request.destroy();
        } catch {}

        finish({
          success: false,
        });
      }
    );

    request.on(
      "error",
      () => {
        clearTimeout(
          timeout
        );

        finish({
          success: false,
        });
      }
    );
  }
);

/* ============================================================
   COVER
============================================================ */

app.get(
  "/api/cover",
  async (req, res) => {
    const artist =
      String(
        req.query.artist ||
          ""
      ).trim();

    const title =
      String(
        req.query.title ||
          ""
      ).trim();

    if (!title) {
      return res.json({
        success: false,
        cover: "",
      });
    }

    const query =
      [artist, title]
        .filter(Boolean)
        .join(" ");

    const url =
      `https://itunes.apple.com/search?term=${encodeURIComponent(
        query
      )}&entity=song&limit=5`;

    try {
      const response =
        await fetch(
          url,
          {
            headers: {
              "User-Agent":
                "Keyfe-Keder-Radyo/4.1",
            },
          }
        );

      if (!response.ok) {
        throw new Error(
          `Cover HTTP ${response.status}`
        );
      }

      const data =
        await response.json();

      const result =
        data.results?.find(
          (item) =>
            item.artworkUrl100
        );

      const cover =
        result?.artworkUrl100
          ? result.artworkUrl100.replace(
              "100x100",
              "600x600"
            )
          : "";

      res.json({
        success:
          Boolean(cover),

        cover,
      });
    } catch (error) {
      log(
        "Cover:",
        error.message
      );

      res.json({
        success: false,
        cover: "",
      });
    }
  }
);

/* ============================================================
   STATION SYNC
============================================================ */

function copyStationsToPublic() {
  if (
    !fs.existsSync(
      ROOT_STATIONS
    )
  ) {
    throw new Error(
      "Ana stations.json bulunamadı."
    );
  }

  const content =
    fs.readFileSync(
      ROOT_STATIONS,
      "utf8"
    );

  const parsed =
    JSON.parse(content);

  if (
    !Array.isArray(parsed)
  ) {
    throw new Error(
      "stations.json array olmalı."
    );
  }

  fs.mkdirSync(
    PUBLIC,
    {
      recursive: true,
    }
  );

  const temp =
    `${PUBLIC_STATIONS}.tmp`;

  fs.writeFileSync(
    temp,
    JSON.stringify(
      parsed,
      null,
      2
    ),
    "utf8"
  );

  fs.renameSync(
    temp,
    PUBLIC_STATIONS
  );

  return parsed.length;
}

/* ============================================================
   UPDATER
============================================================ */

function runUpdater() {
  return new Promise(
    (resolve) => {
      if (
        !fs.existsSync(
          UPDATER
        )
      ) {
        resolve({
          success: false,

          message:
            `Updater bulunamadı: ${UPDATER}`,
        });

        return;
      }

      log(
        "Radyo updater başlıyor..."
      );

      const pythonCommand =
        process.platform ===
        "win32"
          ? "py"
          : "python3";

      const child =
        spawn(
          pythonCommand,
          [
            UPDATER,
          ],
          {
            cwd: ROOT,

            windowsHide:
              true,

            stdio: [
              "ignore",
              "pipe",
              "pipe",
            ],
          }
        );

      let stdout = "";
      let stderr = "";

      child.stdout.on(
        "data",
        (chunk) => {
          const value =
            chunk.toString();

          stdout += value;

          process.stdout.write(
            `[UPDATER] ${value}`
          );
        }
      );

      child.stderr.on(
        "data",
        (chunk) => {
          const value =
            chunk.toString();

          stderr += value;

          process.stderr.write(
            `[UPDATER] ${value}`
          );
        }
      );

      child.on(
        "error",
        (error) => {
          resolve({
            success: false,

            message:
              error.message,

            stdout,
            stderr,
          });
        }
      );

      child.on(
        "close",
        (code) => {
          if (
            code !== 0
          ) {
            resolve({
              success: false,

              message:
                stderr ||
                `Updater ${code} ile kapandı.`,

              stdout,
              stderr,
            });

            return;
          }

          try {
            const total =
              copyStationsToPublic();

            resolve({
              success: true,

              total,

              stdout,
              stderr,

              message:
                "Radyo listesi güncellendi ve web listesi senkronlandı.",
            });
          } catch (error) {
            resolve({
              success: false,

              message:
                error.message,

              stdout,
              stderr,
            });
          }
        }
      );
    }
  );
}

/* ============================================================
   UPDATE API
============================================================ */

app.post(
  "/api/update-stations",
  async (_req, res) => {
    try {
      const result =
        await runUpdater();

      if (
        !result.success
      ) {
        return res
          .status(500)
          .json(result);
      }

      const rootCount =
        countStations(
          ROOT_STATIONS
        );

      const publicCount =
        countStations(
          PUBLIC_STATIONS
        );

      res.json({
        success: true,

        updated: true,

        total:
          result.total,

        rootCount,

        publicCount,

        synced:
          rootCount ===
          publicCount,

        message:
          result.message,
      });
    } catch (error) {
      res
        .status(500)
        .json({
          success: false,

          message:
            error.message,
        });
    }
  }
);

/* ============================================================
   404
============================================================ */

app.use(
  (req, res) => {
    res.status(404).json({
      ok: false,

      error:
        "Endpoint bulunamadı.",

      path:
        req.originalUrl,
    });
  }
);

/* ============================================================
   ERROR HANDLER
============================================================ */

app.use(
  (
    error,
    _req,
    res,
    _next
  ) => {
    log(
      "Express error:",
      error
    );

    if (
      res.headersSent
    ) {
      return;
    }

    res
      .status(500)
      .json({
        ok: false,

        error:
          "Internal server error.",
      });
  }
);

/* ============================================================
   SERVER
============================================================ */

const server =
  app.listen(
    PORT,
    HOST,
    () => {
      console.log("");
      console.log(
        "================================================"
      );
      console.log(
        "      KEYFE KEDER RADYO GATEWAY v4.1"
      );
      console.log(
        "================================================"
      );
      console.log(
        `Host:        ${HOST}`
      );
      console.log(
        `Port:        ${PORT}`
      );
      console.log(
        `Local:       http://127.0.0.1:${PORT}`
      );
      console.log(
        `Health:      http://127.0.0.1:${PORT}/api/health`
      );
      console.log(
        `Environment: ${process.env.NODE_ENV || "development"}`
      );
      console.log(
        `Node:        ${process.version}`
      );
      console.log(
        `Updater:     ${UPDATER}`
      );
      console.log(
        `Stations:    ${ROOT_STATIONS}`
      );
      console.log(
        `Web list:    ${PUBLIC_STATIONS}`
      );
      console.log(
        "Relay:       enabled"
      );
      console.log(
        "Transcode:   FFmpeg fallback"
      );
      console.log(
        "Metadata:    ICY"
      );
      console.log(
        "Cover:       iTunes"
      );
      console.log(
        "================================================"
      );
      console.log(
        "SERVER READY"
      );
      console.log(
        "================================================"
      );
    }
  );

/* ============================================================
   SERVER ERRORS
============================================================ */

server.on(
  "error",
  (error) => {
    if (
      error.code ===
      "EADDRINUSE"
    ) {
      console.error(
        `PORT ${PORT} zaten kullanımda.`
      );
    } else {
      console.error(
        "Server error:",
        error
      );
    }

    process.exit(1);
  }
);

/* ============================================================
   GRACEFUL SHUTDOWN
============================================================ */

function shutdown(
  signal
) {
  console.log(
    `[SERVER] ${signal} alındı. Kapatılıyor...`
  );

  server.close(
    () => {
      console.log(
        "[SERVER] HTTP server kapatıldı."
      );

      process.exit(0);
    }
  );

  setTimeout(
    () => {
      console.log(
        "[SERVER] Zorunlu çıkış."
      );

      process.exit(1);
    },
    10000
  ).unref();
}

process.on(
  "SIGTERM",
  () => shutdown("SIGTERM")
);

process.on(
  "SIGINT",
  () => shutdown("SIGINT")
);

/* ============================================================
   UNHANDLED ERRORS
============================================================ */

process.on(
  "uncaughtException",
  (error) => {
    console.error(
      "[FATAL] uncaughtException:",
      error
    );
  }
);

process.on(
  "unhandledRejection",
  (reason) => {
    console.error(
      "[WARN] unhandledRejection:",
      reason
    );
  }
);