import express from "express";
import cors from "cors";
import morgan from "morgan";
import { spawn } from "node:child_process";
import {
  initDb,
  createUser, getUserByEmail, getUserByUsername, getUserById,
  updateLastLogin, updateProfile, updatePassword,
  getFavorites, setFavorites, addFavorite, removeFavorite,
  getSettings, saveSettings,
  getHistory, addHistory,
  getUserStats,
} from "./db.js";
import {
  hashPassword, verifyPassword, signToken,
  requireAuth, safeUser,
  validateRegister, validateLogin,
} from "./auth.js";

const app = express();

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";

/* =========================================================
   DB BAŞLAT
========================================================= */
await initDb();

/* =========================================================
   CORS — auth için credentials: true + origin whitelist
========================================================= */
const ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
];

app.use(
  cors({
    origin: (origin, cb) => {
      // Origin yoksa (curl, Postman, same-origin) izin ver
      if (!origin) return cb(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      cb(null, true); // LAN erişimi için tümüne izin (prod'da kısıtla)
    },
    methods: ["GET", "HEAD", "OPTIONS", "POST", "PUT", "DELETE", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

app.use(
  express.json({
    limit: "32kb",
  })
);

app.use(morgan("tiny"));

/* =========================================================
   CONFIG
========================================================= */

const FETCH_TIMEOUT = 18000;

const USER_AGENT =
  "KeyfeKederRadyo/1.2 (+https://localhost)";

/* =========================================================
   URL VALIDATION
========================================================= */

function cleanUrl(value) {
  const url = String(value || "").trim();

  if (!url || url.length > 4096) {
    return "";
  }

  try {
    const parsed = new URL(url);

    if (
      parsed.protocol !== "http:" &&
      parsed.protocol !== "https:"
    ) {
      return "";
    }

    return parsed.toString();
  } catch {
    return "";
  }
}

function isPrivateIpv4(host) {
  const parts = host
    .split(".")
    .map(Number);

  if (parts.length !== 4) {
    return false;
  }

  if (
    parts.some(
      (part) =>
        !Number.isInteger(part) ||
        part < 0 ||
        part > 255
    )
  ) {
    return false;
  }

  if (parts[0] === 10) {
    return true;
  }

  if (
    parts[0] === 192 &&
    parts[1] === 168
  ) {
    return true;
  }

  if (
    parts[0] === 172 &&
    parts[1] >= 16 &&
    parts[1] <= 31
  ) {
    return true;
  }

  if (
    parts[0] === 169 &&
    parts[1] === 254
  ) {
    return true;
  }

  if (
    parts[0] === 127
  ) {
    return true;
  }

  return false;
}

function isBlockedHost(hostname) {
  const host =
    String(hostname || "")
      .toLowerCase()
      .replace(
        /^\[/,
        ""
      )
      .replace(
        /\]$/,
        ""
      );

  if (
    host === "localhost" ||
    host === "::1" ||
    host === "0.0.0.0"
  ) {
    return true;
  }

  if (isPrivateIpv4(host)) {
    return true;
  }

  /*
   * Basit IPv6 private/local kontrolü.
   */
  if (
    host.startsWith("fc") ||
    host.startsWith("fd") ||
    host.startsWith("fe80:")
  ) {
    return true;
  }

  return false;
}

function validateUrl(value) {
  const url = cleanUrl(value);

  if (!url) {
    return {
      ok: false,
      error:
        "Geçersiz stream URL.",
    };
  }

  try {
    const parsed = new URL(url);

    if (
      isBlockedHost(
        parsed.hostname
      )
    ) {
      return {
        ok: false,
        error:
          "Bu host proxy üzerinden kullanılamaz.",
      };
    }

    return {
      ok: true,
      url,
    };
  } catch {
    return {
      ok: false,
      error:
        "URL doğrulanamadı.",
    };
  }
}

/* =========================================================
   FETCH HELPERS
========================================================= */

async function fetchUpstream(
  url,
  options = {}
) {
  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () =>
        controller.abort(),
      FETCH_TIMEOUT
    );

  try {
    const response =
      await fetch(
        url,
        {
          redirect:
            "follow",

          signal:
            controller.signal,

          headers: {
            "User-Agent":
              USER_AGENT,

            Accept:
              options.accept ||
              "*/*",

            ...(options.range
              ? {
                  Range:
                    options.range,
                }
              : {}),
          },
        }
      );

    clearTimeout(timeout);

    return response;
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}

/* =========================================================
   HLS DETECTION
========================================================= */

function isHlsContent(
  url,
  contentType = ""
) {
  return (
    /mpegurl|vnd\.apple\.mpegurl/i.test(
      contentType
    ) ||
    /\.m3u8(?:$|\?)/i.test(
      url
    )
  );
}

function isProbablyPlaylist(
  text
) {
  return (
    text.includes(
      "#EXTM3U"
    ) ||
    text.includes(
      "#EXT-X-"
    )
  );
}

/* =========================================================
   HLS URL REWRITE
========================================================= */

function gatewayUrl(
  target
) {
  return (
    "/api/hls-resource?url=" +
    encodeURIComponent(
      target
    )
  );
}

function rewriteUriAttribute(
  line,
  baseUrl
) {
  return line.replace(
    /URI="([^"]+)"/i,
    (_match, uri) => {
      try {
        const absolute =
          new URL(
            uri,
            baseUrl
          ).toString();

        return `URI="${gatewayUrl(
          absolute
        )}"`;
      } catch {
        return `URI="${uri}"`;
      }
    }
  );
}

function rewritePlaylist(
  playlist,
  baseUrl
) {
  const lines =
    playlist.split(/\r?\n/);

  const result = [];

  for (
    let line of lines
  ) {
    const trimmed =
      line.trim();

    /*
     * #EXT-X-KEY
     * #EXT-X-MAP
     * #EXT-X-MEDIA
     * vb. içindeki URI
     */
    if (
      trimmed.startsWith(
        "#"
      )
    ) {
      if (
        /URI="/i.test(
          line
        )
      ) {
        line =
          rewriteUriAttribute(
            line,
            baseUrl
          );
      }

      result.push(line);
      continue;
    }

    /*
     * Boş satır.
     */
    if (!trimmed) {
      result.push(line);
      continue;
    }

    /*
     * HLS segment / nested playlist.
     */
    try {
      const absolute =
        new URL(
          trimmed,
          baseUrl
        ).toString();

      result.push(
        gatewayUrl(
          absolute
        )
      );
    } catch {
      result.push(line);
    }
  }

  return result.join(
    "\n"
  );
}

/* =========================================================
   HEALTH
========================================================= */

app.get(
  "/api/health",
  (_req, res) => {
    res.json({
      ok: true,
      service:
        "Keyfe Keder Radyo Stream Gateway",
      version: "1.1.0",
      hlsProxy: true,
      relay: true,
      transcode: true,
    });
  }
);

/* =========================================================
   CHECK
========================================================= */

app.get(
  "/api/check",
  async (req, res) => {
    const validation =
      validateUrl(
        req.query.url
      );

    if (!validation.ok) {
      return res
        .status(400)
        .json(validation);
    }

    try {
      const upstream =
        await fetchUpstream(
          validation.url,
          {
            accept:
              "*/*",
          }
        );

      const contentType =
        upstream.headers.get(
          "content-type"
        ) || "";

      res.json({
        ok:
          upstream.ok,

        status:
          upstream.status,

        contentType,

        finalUrl:
          upstream.url ||
          validation.url,

        hls:
          isHlsContent(
            upstream.url ||
              validation.url,
            contentType
          ),
      });
    } catch (error) {
      res
        .status(502)
        .json({
          ok: false,

          error:
            error?.name ===
            "AbortError"
              ? "Yayın zaman aşımına uğradı."
              : "Yayın kontrol edilemedi.",
        });
    }
  }
);

/* =========================================================
   HLS RESOURCE
========================================================= */

app.get(
  "/api/hls-resource",
  async (req, res) => {
    const validation =
      validateUrl(
        req.query.url
      );

    if (!validation.ok) {
      return res
        .status(400)
        .send(validation.error);
    }

    const target =
      validation.url;

    try {
      const upstream =
        await fetchUpstream(
          target,
          {
            accept:
              "application/vnd.apple.mpegurl,application/x-mpegURL,audio/*,*/*",
          }
        );

      if (!upstream.ok) {
        return res
          .status(502)
          .send(
            `Upstream status: ${upstream.status}`
          );
      }

      const contentType =
        upstream.headers.get(
          "content-type"
        ) || "";

      /*
       * Playlist ise içindeki bütün
       * URL'leri tekrar gateway'e bağla.
       */
      if (
        isHlsContent(
          upstream.url ||
            target,
          contentType
        )
      ) {
        const text =
          await upstream.text();

        if (
          !isProbablyPlaylist(
            text
          )
        ) {
          return res
            .status(502)
            .send(
              "HLS manifest okunamadı."
            );
        }

        const rewritten =
          rewritePlaylist(
            text,
            upstream.url ||
              target
          );

        res.setHeader(
          "Content-Type",
          "application/vnd.apple.mpegurl"
        );

        res.setHeader(
          "Cache-Control",
          "no-cache, no-store, must-revalidate"
        );

        res.setHeader(
          "Access-Control-Allow-Origin",
          "*"
        );

        res.send(
          rewritten
        );

        return;
      }

      /*
       * Playlist değilse segment,
       * audio chunk veya key olabilir.
       */
      const length =
        upstream.headers.get(
          "content-length"
        );

      if (contentType) {
        res.setHeader(
          "Content-Type",
          contentType
        );
      }

      if (length) {
        res.setHeader(
          "Content-Length",
          length
        );
      }

      res.setHeader(
        "Cache-Control",
        "no-cache, no-store, must-revalidate"
      );

      res.setHeader(
        "Access-Control-Allow-Origin",
        "*"
      );

      if (
        !upstream.body
      ) {
        return res
          .status(502)
          .send(
            "HLS resource boş."
          );
      }

      const reader =
        upstream.body.getReader();

      req.on(
        "close",
        () => {
          try {
            reader.cancel();
          } catch {}
        }
      );

      while (true) {
        const {
          done,
          value,
        } =
          await reader.read();

        if (done) {
          break;
        }

        if (value && !res.destroyed) {
          try {
            res.write(Buffer.from(value));
          } catch {
            // İstemci bağlantıyı kopardı
            try { reader.cancel(); } catch {}
            break;
          }
        }
      }

      if (!res.destroyed) res.end();
    } catch (error) {
      console.error(
        "[HLS RESOURCE]",
        error
      );

      if (!res.headersSent) {
        res.status(502).send("HLS kaynağı alınamadı.");
      } else if (!res.destroyed) {
        res.end();
      }
    }
  }
);

/* =========================================================
   GENERIC RELAY
========================================================= */

app.get(
  "/api/relay",
  async (req, res) => {
    const validation =
      validateUrl(
        req.query.url
      );

    if (!validation.ok) {
      return res
        .status(400)
        .send(validation.error);
    }

    try {
      const upstream =
        await fetchUpstream(
          validation.url,
          {
            accept:
              "audio/*,*/*",
            range:
              req.headers.range,
          }
        );

      if (!upstream.ok) {
        return res
          .status(502)
          .send(
            `Upstream status: ${upstream.status}`
          );
      }

      const contentType =
        upstream.headers.get(
          "content-type"
        ) || "";

      /*
       * HLS'i generic relay üzerinden
       * geçirmek yerine HLS endpoint'ine
       * yönlendir.
       */
      if (
        isHlsContent(
          upstream.url ||
            validation.url,
          contentType
        )
      ) {
        return res.redirect(
          307,
          gatewayUrl(
            upstream.url ||
              validation.url
          )
        );
      }

      if (contentType) {
        res.setHeader(
          "Content-Type",
          contentType
        );
      }

      const contentLength =
        upstream.headers.get(
          "content-length"
        );

      if (
        contentLength
      ) {
        res.setHeader(
          "Content-Length",
          contentLength
        );
      }

      const acceptRanges =
        upstream.headers.get(
          "accept-ranges"
        );

      if (
        acceptRanges
      ) {
        res.setHeader(
          "Accept-Ranges",
          acceptRanges
        );
      }

      const contentRange =
        upstream.headers.get(
          "content-range"
        );

      if (
        contentRange
      ) {
        res.setHeader(
          "Content-Range",
          contentRange
        );
      }

      res.setHeader(
        "Cache-Control",
        "no-cache, no-store, must-revalidate"
      );

      res.setHeader(
        "Access-Control-Allow-Origin",
        "*"
      );

      if (
        !upstream.body
      ) {
        return res
          .status(502)
          .send(
            "Stream body bulunamadı."
          );
      }

      const reader =
        upstream.body.getReader();

      req.on(
        "close",
        () => {
          try {
            reader.cancel();
          } catch {}
        }
      );

      while (true) {
        const {
          done,
          value,
        } =
          await reader.read();

        if (done) {
          break;
        }

        if (value && !res.destroyed) {
          try {
            res.write(Buffer.from(value));
          } catch {
            try { reader.cancel(); } catch {}
            break;
          }
        }
      }

      if (!res.destroyed) res.end();
    } catch (error) {
      console.error(
        "[RELAY]",
        error
      );

      if (!res.headersSent) {
        res.status(502).send("Stream relay başarısız.");
      } else if (!res.destroyed) {
        res.end();
      }
    }
  }
);

/* =========================================================
   FFMPEG TRANSCODE
========================================================= */

app.get(
  "/api/transcode",
  async (req, res) => {
    const validation =
      validateUrl(
        req.query.url
      );

    if (!validation.ok) {
      return res
        .status(400)
        .send(validation.error);
    }

    console.log(
      "[TRANSCODE]",
      validation.url
    );

    res.statusCode = 200;

    res.setHeader(
      "Content-Type",
      "audio/mpeg"
    );

    res.setHeader(
      "Cache-Control",
      "no-cache, no-store, must-revalidate"
    );

    res.setHeader(
      "Access-Control-Allow-Origin",
      "*"
    );

    const ffmpeg =
      spawn(
        "ffmpeg",
        [
          "-hide_banner",
          "-loglevel",
          "error",

          "-reconnect",
          "1",

          "-reconnect_streamed",
          "1",

          "-reconnect_delay_max",
          "5",

          "-i",
          validation.url,

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
        ],
        {
          stdio: [
            "ignore",
            "pipe",
            "pipe",
          ],
        }
      );

    let stderr = "";

    ffmpeg.stderr.on(
      "data",
      (chunk) => {
        stderr +=
          chunk.toString();

        if (
          stderr.length >
          6000
        ) {
          stderr =
            stderr.slice(-6000);
        }
      }
    );

    ffmpeg.stdout.on(
      "data",
      (chunk) => {
        if (!res.destroyed) {
          try {
            res.write(chunk);
          } catch {
            try { ffmpeg.kill("SIGKILL"); } catch {}
          }
        }
      }
    );

    ffmpeg.stdout.on(
      "end",
      () => {
        if (!res.destroyed) {
          res.end();
        }
      }
    );

    ffmpeg.on(
      "error",
      (error) => {
        console.error(
          "[FFMPEG ERROR]",
          error
        );

        if (
          !res.headersSent
        ) {
          res
            .status(500)
            .send(
              "FFmpeg başlatılamadı. FFmpeg kurulu mu?"
            );
        } else {
          res.end();
        }
      }
    );

    ffmpeg.on(
      "close",
      (code) => {
        if (
          code !== 0 &&
          stderr
        ) {
          console.warn(
            "[FFMPEG]",
            stderr
          );
        }
      }
    );

    req.on(
      "close",
      () => {
        try {
          ffmpeg.kill(
            "SIGKILL"
          );
        } catch {}
      }
    );
  }
);

/* =========================================================
   AUTH — register / login / me / logout / profil
========================================================= */

/* ── Kayıt ───────────────────────────────────────────── */
app.post("/api/auth/register", async (req, res) => {
  try {
    const { username, email, password, display_name } = req.body ?? {};

    const errs = validateRegister({ username, email, password });
    if (errs.length) return res.status(400).json({ ok: false, error: errs[0], errors: errs });

    // Mükerrer kontrol
    if (getUserByEmail(email?.trim())) {
      return res.status(409).json({ ok: false, error: "Bu e-posta adresi zaten kayıtlı." });
    }
    if (getUserByUsername(username?.trim())) {
      return res.status(409).json({ ok: false, error: "Bu kullanıcı adı zaten kullanımda." });
    }

    const hashed = await hashPassword(password);
    const user   = createUser({ username: username.trim(), email: email.trim(), password: hashed, display_name });
    updateLastLogin(user.id);

    const token = signToken(user.id);
    return res.status(201).json({ ok: true, token, user: safeUser(user) });
  } catch (e) {
    console.error("[AUTH/REGISTER]", e);
    return res.status(500).json({ ok: false, error: "Kayıt işlemi başarısız." });
  }
});

/* ── Giriş ───────────────────────────────────────────── */
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body ?? {};

    const errs = validateLogin({ email, password });
    if (errs.length) return res.status(400).json({ ok: false, error: errs[0] });

    const user = getUserByEmail(email?.trim());
    if (!user) {
      return res.status(401).json({ ok: false, error: "E-posta veya şifre hatalı." });
    }

    const match = await verifyPassword(password, user.password);
    if (!match) {
      return res.status(401).json({ ok: false, error: "E-posta veya şifre hatalı." });
    }

    updateLastLogin(user.id);
    const token = signToken(user.id);

    // Kullanıcının kayıtlı favori + ayarlarını da döndür
    const favorites = getFavorites(user.id);
    const settings  = getSettings(user.id);
    const history   = getHistory(user.id, 50);
    const stats     = getUserStats(user.id);

    return res.json({
      ok: true,
      token,
      user: safeUser(user),
      favorites,
      settings,
      history,
      stats,
    });
  } catch (e) {
    console.error("[AUTH/LOGIN]", e);
    return res.status(500).json({ ok: false, error: "Giriş işlemi başarısız." });
  }
});

/* ── Ben kimim (token doğrulama) ────────────────────── */
app.get("/api/auth/me", requireAuth, (req, res) => {
  try {
    const favorites = getFavorites(req.user.id);
    const settings  = getSettings(req.user.id);
    const history   = getHistory(req.user.id, 50);
    const stats     = getUserStats(req.user.id);
    return res.json({
      ok: true,
      user: safeUser(req.user),
      favorites,
      settings,
      history,
      stats,
    });
  } catch (e) {
    console.error("[AUTH/ME]", e);
    return res.status(500).json({ ok: false, error: "Kullanıcı bilgisi alınamadı." });
  }
});

/* ── Profil güncelle ────────────────────────────────── */
app.patch("/api/auth/profile", requireAuth, (req, res) => {
  try {
    const { display_name, avatar_emoji, bio } = req.body ?? {};

    // Bio max 200 karakter
    const safeBio = bio ? String(bio).slice(0, 200) : undefined;
    const safeName = display_name ? String(display_name).slice(0, 50) : undefined;

    const VALID_EMOJIS = ["🎵","🎸","🎷","🎻","🎹","🥁","🎺","🎧","🎤","🎼","📻","🎙️","🌙","☕","🌊","🔥","⭐","💫","🎯","🎉"];
    const safeEmoji = avatar_emoji && VALID_EMOJIS.includes(avatar_emoji) ? avatar_emoji : undefined;

    const updated = updateProfile(req.user.id, {
      display_name : safeName,
      avatar_emoji : safeEmoji,
      bio          : safeBio,
    });
    return res.json({ ok: true, user: safeUser(updated) });
  } catch (e) {
    console.error("[AUTH/PROFILE]", e);
    return res.status(500).json({ ok: false, error: "Profil güncellenemedi." });
  }
});

/* ── Şifre değiştir ────────────────────────────────── */
app.post("/api/auth/change-password", requireAuth, async (req, res) => {
  try {
    const { current_password, new_password } = req.body ?? {};
    if (!current_password || !new_password) {
      return res.status(400).json({ ok: false, error: "Mevcut ve yeni şifre gerekli." });
    }
    if (new_password.length < 6) {
      return res.status(400).json({ ok: false, error: "Yeni şifre en az 6 karakter olmalı." });
    }

    const user  = getUserById(req.user.id);
    const match = await verifyPassword(current_password, user.password);
    if (!match) {
      return res.status(401).json({ ok: false, error: "Mevcut şifre hatalı." });
    }

    const hashed = await hashPassword(new_password);
    updatePassword(req.user.id, hashed);
    return res.json({ ok: true, message: "Şifre başarıyla güncellendi." });
  } catch (e) {
    console.error("[AUTH/CHANGE-PASSWORD]", e);
    return res.status(500).json({ ok: false, error: "Şifre değiştirilemedi." });
  }
});

/* =========================================================
   KULLANICI — favoriler / ayarlar / geçmiş
========================================================= */

/* ── Favorileri getir ───────────────────────────────── */
app.get("/api/user/favorites", requireAuth, (req, res) => {
  try {
    return res.json({ ok: true, favorites: getFavorites(req.user.id) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "Favoriler alınamadı." });
  }
});

/* ── Tüm favorileri senkronize et ──────────────────── */
app.put("/api/user/favorites", requireAuth, (req, res) => {
  try {
    const { favorites } = req.body ?? {};
    if (!Array.isArray(favorites)) {
      return res.status(400).json({ ok: false, error: "favorites dizisi gerekli." });
    }
    setFavorites(req.user.id, favorites.map(String));
    return res.json({ ok: true, favorites: getFavorites(req.user.id) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "Favoriler kaydedilemedi." });
  }
});

/* ── Favori ekle ───────────────────────────────────── */
app.post("/api/user/favorites", requireAuth, (req, res) => {
  try {
    const { station_id } = req.body ?? {};
    if (!station_id) return res.status(400).json({ ok: false, error: "station_id gerekli." });
    addFavorite(req.user.id, String(station_id));
    return res.json({ ok: true, favorites: getFavorites(req.user.id) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "Favori eklenemedi." });
  }
});

/* ── Favori sil ────────────────────────────────────── */
app.delete("/api/user/favorites/:stationId", requireAuth, (req, res) => {
  try {
    removeFavorite(req.user.id, req.params.stationId);
    return res.json({ ok: true, favorites: getFavorites(req.user.id) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "Favori silinemedi." });
  }
});

/* ── Ayarları getir ────────────────────────────────── */
app.get("/api/user/settings", requireAuth, (req, res) => {
  try {
    return res.json({ ok: true, settings: getSettings(req.user.id) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "Ayarlar alınamadı." });
  }
});

/* ── Ayarları kaydet ───────────────────────────────── */
app.put("/api/user/settings", requireAuth, (req, res) => {
  try {
    const { settings } = req.body ?? {};
    if (!settings || typeof settings !== "object") {
      return res.status(400).json({ ok: false, error: "settings nesnesi gerekli." });
    }
    saveSettings(req.user.id, settings);
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "Ayarlar kaydedilemedi." });
  }
});

/* ── Dinleme geçmişini getir ───────────────────────── */
app.get("/api/user/history", requireAuth, (req, res) => {
  try {
    return res.json({ ok: true, history: getHistory(req.user.id, 50) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "Geçmiş alınamadı." });
  }
});

/* ── Geçmişe ekle ──────────────────────────────────── */
app.post("/api/user/history", requireAuth, (req, res) => {
  try {
    const { station_id } = req.body ?? {};
    if (!station_id) return res.status(400).json({ ok: false, error: "station_id gerekli." });
    addHistory(req.user.id, String(station_id));
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "Geçmiş kaydedilemedi." });
  }
});

/* ── Kullanıcı istatistikleri ──────────────────────── */
app.get("/api/user/stats", requireAuth, (req, res) => {
  try {
    return res.json({ ok: true, stats: getUserStats(req.user.id) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "İstatistikler alınamadı." });
  }
});

/* =========================================================
   ERROR HANDLER
========================================================= */

app.use(
  (
    error,
    _req,
    res,
    _next
  ) => {
    console.error(
      "[SERVER ERROR]",
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
          "Gateway sunucu hatası.",
      });
  }
);

/* =========================================================
   START
========================================================= */

/* =========================================================
   GLOBAL HATA YAKALAYICILAR  — sunucunun çökmesini önler
========================================================= */

process.on("unhandledRejection", (reason) => {
  console.error("[UNHANDLED REJECTION]", reason);
});

process.on("uncaughtException", (error) => {
  console.error("[UNCAUGHT EXCEPTION]", error);
  // Fatal değilse devam et — Express hâlâ ayakta
});

/* =========================================================
   START
========================================================= */

app.listen(
  PORT,
  HOST,
  () => {
    console.log("");
    console.log(
      "================================================"
    );
    console.log(
      "      KEYFE KEDER RADYO STREAM GATEWAY"
    );
    console.log(
      "================================================"
    );
    console.log(
      `Local:      http://${HOST}:${PORT}`
    );
    console.log(
      `Health:     http://${HOST}:${PORT}/api/health`
    );
    console.log(
      "HLS:        manifest + segment + key proxy"
    );
    console.log(
      "Relay:      enabled"
    );
    console.log(
      "Transcode:  FFmpeg fallback"
    );
    console.log(
      "Auth:       /api/auth/register|login|me|profile"
    );
    console.log(
      "User API:   /api/user/favorites|settings|history"
    );
    console.log(
      "================================================"
    );
    console.log("");
  }
);