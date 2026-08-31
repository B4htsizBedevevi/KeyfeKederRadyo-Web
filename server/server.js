/**
 * KEYFE KEDER RADYO
 * SERVER / STREAM GATEWAY
 *
 * VERSION 5.1.0
 *
 * Compatible with:
 * - Local Windows development
 * - Linux hosting
 * - PORT environment variable
 * - db.js ES Module
 * - auth.js ES Module
 * - stations.json
 * - web/public/stations.json
 * - FFmpeg optional
 * - Python updater optional
 */

import express from "express";
import cors from "cors";

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  getUserByEmail,
  getUserById,
  getUserByUsername,
  createUser,
  updateLastLogin,
  updateProfile,
  updatePassword,
  getFavorites,
  addFavorite,
  removeFavorite,
  setFavorites,
  getSettings,
  saveSettings,
  addHistory,
  getHistory,
  getUserStats,
  initDb,
} from "./db.js";

import {
  hashPassword,
  verifyPassword,
  signToken,
  requireAuth,
  validateRegister,
  validateLogin,
  safeUser,
} from "./auth.js";

/* =========================================================
   VERSION
========================================================= */

const APP_VERSION = "5.1.0";

/* =========================================================
   PATHS
========================================================= */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/*
 * server/server.js
 *
 * __dirname:
 *   /home/.../app/server
 *
 * ROOT:
 *   /home/.../app
 *
 * ÖNEMLİ:
 * Eski sürüm "..", ".." ile proje kökünden
 * bir klasör fazla yukarı çıkıyordu.
 */

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

const AUTO_UPDATER = path.join(
  ROOT,
  "station_auto_update.py"
);

/* =========================================================
   PORT
========================================================= */

const ENV_PORT = Number(process.env.PORT);

const PORT =
  Number.isInteger(ENV_PORT) &&
  ENV_PORT > 0 &&
  ENV_PORT <= 65535
    ? ENV_PORT
    : 8787;

const HOST = "0.0.0.0";

/* =========================================================
   APP
========================================================= */

const app = express();

app.disable("x-powered-by");

app.use(
  cors({
    origin: true,
    credentials: false,
  })
);

app.use(
  express.json({
    limit: "256kb",
  })
);

/* =========================================================
   HELPERS
========================================================= */

function log(...args) {
  console.log(
    new Date().toISOString(),
    ...args
  );
}

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

function countStations(file) {
  try {
    if (!fs.existsSync(file)) {
      return 0;
    }

    const data = JSON.parse(
      fs.readFileSync(file, "utf8")
    );

    return Array.isArray(data)
      ? data.length
      : 0;
  } catch {
    return 0;
  }
}

function fileExists(file) {
  try {
    return fs.existsSync(file);
  } catch {
    return false;
  }
}

function sendError(
  res,
  status,
  message
) {
  return res.status(status).json({
    ok: false,
    success: false,
    error: message,
  });
}

function isExecutableAvailable(command) {
  return new Promise((resolve) => {
    try {
      const child = spawn(
        command,
        ["-version"],
        {
          stdio: [
            "ignore",
            "ignore",
            "ignore",
          ],
          windowsHide: true,
        }
      );

      let settled = false;

      const finish = (value) => {
        if (settled) {
          return;
        }

        settled = true;
        resolve(value);
      };

      child.on(
        "error",
        () => finish(false)
      );

      child.on(
        "close",
        (code) =>
          finish(
            code === 0
          )
      );

      setTimeout(() => {
        try {
          child.kill();
        } catch {}

        finish(false);
      }, 3000).unref();
    } catch {
      resolve(false);
    }
  });
}

/* =========================================================
   REDIRECT FOLLOWER
========================================================= */

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
  let completed = false;

  function fail(error) {
    if (completed || destroyed) {
      return;
    }

    completed = true;
    onError(error);
  }

  function makeRequest(urlObj) {
    if (destroyed || completed) {
      return;
    }

    const transport =
      urlObj.protocol === "https:"
        ? https
        : http;

    let request;

    try {
      request = transport.get(
        urlObj.href,
        {
          headers,
          timeout: 15000,
        },
        (upstream) => {
          if (destroyed) {
            upstream.destroy();
            return;
          }

          const status =
            upstream.statusCode || 0;

          const location =
            upstream.headers.location;

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
              fail(
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
              fail(
                new Error(
                  "Geçersiz yönlendirme adresi."
                )
              );

              return;
            }

            if (
              nextUrl.protocol !==
                "http:" &&
              nextUrl.protocol !==
                "https:"
            ) {
              fail(
                new Error(
                  "Desteklenmeyen yönlendirme protokolü."
                )
              );

              return;
            }

            makeRequest(nextUrl);

            return;
          }

          completed = true;

          onResponse(
            upstream,
            urlObj
          );
        }
      );

      currentRequest = request;

      request.on(
        "error",
        fail
      );

      request.on(
        "timeout",
        () => {
          try {
            request.destroy(
              new Error(
                "Upstream timeout."
              )
            );
          } catch {}

          fail(
            new Error(
              "Upstream timeout."
            )
          );
        }
      );
    } catch (error) {
      fail(error);
    }
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

/* =========================================================
   ROOT
========================================================= */

app.get(
  "/",
  (_req, res) => {
    res.json({
      ok: true,
      service:
        "keyfe-keder-radyo-gateway",
      version: APP_VERSION,
      port: PORT,
      host: HOST,
      environment:
        process.env.NODE_ENV ||
        "development",
      message:
        "Keyfe Keder Radyo Gateway çalışıyor.",
    });
  }
);

/* =========================================================
   HEALTH
========================================================= */

app.get(
  "/api/health",
  async (_req, res) => {
    const ffmpegCommand =
      process.env.FFMPEG_PATH ||
      "ffmpeg";

    const ffmpeg =
      await isExecutableAvailable(
        ffmpegCommand
      );

    res.json({
      ok: true,

      service:
        "keyfe-keder-radyo-gateway",

      version:
        APP_VERSION,

      status:
        "online",

      port:
        PORT,

      host:
        HOST,

      environment:
        process.env.NODE_ENV ||
        "development",

      database:
        true,

      updater:
        fileExists(
          UPDATER
        ),

      autoUpdater:
        fileExists(
          AUTO_UPDATER
        ),

      rootStations:
        fileExists(
          ROOT_STATIONS
        ),

      publicStations:
        fileExists(
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

      ffmpeg,

      paths: {
        root:
          ROOT,

        stations:
          ROOT_STATIONS,

        publicStations:
          PUBLIC_STATIONS,

        updater:
          UPDATER,
      },

      time:
        new Date().toISOString(),
    });
  }
);

/* =========================================================
   STATIONS
========================================================= */

app.get(
  "/api/stations",
  (_req, res) => {
    try {
      if (
        !fileExists(
          PUBLIC_STATIONS
        )
      ) {
        return sendError(
          res,
          404,
          "stations.json bulunamadı."
        );
      }

      const stations =
        JSON.parse(
          fs.readFileSync(
            PUBLIC_STATIONS,
            "utf8"
          )
        );

      if (
        !Array.isArray(
          stations
        )
      ) {
        return sendError(
          res,
          500,
          "stations.json geçersiz."
        );
      }

      res.json({
        ok: true,
        success: true,
        total:
          stations.length,
        stations,
      });
    } catch (error) {
      log(
        "[STATIONS]",
        error.message
      );

      sendError(
        res,
        500,
        "İstasyon listesi okunamadı."
      );
    }
  }
);

/* =========================================================
   CHECK STREAM
========================================================= */

app.get(
  "/api/check",
  (req, res) => {
    const target =
      parseUrl(
        req.query.url
      );

    if (!target) {
      return sendError(
        res,
        400,
        "Geçerli URL gerekli."
      );
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

      res.json(
        payload
      );
    };

    const timeout =
      setTimeout(
        () => {
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
              "Yayın zaman aşımına uğradı.",
          });
        },
        7000
      );

    request =
      requestFollowingRedirects(
        target,

        {
          "User-Agent":
            "Keyfe-Keder-Radyo/5.1",

          Accept:
            "*/*",

          "Icy-MetaData":
            "1",

          Range:
            "bytes=0-1024",
        },

        (
          upstream,
          finalUrl
        ) => {
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

            icyMetaInt:
              upstream.headers[
                "icy-metaint"
              ] || null,

            finalUrl:
              finalUrl.href,
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

/* =========================================================
   RELAY
========================================================= */

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
        .send(
          "Bad URL"
        );
    }

    let responseStarted =
      false;

    let request = null;

    request =
      requestFollowingRedirects(
        target,

        {
          "User-Agent":
            "Keyfe-Keder-Radyo/5.1",

          Accept:
            "*/*",

          "Icy-MetaData":
            "1",

          Connection:
            "keep-alive",
        },

        (upstream) => {
          if (
            responseStarted
          ) {
            upstream.destroy();
            return;
          }

          responseStarted =
            true;

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
            "Access-Control-Expose-Headers",
            "icy-metaint,content-type"
          );

          res.setHeader(
            "Cache-Control",
            "no-cache, no-store, must-revalidate"
          );

          res.setHeader(
            "Pragma",
            "no-cache"
          );

          res.setHeader(
            "Connection",
            "keep-alive"
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

          upstream.pipe(
            res
          );

          upstream.on(
            "error",
            (error) => {
              log(
                "[RELAY STREAM]",
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
            "[RELAY]",
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
        try {
          request?.destroy();
        } catch {}
      }
    );
  }
);

/* =========================================================
   TRANSCODE
========================================================= */

app.get(
  "/api/transcode",
  async (req, res) => {
    const target =
      parseUrl(
        req.query.url
      );

    if (!target) {
      return res
        .status(400)
        .send(
          "Bad URL"
        );
    }

    const ffmpeg =
      process.env.FFMPEG_PATH ||
      "ffmpeg";

    const available =
      await isExecutableAvailable(
        ffmpeg
      );

    if (!available) {
      log(
        "[FFMPEG] FFmpeg bulunamadı."
      );

      return res
        .status(503)
        .send(
          "FFmpeg sunucuda mevcut değil."
        );
    }

    res.setHeader(
      "Content-Type",
      "audio/mpeg"
    );

    res.setHeader(
      "Cache-Control",
      "no-cache,no-store"
    );

    res.setHeader(
      "Access-Control-Allow-Origin",
      "*"
    );

    res.setHeader(
      "Access-Control-Allow-Headers",
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

      "-reconnect_at_eof",
      "1",

      "-reconnect_delay_max",
      "5",

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

    let child;

    try {
      child =
        spawn(
          ffmpeg,
          args,
          {
            windowsHide:
              true,

            stdio: [
              "ignore",
              "pipe",
              "pipe",
            ],
          }
        );
    } catch (error) {
      log(
        "[FFMPEG]",
        error.message
      );

      return res
        .status(500)
        .send(
          "FFmpeg başlatılamadı."
        );
    }

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

    child.stdout.pipe(
      res
    );

    child.on(
      "error",
      (error) => {
        log(
          "[FFMPEG]",
          error.message
        );

        if (
          !res.headersSent
        ) {
          res
            .status(500)
            .send(
              "FFmpeg çalıştırılamadı."
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
            "[FFMPEG EXIT]",
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
          if (
            child &&
            !child.killed
          ) {
            child.kill(
              "SIGKILL"
            );
          }
        } catch {}
      }
    );
  }
);

/* =========================================================
   METADATA
========================================================= */

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

      res.json(
        payload
      );
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

    try {
      request =
        transport.get(
          target.href,
          {
            headers: {
              "User-Agent":
                "Keyfe-Keder-Radyo/5.1",

              Accept:
                "*/*",

              "Icy-MetaData":
                "1",
            },

            timeout: 10000,
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
                artist: "",
                title: "",
                raw: "",
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

                    const length =
                      chunk[
                        offset
                      ] *
                      16;

                    offset++;

                    metadataRemaining =
                      length;

                    buffer =
                      Buffer.alloc(
                        0
                      );

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

                    if (
                      take > 0
                    ) {
                      buffer =
                        Buffer.concat([
                          buffer,
                          chunk.subarray(
                            offset,
                            offset +
                              take
                          ),
                        ]);
                    }

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
                            " · ",
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
                          success:
                            true,

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
                  artist: "",
                  title: "",
                  raw: "",
                });
              }
            );

            stream.on(
              "end",
              () => {
                clearTimeout(
                  timeout
                );

                if (!finished) {
                  finish({
                    success: false,
                    artist: "",
                    title: "",
                    raw: "",
                  });
                }
              }
            );
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
            artist: "",
            title: "",
            raw: "",
          });
        }
      );

      request.on(
        "timeout",
        () => {
          try {
            request.destroy();
          } catch {}

          clearTimeout(
            timeout
          );

          finish({
            success: false,
            artist: "",
            title: "",
            raw: "",
          });
        }
      );
    } catch {
      clearTimeout(
        timeout
      );

      finish({
        success: false,
        artist: "",
        title: "",
        raw: "",
      });
    }
  }
);

/* =========================================================
   ALBUM COVER
========================================================= */

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
                "Keyfe-Keder-Radyo/5.1",
            },
          }
        );

      if (
        !response.ok
      ) {
        throw new Error(
          `iTunes HTTP ${response.status}`
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
        "[COVER]",
        error.message
      );

      res.json({
        success: false,
        cover: "",
      });
    }
  }
);

/* =========================================================
   AUTH - REGISTER
========================================================= */

app.post(
  "/api/auth/register",
  async (req, res) => {
    try {
      const body =
        req.body || {};

      const errors =
        validateRegister(
          body
        );

      if (
        errors.length
      ) {
        return res
          .status(400)
          .json({
            ok: false,
            success: false,
            errors,
          });
      }

      const username =
        String(
          body.username
        ).trim();

      const email =
        String(
          body.email
        )
          .trim()
          .toLowerCase();

      const password =
        String(
          body.password
        );

      const display_name =
        body.display_name
          ? String(
              body.display_name
            ).trim()
          : username;

      if (
        getUserByEmail(
          email
        )
      ) {
        return res
          .status(409)
          .json({
            ok: false,
            success: false,
            error:
              "Bu e-posta zaten kayıtlı.",
          });
      }

      if (
        getUserByUsername(
          username
        )
      ) {
        return res
          .status(409)
          .json({
            ok: false,
            success: false,
            error:
              "Bu kullanıcı adı zaten kullanılıyor.",
          });
      }

      const hashed =
        await hashPassword(
          password
        );

      const user =
        createUser({
          username,
          email,
          password:
            hashed,
          display_name,
        });

      if (!user) {
        return sendError(
          res,
          500,
          "Kullanıcı oluşturulamadı."
        );
      }

      const token =
        signToken(
          user.id
        );

      res.status(201).json({
        ok: true,
        success: true,
        token,
        user:
          safeUser(user),
      });
    } catch (error) {
      log(
        "[REGISTER]",
        error.message
      );

      sendError(
        res,
        500,
        "Kayıt sırasında hata oluştu."
      );
    }
  }
);

/* =========================================================
   AUTH - LOGIN
========================================================= */

app.post(
  "/api/auth/login",
  async (req, res) => {
    try {
      const body =
        req.body || {};

      const errors =
        validateLogin(
          body
        );

      if (
        errors.length
      ) {
        return res
          .status(400)
          .json({
            ok: false,
            success: false,
            errors,
          });
      }

      const email =
        String(
          body.email
        )
          .trim()
          .toLowerCase();

      const password =
        String(
          body.password
        );

      const user =
        getUserByEmail(
          email
        );

      if (!user) {
        return res
          .status(401)
          .json({
            ok: false,
            success: false,
            error:
              "E-posta veya şifre hatalı.",
          });
      }

      const valid =
        await verifyPassword(
          password,
          user.password
        );

      if (!valid) {
        return res
          .status(401)
          .json({
            ok: false,
            success: false,
            error:
              "E-posta veya şifre hatalı.",
          });
      }

      updateLastLogin(
        user.id
      );

      const token =
        signToken(
          user.id
        );

      const freshUser =
        getUserById(
          user.id
        );

      res.json({
        ok: true,
        success: true,
        token,
        user:
          safeUser(
            freshUser
          ),
      });
    } catch (error) {
      log(
        "[LOGIN]",
        error.message
      );

      sendError(
        res,
        500,
        "Giriş sırasında hata oluştu."
      );
    }
  }
);

/* =========================================================
   AUTH - ME
========================================================= */

app.get(
  "/api/auth/me",
  requireAuth,
  (req, res) => {
    res.json({
      ok: true,
      success: true,
      user:
        safeUser(
          req.user
        ),
    });
  }
);

/* =========================================================
   AUTH - PROFILE
========================================================= */

app.put(
  "/api/auth/profile",
  requireAuth,
  (req, res) => {
    try {
      const body =
        req.body || {};

      const updated =
        updateProfile(
          req.user.id,
          {
            display_name:
              body.display_name,
            avatar_emoji:
              body.avatar_emoji,
            bio:
              body.bio,
          }
        );

      res.json({
        ok: true,
        success: true,
        user:
          safeUser(
            updated
          ),
      });
    } catch (error) {
      log(
        "[PROFILE]",
        error.message
      );

      sendError(
        res,
        500,
        "Profil güncellenemedi."
      );
    }
  }
);

/* =========================================================
   AUTH - PASSWORD
========================================================= */

app.put(
  "/api/auth/password",
  requireAuth,
  async (req, res) => {
    try {
      const currentPassword =
        String(
          req.body
            ?.current_password ||
            ""
        );

      const newPassword =
        String(
          req.body
            ?.new_password ||
            ""
        );

      if (
        !currentPassword ||
        !newPassword
      ) {
        return sendError(
          res,
          400,
          "Mevcut ve yeni şifre gerekli."
        );
      }

      if (
        newPassword.length <
        6
      ) {
        return sendError(
          res,
          400,
          "Yeni şifre en az 6 karakter olmalı."
        );
      }

      const valid =
        await verifyPassword(
          currentPassword,
          req.user.password
        );

      if (!valid) {
        return sendError(
          res,
          401,
          "Mevcut şifre hatalı."
        );
      }

      const hashed =
        await hashPassword(
          newPassword
        );

      updatePassword(
        req.user.id,
        hashed
      );

      res.json({
        ok: true,
        success: true,
        message:
          "Şifre güncellendi.",
      });
    } catch (error) {
      log(
        "[PASSWORD]",
        error.message
      );

      sendError(
        res,
        500,
        "Şifre güncellenemedi."
      );
    }
  }
);

/* =========================================================
   USER - FAVORITES GET
========================================================= */

app.get(
  "/api/user/favorites",
  requireAuth,
  (req, res) => {
    try {
      res.json({
        ok: true,
        success: true,
        favorites:
          getFavorites(
            req.user.id
          ),
      });
    } catch (error) {
      log(
        "[FAVORITES GET]",
        error.message
      );

      sendError(
        res,
        500,
        "Favoriler alınamadı."
      );
    }
  }
);

/* =========================================================
   USER - FAVORITE ADD
========================================================= */

app.post(
  "/api/user/favorites",
  requireAuth,
  (req, res) => {
    try {
      const stationId =
        String(
          req.body
            ?.station_id ||
            ""
        ).trim();

      if (
        !stationId
      ) {
        return sendError(
          res,
          400,
          "station_id gerekli."
        );
      }

      const result =
        addFavorite(
          req.user.id,
          stationId
        );

      res.json({
        ok: true,
        success: result,
        favorites:
          getFavorites(
            req.user.id
          ),
      });
    } catch (error) {
      log(
        "[FAVORITE ADD]",
        error.message
      );

      sendError(
        res,
        500,
        "Favori eklenemedi."
      );
    }
  }
);

/* =========================================================
   USER - FAVORITE REMOVE
========================================================= */

app.delete(
  "/api/user/favorites/:stationId",
  requireAuth,
  (req, res) => {
    try {
      removeFavorite(
        req.user.id,
        String(
          req.params.stationId
        )
      );

      res.json({
        ok: true,
        success: true,
        favorites:
          getFavorites(
            req.user.id
          ),
      });
    } catch (error) {
      log(
        "[FAVORITE REMOVE]",
        error.message
      );

      sendError(
        res,
        500,
        "Favori silinemedi."
      );
    }
  }
);

/* =========================================================
   USER - FAVORITES SET
========================================================= */

app.put(
  "/api/user/favorites",
  requireAuth,
  (req, res) => {
    try {
      const favorites =
        Array.isArray(
          req.body
            ?.favorites
        )
          ? req.body.favorites
              .map(
                (x) =>
                  String(x).trim()
              )
              .filter(Boolean)
          : [];

      setFavorites(
        req.user.id,
        [
          ...new Set(
            favorites
          ),
        ]
      );

      res.json({
        ok: true,
        success: true,
        favorites:
          getFavorites(
            req.user.id
          ),
      });
    } catch (error) {
      log(
        "[FAVORITES SET]",
        error.message
      );

      sendError(
        res,
        500,
        "Favoriler kaydedilemedi."
      );
    }
  }
);

/* =========================================================
   USER - SETTINGS
========================================================= */

app.get(
  "/api/user/settings",
  requireAuth,
  (req, res) => {
    try {
      res.json({
        ok: true,
        success: true,
        settings:
          getSettings(
            req.user.id
          ),
      });
    } catch (error) {
      log(
        "[SETTINGS GET]",
        error.message
      );

      sendError(
        res,
        500,
        "Ayarlar alınamadı."
      );
    }
  }
);

app.put(
  "/api/user/settings",
  requireAuth,
  (req, res) => {
    try {
      const data =
        req.body?.settings;

      if (
        !data ||
        typeof data !==
          "object" ||
        Array.isArray(data)
      ) {
        return sendError(
          res,
          400,
          "Geçerli settings objesi gerekli."
        );
      }

      saveSettings(
        req.user.id,
        data
      );

      res.json({
        ok: true,
        success: true,
        settings:
          getSettings(
            req.user.id
          ),
      });
    } catch (error) {
      log(
        "[SETTINGS PUT]",
        error.message
      );

      sendError(
        res,
        500,
        "Ayarlar kaydedilemedi."
      );
    }
  }
);

/* =========================================================
   USER - HISTORY
========================================================= */

app.get(
  "/api/user/history",
  requireAuth,
  (req, res) => {
    try {
      const requested =
        Number(
          req.query.limit
        );

      const limit =
        Number.isInteger(
          requested
        )
          ? Math.min(
              Math.max(
                requested,
                1
              ),
              50
            )
          : 20;

      res.json({
        ok: true,
        success: true,
        history:
          getHistory(
            req.user.id,
            limit
          ),
      });
    } catch (error) {
      log(
        "[HISTORY GET]",
        error.message
      );

      sendError(
        res,
        500,
        "Geçmiş alınamadı."
      );
    }
  }
);

app.post(
  "/api/user/history",
  requireAuth,
  (req, res) => {
    try {
      const stationId =
        String(
          req.body
            ?.station_id ||
            ""
        ).trim();

      if (
        !stationId
      ) {
        return sendError(
          res,
          400,
          "station_id gerekli."
        );
      }

      addHistory(
        req.user.id,
        stationId
      );

      res.json({
        ok: true,
        success: true,
      });
    } catch (error) {
      log(
        "[HISTORY POST]",
        error.message
      );

      sendError(
        res,
        500,
        "Geçmiş kaydedilemedi."
      );
    }
  }
);

/* =========================================================
   USER - STATS
========================================================= */

app.get(
  "/api/user/stats",
  requireAuth,
  (req, res) => {
    try {
      res.json({
        ok: true,
        success: true,
        stats:
          getUserStats(
            req.user.id
          ),
      });
    } catch (error) {
      log(
        "[STATS]",
        error.message
      );

      sendError(
        res,
        500,
        "İstatistikler alınamadı."
      );
    }
  }
);

/* =========================================================
   COPY STATIONS
========================================================= */

function copyStationsToPublic() {
  if (
    !fileExists(
      ROOT_STATIONS
    )
  ) {
    throw new Error(
      `Ana stations.json bulunamadı: ${ROOT_STATIONS}`
    );
  }

  const content =
    fs.readFileSync(
      ROOT_STATIONS,
      "utf8"
    );

  const parsed =
    JSON.parse(
      content
    );

  if (
    !Array.isArray(
      parsed
    )
  ) {
    throw new Error(
      "stations.json bir array olmalı."
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

  try {
    fs.renameSync(
      temp,
      PUBLIC_STATIONS
    );
  } catch {
    try {
      fs.copyFileSync(
        temp,
        PUBLIC_STATIONS
      );

      fs.unlinkSync(
        temp
      );
    } catch {
      throw new Error(
        "Public stations.json yazılamadı."
      );
    }
  }

  return parsed.length;
}

/* =========================================================
   PYTHON EXECUTABLE
========================================================= */

function getPythonCommand() {
  if (
    process.env.PYTHON_PATH
  ) {
    return {
      command:
        process.env.PYTHON_PATH,
      args: [],
    };
  }

  if (
    process.platform ===
    "win32"
  ) {
    return {
      command: "py",
      args: [],
    };
  }

  return {
    command: "python3",
    args: [],
  };
}

/* =========================================================
   PYTHON UPDATER
========================================================= */

function runUpdater() {
  return new Promise(
    (resolve) => {
      if (
        !fileExists(
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
        "[UPDATER] Başlıyor..."
      );

      const python =
        getPythonCommand();

      let child;

      try {
        child =
          spawn(
            python.command,
            [
              ...python.args,
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
      } catch (error) {
        resolve({
          success: false,
          message:
            error.message,
        });

        return;
      }

      let stdout = "";
      let stderr = "";
      let settled = false;

      const finish = (
        result
      ) => {
        if (settled) {
          return;
        }

        settled = true;
        resolve(result);
      };

      child.stdout.on(
        "data",
        (chunk) => {
          const value =
            chunk.toString();

          stdout +=
            value;

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

          stderr +=
            value;

          process.stderr.write(
            `[UPDATER] ${value}`
          );
        }
      );

      child.on(
        "error",
        (error) => {
          finish({
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
            finish({
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

            finish({
              success: true,
              total,
              stdout,
              stderr,
              message:
                "Radyo listesi güncellendi.",
            });
          } catch (error) {
            finish({
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

/* =========================================================
   UPDATE STATIONS API
========================================================= */

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
          .json(
            result
          );
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
        ok: true,

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
      log(
        "[UPDATE STATIONS]",
        error.message
      );

      res
        .status(500)
        .json({
          ok: false,
          success: false,
          message:
            error.message,
        });
    }
  }
);

/* =========================================================
   404
========================================================= */

app.use(
  (req, res) => {
    res.status(404).json({
      ok: false,
      success: false,
      error:
        "Endpoint bulunamadı.",
      path: req.path,
    });
  }
);

/* =========================================================
   GLOBAL ERROR
========================================================= */

app.use(
  (
    error,
    _req,
    res,
    _next
  ) => {
    log(
      "[GLOBAL ERROR]",
      error?.message ||
        error
    );

    if (
      res.headersSent
    ) {
      return;
    }

    res.status(500).json({
      ok: false,
      success: false,
      error:
        "Sunucu hatası.",
    });
  }
);

/* =========================================================
   START
========================================================= */

let server = null;

async function startServer() {
  try {
    /*
     * DB önce hazır olsun.
     */
    await initDb();

    /*
     * Public stations yoksa root stations'tan
     * otomatik oluştur.
     */
    if (
      fileExists(
        ROOT_STATIONS
      )
    ) {
      try {
        const rootCount =
          countStations(
            ROOT_STATIONS
          );

        const publicCount =
          countStations(
            PUBLIC_STATIONS
          );

        /*
         * Public dosya yoksa veya boşsa
         * root ile senkronla.
         */
        if (
          !fileExists(
            PUBLIC_STATIONS
          ) ||
          publicCount === 0
        ) {
          const total =
            copyStationsToPublic();

          log(
            `[STATIONS] Public liste oluşturuldu: ${total}`
          );
        } else {
          log(
            `[STATIONS] Root: ${rootCount} | Public: ${publicCount}`
          );
        }
      } catch (error) {
        log(
          "[STATIONS INIT]",
          error.message
        );
      }
    } else {
      log(
        `[STATIONS] Ana stations.json bulunamadı: ${ROOT_STATIONS}`
      );
    }

    server =
      app.listen(
        PORT,
        HOST,
        () => {
          console.log("");
          console.log(
            "================================================"
          );
          console.log(
            `        KEYFE KEDER RADYO GATEWAY v${APP_VERSION}`
          );
          console.log(
            "================================================"
          );
          console.log(
            `Local:          http://127.0.0.1:${PORT}`
          );
          console.log(
            `Network:        http://0.0.0.0:${PORT}`
          );
          console.log(
            `Health:         /api/health`
          );
          console.log(
            `Stations:       ${ROOT_STATIONS}`
          );
          console.log(
            `Web list:       ${PUBLIC_STATIONS}`
          );
          console.log(
            `Updater:        ${UPDATER}`
          );
          console.log(
            `DB directory:   ${ROOT}`
          );
          console.log(
            `PORT:           ${PORT}`
          );
          console.log(
            `ENV:            ${
              process.env.NODE_ENV ||
              "development"
            }`
          );
          console.log(
            "Relay:          enabled"
          );
          console.log(
            "Transcode:      FFmpeg optional"
          );
          console.log(
            "Metadata:       ICY"
          );
          console.log(
            "Cover:          iTunes lookup"
          );
          console.log(
            "Auth:           enabled"
          );
          console.log(
            "================================================"
          );
          console.log("");
        }
      );

    server.on(
      "error",
      (error) => {
        log(
          "[SERVER ERROR]",
          error.message
        );

        if (
          error.code ===
          "EADDRINUSE"
        ) {
          log(
            `Port ${PORT} zaten kullanımda.`
          );
        }
      }
    );
  } catch (error) {
    console.error(
      "[FATAL]",
      error
    );

    process.exit(1);
  }
}

/* =========================================================
   GRACEFUL SHUTDOWN
========================================================= */

function shutdown(
  signal
) {
  log(
    `${signal} alındı. Sunucu kapatılıyor...`
  );

  if (!server) {
    process.exit(0);
    return;
  }

  server.close(
    () => {
      log(
        "HTTP server kapatıldı."
      );

      process.exit(0);
    }
  );

  setTimeout(
    () => {
      log(
        "Zorunlu kapanış."
      );

      process.exit(1);
    },
    10000
  ).unref();
}

process.on(
  "SIGTERM",
  () => {
    shutdown(
      "SIGTERM"
    );
  }
);

process.on(
  "SIGINT",
  () => {
    shutdown(
      "SIGINT"
    );
  }
);

/* =========================================================
   UNHANDLED ERRORS
========================================================= */

process.on(
  "unhandledRejection",
  (reason) => {
    log(
      "[UNHANDLED REJECTION]",
      reason
    );
  }
);

process.on(
  "uncaughtException",
  (error) => {
    log(
      "[UNCAUGHT EXCEPTION]",
      error
    );
  }
);

/* =========================================================
   RUN
========================================================= */

startServer();
