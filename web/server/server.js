"use strict";

/*
 * ============================================================
 * KEYFE KEDER RADYO - STREAM GATEWAY
 * server.js
 *
 * Konum:
 *   /web/server/server.js
 *
 * Destek:
 *   - Abasthan / Docker / Cloud hosting
 *   - Windows
 *   - Local PC
 *   - PORT environment variable
 *   - stations.json
 *   - relay
 *   - FFmpeg transcode
 *   - ICY metadata
 *   - iTunes cover
 *   - station updater
 *
 * ÖNEMLİ:
 * Hosting ortamında:
 *
 *   PORT=22021
 *
 * ise uygulama otomatik olarak:
 *
 *   0.0.0.0:22021
 *
 * üzerinde dinler.
 *
 * Local PC'de PORT verilmezse:
 *
 *   8787
 *
 * kullanılır.
 * ============================================================
 */

const express = require("express");
const cors = require("cors");

const fs = require("fs");
const path = require("path");

const http = require("http");
const https = require("https");

const {
    spawn,
} = require("child_process");


/* ============================================================
   APP
============================================================ */

const app = express();


/* ============================================================
   PORT
============================================================ */

/*
 * Hosting platformunun verdiği PORT her zaman önceliklidir.
 *
 * Abasthan:
 *   PORT=22021
 *
 * Local:
 *   PORT tanımlı değilse 8787.
 */

const rawPort = process.env.PORT;

let PORT = Number(rawPort);

if (!Number.isInteger(PORT) || PORT <= 0 || PORT > 65535) {
    PORT = 8787;
}


/* ============================================================
   PATHS
============================================================ */

/*
 * server.js:
 *
 *   KeyfeKederRadyo-Web/
 *       stations.json
 *       station_updater.py
 *       web/
 *           public/
 *           server/
 *               server.js
 *
 * Bu nedenle repository root:
 *
 *   ../../
 */

const SERVER_DIR = __dirname;

const WEB = path.resolve(
    SERVER_DIR,
    ".."
);

const ROOT = path.resolve(
    WEB,
    ".."
);

const PUBLIC = path.join(
    WEB,
    "public"
);

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
            "PUT",
            "PATCH",
            "DELETE",
            "OPTIONS",
        ],
        allowedHeaders: [
            "Content-Type",
            "Authorization",
            "Range",
            "Icy-MetaData",
        ],
        exposedHeaders: [
            "Content-Length",
            "Content-Range",
            "Accept-Ranges",
            "Content-Type",
        ],
    })
);

app.use(
    express.json({
        limit: "1mb",
    })
);


/* ============================================================
   GLOBAL ERROR PROTECTION
============================================================ */

process.on(
    "uncaughtException",
    (error) => {
        console.error(
            "[FATAL] uncaughtException:",
            error?.stack || error
        );

        /*
         * Burada process.exit kullanmıyoruz.
         * Hosting ortamında gereksiz restart döngüsü
         * oluşmasını engelliyoruz.
         */
    }
);

process.on(
    "unhandledRejection",
    (reason) => {
        console.error(
            "[FATAL] unhandledRejection:",
            reason
        );
    }
);


/* ============================================================
   HELPERS
============================================================ */

function log(...args) {
    console.log(
        new Date().toISOString(),
        ...args
    );
}


/* ------------------------------------------------------------
   URL PARSER
------------------------------------------------------------ */

function parseUrl(raw) {
    try {
        if (
            typeof raw !== "string" ||
            !raw.trim()
        ) {
            return null;
        }

        const url = new URL(
            raw.trim()
        );

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


/* ------------------------------------------------------------
   SAFE NUMBER
------------------------------------------------------------ */

function safeNumber(
    value,
    fallback,
    min,
    max
) {
    const n = Number(value);

    if (!Number.isFinite(n)) {
        return fallback;
    }

    if (
        typeof min === "number" &&
        n < min
    ) {
        return fallback;
    }

    if (
        typeof max === "number" &&
        n > max
    ) {
        return fallback;
    }

    return n;
}


/* ------------------------------------------------------------
   STATION COUNT
------------------------------------------------------------ */

function countStations(file) {
    try {
        if (
            !fs.existsSync(file)
        ) {
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


/* ------------------------------------------------------------
   ENSURE PUBLIC DIRECTORY
------------------------------------------------------------ */

function ensurePublicDirectory() {
    fs.mkdirSync(
        PUBLIC,
        {
            recursive: true,
        }
    );
}


/* ============================================================
   REDIRECT FOLLOWER
============================================================ */

/*
 * http.get / https.get redirectleri otomatik takip etmez.
 *
 * Birçok radyo:
 *
 *   301
 *   302
 *   307
 *   308
 *
 * kullanır.
 */

function requestFollowingRedirects(
    targetUrl,
    headers,
    onResponse,
    onError,
    maxRedirects = 7
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

        currentRequest =
            transport.get(
                urlObj.href,
                {
                    headers: {
                        ...headers,
                        Host: urlObj.host,
                    },

                    timeout: 12000,
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
                                    "Çok fazla redirect."
                                )
                            );

                            return;
                        }

                        redirectCount += 1;

                        let nextUrl;

                        try {
                            nextUrl =
                                new URL(
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

                        if (
                            nextUrl.protocol !==
                                "http:" &&
                            nextUrl.protocol !==
                                "https:"
                        ) {
                            onError(
                                new Error(
                                    "Redirect protokolü desteklenmiyor."
                                )
                            );

                            return;
                        }

                        makeRequest(
                            nextUrl
                        );

                        return;
                    }

                    onResponse(
                        upstream,
                        urlObj
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

        currentRequest.on(
            "timeout",
            () => {
                try {
                    currentRequest.destroy(
                        new Error(
                            "Upstream timeout."
                        )
                    );
                } catch {}

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
   HEALTH
============================================================ */

app.get(
    "/api/health",
    (_req, res) => {
        res.status(200).json({
            ok: true,

            service:
                "keyfe-keder-radyo-gateway",

            version:
                "5.0.0",

            status:
                "online",

            port:
                PORT,

            portFromEnvironment:
                rawPort || null,

            host:
                "0.0.0.0",

            environment:
                process.env.NODE_ENV ||
                "production",

            node:
                process.version,

            platform:
                process.platform,

            uptime:
                Math.round(
                    process.uptime()
                ),

            paths: {
                root:
                    ROOT,

                web:
                    WEB,

                public:
                    PUBLIC,

                server:
                    SERVER_DIR,
            },

            files: {
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
            },

            stations: {
                rootCount:
                    countStations(
                        ROOT_STATIONS
                    ),

                publicCount:
                    countStations(
                        PUBLIC_STATIONS
                    ),
            },

            features: {
                relay: true,
                transcode: true,
                metadata: true,
                cover: true,
                updater:
                    fs.existsSync(
                        UPDATER
                    ),
            },
        });
    }
);


/* ============================================================
   ROOT
============================================================ */

app.get(
    "/",
    (_req, res) => {
        res.status(200).json({
            ok: true,

            service:
                "Keyfe Keder Radyo Gateway",

            version:
                "5.0.0",

            status:
                "online",

            health:
                "/api/health",

            endpoints: [
                "/api/health",
                "/api/check?url=",
                "/api/relay?url=",
                "/api/transcode?url=",
                "/api/metadata?url=",
                "/api/cover?artist=&title=",
                "/api/update-stations",
            ],
        });
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
                        "Geçerli HTTP/HTTPS URL gerekli.",
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

            clearTimeout(
                timeout
            );

            try {
                request?.destroy();
            } catch {}

            if (!res.headersSent) {
                res.json(
                    payload
                );
            }
        };

        const timeout =
            setTimeout(
                () => {
                    finish({
                        success: false,

                        statusCode:
                            504,

                        latency:
                            Date.now() -
                            start,

                        message:
                            "Yayın zaman aşımı.",
                    });
                },
                7000
            );

        request =
            requestFollowingRedirects(
                target,

                {
                    "User-Agent":
                        "Keyfe-Keder-Radyo/5.0",

                    Accept:
                        "*/*",

                    "Icy-MetaData":
                        "1",

                    Range:
                        "bytes=0-4096",

                    Connection:
                        "close",
                },

                (
                    upstream,
                    finalUrl
                ) => {
                    const status =
                        upstream.statusCode ||
                        0;

                    const payload = {
                        success:
                            status >=
                                200 &&
                            status <
                                300,

                        statusCode:
                            status,

                        latency:
                            Date.now() -
                            start,

                        contentType:
                            upstream
                                .headers[
                                "content-type"
                            ] || "",

                        icyMetaInt:
                            upstream
                                .headers[
                                "icy-metaint"
                            ] || null,

                        finalUrl:
                            finalUrl.href,
                    };

                    upstream.resume();

                    finish(
                        payload
                    );
                },

                (error) => {
                    finish({
                        success: false,

                        statusCode:
                            502,

                        latency:
                            Date.now() -
                            start,

                        message:
                            error?.message ||
                            "Upstream bağlantı hatası.",
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
                .send(
                    "Bad URL"
                );
        }

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
            "Content-Type, Content-Length, Accept-Ranges, Content-Range"
        );

        res.setHeader(
            "Cache-Control",
            "no-cache, no-store, must-revalidate"
        );

        let request = null;

        let upstreamStream = null;

        let closed = false;

        request =
            requestFollowingRedirects(
                target,

                {
                    "User-Agent":
                        "Keyfe-Keder-Radyo/5.0",

                    Accept:
                        "*/*",

                    "Icy-MetaData":
                        "1",

                    Connection:
                        "keep-alive",
                },

                (
                    upstream,
                    finalUrl
                ) => {
                    if (closed) {
                        upstream.destroy();
                        return;
                    }

                    upstreamStream =
                        upstream;

                    res.statusCode =
                        upstream.statusCode ||
                        200;

                    /*
                     * Content-Type
                     */

                    if (
                        upstream
                            .headers[
                            "content-type"
                        ]
                    ) {
                        res.setHeader(
                            "Content-Type",
                            upstream
                                .headers[
                                "content-type"
                            ]
                        );
                    } else {
                        res.setHeader(
                            "Content-Type",
                            "audio/mpeg"
                        );
                    }

                    /*
                     * ICY headers
                     */

                    const icyHeaders = [
                        "icy-br",
                        "icy-genre",
                        "icy-name",
                        "icy-url",
                        "icy-metaint",
                    ];

                    for (
                        const header of
                        icyHeaders
                    ) {
                        const value =
                            upstream
                                .headers[
                                header
                                ];

                        if (
                            value !==
                                undefined &&
                            value !==
                                null
                        ) {
                            try {
                                res.setHeader(
                                    header,
                                    String(
                                        value
                                    )
                                );
                            } catch {}
                        }
                    }

                    /*
                     * Content-Length
                     */

                    if (
                        upstream
                            .headers[
                            "content-length"
                        ]
                    ) {
                        res.setHeader(
                            "Content-Length",
                            upstream
                                .headers[
                                "content-length"
                            ]
                        );
                    }

                    /*
                     * Accept-Ranges
                     */

                    if (
                        upstream
                            .headers[
                            "accept-ranges"
                        ]
                    ) {
                        res.setHeader(
                            "Accept-Ranges",
                            upstream
                                .headers[
                                "accept-ranges"
                            ]
                        );
                    }

                    /*
                     * Final URL debug
                     */

                    try {
                        res.setHeader(
                            "X-Keyfe-Keder-Upstream",
                            finalUrl.hostname
                        );
                    } catch {}

                    upstream.pipe(
                        res
                    );

                    upstream.on(
                        "error",
                        (error) => {
                            log(
                                "[RELAY] upstream:",
                                error.message
                            );

                            try {
                                res.end();
                            } catch {}
                        }
                    );

                    upstream.on(
                        "end",
                        () => {
                            try {
                                if (
                                    !res.writableEnded
                                ) {
                                    res.end();
                                }
                            } catch {}
                        }
                    );
                },

                (error) => {
                    if (
                        closed
                    ) {
                        return;
                    }

                    log(
                        "[RELAY]",
                        error?.message ||
                            error
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

        /*
         * Browser/client bağlantısı kapandı.
         */

        req.on(
            "close",
            () => {
                closed = true;

                try {
                    upstreamStream?.destroy();
                } catch {}

                try {
                    request?.destroy();
                } catch {}
            }
        );

        res.on(
            "close",
            () => {
                closed = true;

                try {
                    upstreamStream?.destroy();
                } catch {}

                try {
                    request?.destroy();
                } catch {}
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
                .send(
                    "Bad URL"
                );
        }

        const ffmpeg =
            process.env.FFMPEG_PATH ||
            "ffmpeg";

        /*
         * Audio response
         */

        res.status(200);

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

        res.setHeader(
            "Access-Control-Allow-Headers",
            "*"
        );

        res.setHeader(
            "Transfer-Encoding",
            "chunked"
        );

        const args = [
            "-hide_banner",

            "-loglevel",
            "warning",

            "-nostdin",

            "-reconnect",
            "1",

            "-reconnect_streamed",
            "1",

            "-reconnect_at_eof",
            "1",

            "-reconnect_delay_max",
            "5",

            "-rw_timeout",
            "15000000",

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
                "[FFMPEG] spawn:",
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

            return;
        }

        let stderr = "";

        child.stderr.on(
            "data",
            (chunk) => {
                stderr +=
                    chunk.toString();

                if (
                    stderr.length >
                    10000
                ) {
                    stderr =
                        stderr.slice(
                            -10000
                        );
                }
            }
        );

        child.stdout.on(
            "error",
            () => {}
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
                    try {
                        res
                            .status(500)
                            .send(
                                "FFmpeg başlatılamadı."
                            );
                    } catch {}
                }
            }
        );

        child.on(
            "close",
            (code) => {
                if (
                    code !== 0 &&
                    code !== null
                ) {
                    log(
                        "[FFMPEG] çıkış:",
                        code,
                        stderr
                    );
                }

                try {
                    if (
                        !res.writableEnded
                    ) {
                        res.end();
                    }
                } catch {}
            }
        );

        const killChild =
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
            };

        req.on(
            "close",
            killChild
        );

        res.on(
            "close",
            killChild
        );
    }
);


/* ============================================================
   METADATA
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

        let request = null;

        let stream = null;

        let finished = false;

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

        const finish =
            (payload) => {
                if (
                    finished
                ) {
                    return;
                }

                finished = true;

                clearTimeout(
                    timeout
                );

                try {
                    stream?.destroy();
                } catch {}

                try {
                    request?.destroy();
                } catch {}

                if (
                    !res.headersSent
                ) {
                    res.json(
                        payload
                    );
                }
            };

        request =
            requestFollowingRedirects(
                target,

                {
                    "User-Agent":
                        "Keyfe-Keder-Radyo/5.0",

                    Accept:
                        "*/*",

                    "Icy-MetaData":
                        "1",
                },

                (
                    upstream
                ) => {
                    stream =
                        upstream;

                    const metaInt =
                        Number(
                            upstream
                                .headers[
                                "icy-metaint"
                                ]
                        );

                    if (
                        !Number.isFinite(
                            metaInt
                        ) ||
                        metaInt <= 0
                    ) {
                        finish({
                            success:
                                false,

                            artist:
                                "",

                            title:
                                "",

                            raw:
                                "",
                        });

                        return;
                    }

                    /*
                     * Metadata parse state
                     */

                    let audioRemaining =
                        metaInt;

                    let metadataLength =
                        null;

                    let metadataRemaining =
                        0;

                    let readingMetadata =
                        false;

                    let buffer =
                        Buffer.alloc(
                            0
                        );

                    upstream.on(
                        "data",
                        (chunk) => {
                            if (
                                finished
                            ) {
                                return;
                            }

                            let offset =
                                0;

                            while (
                                offset <
                                    chunk.length &&
                                !finished
                            ) {
                                /*
                                 * Audio kısmı
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

                                    /*
                                     * Metadata length byte
                                     */

                                    if (
                                        offset >=
                                        chunk.length
                                    ) {
                                        continue;
                                    }

                                    metadataLength =
                                        chunk[
                                            offset
                                        ] *
                                        16;

                                    offset +=
                                        1;

                                    metadataRemaining =
                                        metadataLength;

                                    buffer =
                                        Buffer.alloc(
                                            0
                                        );

                                    readingMetadata =
                                        metadataRemaining >
                                        0;

                                    /*
                                     * Boş metadata
                                     */

                                    if (
                                        !readingMetadata
                                    ) {
                                        audioRemaining =
                                            metaInt;
                                    }
                                }

                                /*
                                 * Metadata kısmı
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

                                    if (
                                        take >
                                        0
                                    ) {
                                        buffer =
                                            Buffer.concat(
                                                [
                                                    buffer,
                                                    chunk.subarray(
                                                        offset,
                                                        offset +
                                                            take
                                                    ),
                                                ]
                                            );

                                        offset +=
                                            take;

                                        metadataRemaining -=
                                            take;
                                    }

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
                                            match &&
                                            match[1]
                                        ) {
                                            const raw =
                                                match[
                                                    1
                                                ].trim();

                                            /*
                                             * Artist / title ayır
                                             */

                                            const separators =
                                                [
                                                    " - ",
                                                    " – ",
                                                    " — ",
                                                    " | ",
                                                    " / ",
                                                    " • ",
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
                                                        (
                                                            parts.shift() ||
                                                            ""
                                                        ).trim();

                                                    title =
                                                        parts
                                                            .join(
                                                                separator
                                                            )
                                                            .trim();

                                                    break;
                                                }
                                            }

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

                    upstream.on(
                        "error",
                        () => {
                            finish({
                                success:
                                    false,

                                artist:
                                    "",

                                title:
                                    "",

                                raw:
                                    "",
                            });
                        }
                    );

                    upstream.on(
                        "end",
                        () => {
                            if (
                                !finished
                            ) {
                                finish({
                                    success:
                                        false,

                                    artist:
                                        "",

                                    title:
                                        "",

                                    raw:
                                        "",
                                });
                            }
                        }
                    );
                },

                () => {
                    finish({
                        success:
                            false,

                        artist:
                            "",

                        title:
                            "",

                        raw:
                            "",
                    });
                }
            );
    }
);


/* ============================================================
   ALBUM COVER
============================================================ */

app.get(
    "/api/cover",
    async (
        req,
        res
    ) => {
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
            [
                artist,
                title,
            ]
                .filter(Boolean)
                .join(" ");

        const url =
            `https://itunes.apple.com/search?term=${encodeURIComponent(
                query
            )}&entity=song&limit=5`;

        const controller =
            new AbortController();

        const timeout =
            setTimeout(
                () => {
                    controller.abort();
                },
                7000
            );

        try {
            const response =
                await fetch(
                    url,
                    {
                        signal:
                            controller.signal,

                        headers: {
                            "User-Agent":
                                "Keyfe-Keder-Radyo/5.0",

                            Accept:
                                "application/json",
                        },
                    }
                );

            if (
                !response.ok
            ) {
                throw new Error(
                    `Cover HTTP ${response.status}`
                );
            }

            const data =
                await response.json();

            const results =
                Array.isArray(
                    data?.results
                )
                    ? data.results
                    : [];

            const result =
                results.find(
                    (item) =>
                        item &&
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
                    Boolean(
                        cover
                    ),

                cover,
            });
        } catch (error) {
            log(
                "[COVER]",
                error?.message ||
                    error
            );

            res.json({
                success: false,

                cover: "",
            });
        } finally {
            clearTimeout(
                timeout
            );
        }
    }
);


/* ============================================================
   STATIONS COPY
============================================================ */

function copyStationsToPublic() {
    if (
        !fs.existsSync(
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

    let parsed;

    try {
        parsed =
            JSON.parse(
                content
            );
    } catch (error) {
        throw new Error(
            `stations.json JSON hatası: ${error.message}`
        );
    }

    if (
        !Array.isArray(
            parsed
        )
    ) {
        throw new Error(
            "stations.json bir array olmalı."
        );
    }

    ensurePublicDirectory();

    const temp =
        `${PUBLIC_STATIONS}.${process.pid}.tmp`;

    fs.writeFileSync(
        temp,
        JSON.stringify(
            parsed,
            null,
            2
        ),
        "utf8"
    );

    /*
     * Windows / Linux uyumlu güvenli replace.
     */

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
        } finally {
            try {
                fs.unlinkSync(
                    temp
                );
            } catch {}
        }
    }

    return parsed.length;
}


/* ============================================================
   UPDATE STATIONS
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
                "[UPDATER] Radyo updater başlıyor..."
            );

            /*
             * Hosting:
             * python3
             *
             * Windows:
             * py
             */

            const command =
                process.platform ===
                "win32"
                    ? "py"
                    : "python3";

            let child;

            try {
                child =
                    spawn(
                        command,
                        [
                            UPDATER,
                        ],
                        {
                            cwd:
                                ROOT,

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
                    success:
                        false,

                    message:
                        error.message,
                });

                return;
            }

            let stdout = "";

            let stderr = "";

            child.stdout.on(
                "data",
                (chunk) => {
                    const value =
                        chunk.toString();

                    stdout +=
                        value;

                    if (
                        stdout.length >
                        20000
                    ) {
                        stdout =
                            stdout.slice(
                                -20000
                            );
                    }

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

                    if (
                        stderr.length >
                        20000
                    ) {
                        stderr =
                            stderr.slice(
                                -20000
                            );
                    }

                    process.stderr.write(
                        `[UPDATER] ${value}`
                    );
                }
            );

            child.on(
                "error",
                (error) => {
                    resolve({
                        success:
                            false,

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
                        code !==
                        0
                    ) {
                        resolve({
                            success:
                                false,

                            message:
                                stderr ||
                                `Updater ${code} ile kapandı.`,

                            code,

                            stdout,

                            stderr,
                        });

                        return;
                    }

                    try {
                        const total =
                            copyStationsToPublic();

                        resolve({
                            success:
                                true,

                            total,

                            stdout,

                            stderr,

                            message:
                                "Radyo listesi güncellendi ve web listesi senkronlandı.",
                        });
                    } catch (error) {
                        resolve({
                            success:
                                false,

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
   UPDATE ENDPOINT
============================================================ */

app.post(
    "/api/update-stations",
    async (
        _req,
        res
    ) => {
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

            return res.json({
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
            return res
                .status(500)
                .json({
                    success:
                        false,

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
                req.path,
        });
    }
);


/* ============================================================
   EXPRESS ERROR HANDLER
============================================================ */

app.use(
    (
        error,
        _req,
        res,
        _next
    ) => {
        console.error(
            "[EXPRESS ERROR]",
            error?.stack ||
                error
        );

        if (
            res.headersSent
        ) {
            return;
        }

        res.status(500).json({
            ok: false,

            error:
                "Internal server error.",
        });
    }
);


/* ============================================================
   START SERVER
============================================================ */

const server =
    app.listen(
        PORT,
        "0.0.0.0",
        () => {
            console.log("");

            console.log(
                "================================================"
            );

            console.log(
                "       KEYFE KEDER RADYO GATEWAY v5"
            );

            console.log(
                "================================================"
            );

            console.log(
                `🚀 LISTENING: 0.0.0.0:${PORT}`
            );

            console.log(
                `🌐 HEALTH:    /api/health`
            );

            console.log(
                `📡 RELAY:     enabled`
            );

            console.log(
                `🎵 METADATA:  ICY`
            );

            console.log(
                `🖼️ COVER:      iTunes`
            );

            console.log(
                `🎚️ TRANSCODE: FFmpeg`
            );

            console.log(
                `🔄 UPDATER:   ${fs.existsSync(UPDATER) ? "available" : "not found"}`
            );

            console.log(
                `📻 ROOT:      ${ROOT_STATIONS}`
            );

            console.log(
                `📻 PUBLIC:    ${PUBLIC_STATIONS}`
            );

            console.log(
                `📻 ROOT COUNT:   ${countStations(ROOT_STATIONS)}`
            );

            console.log(
                `📻 PUBLIC COUNT: ${countStations(PUBLIC_STATIONS)}`
            );

            console.log(
                `🖥️ NODE:       ${process.version}`
            );

            console.log(
                `🌍 ENV:        ${process.env.NODE_ENV || "production"}`
            );

            console.log(
                "================================================"
            );

            console.log("");

            /*
             * Hosting sistemleri için açık sinyal.
             */

            console.log(
                `PORT_READY=${PORT}`
            );

            console.log(
                `HOST_READY=0.0.0.0`
            );
        }
    );


/* ============================================================
   SERVER ERROR
============================================================ */

server.on(
    "error",
    (error) => {
        console.error(
            "[SERVER ERROR]",
            error?.stack ||
                error
        );
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
                "[SERVER] HTTP server kapandı."
            );

            process.exit(
                0
            );
        }
    );

    /*
     * Server kapanmıyorsa maksimum 10 saniye bekle.
     */

    setTimeout(
        () => {
            console.error(
                "[SERVER] Graceful shutdown timeout."
            );

            process.exit(
                0
            );
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


/* ============================================================
   STARTUP DEBUG
============================================================ */

console.log(
    `[BOOT] __dirname: ${SERVER_DIR}`
);

console.log(
    `[BOOT] ROOT: ${ROOT}`
);

console.log(
    `[BOOT] WEB: ${WEB}`
);

console.log(
    `[BOOT] PUBLIC: ${PUBLIC}`
);

console.log(
    `[BOOT] PORT ENV: ${rawPort || "(not set)"}`
);

console.log(
    `[BOOT] FINAL PORT: ${PORT}`
);

console.log(
    `[BOOT] HOST: 0.0.0.0`
);