import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from "react";
import {
  Radio, Home, Heart, Compass, Settings, Search,
  Play, Pause, SkipBack, SkipForward, Volume2, VolumeX,
  Dice5, Timer, RotateCw, X, Sparkles, ChevronRight,
  SlidersHorizontal, RefreshCw, AlertTriangle, CheckCircle2,
  Activity, LoaderCircle, Menu, ExternalLink, History,
  Maximize2, Minimize2, MonitorSpeaker, Wifi, Clock, Trash2,
} from "lucide-react";

/* ═══════════════════════════════════════════════════════════
   CONSTANTS
═══════════════════════════════════════════════════════════ */
const APP_NAME    = "Keyfe Keder Radyo";
const APP_VERSION = "7.2.0";
const RADIO_API   = "https://de1.api.radio-browser.info/json/stations/search";

const STORAGE = {
  favorites : "kkr-favorites",
  history   : "kkr-history",
  settings  : "kkr-settings",
};

const ACCENTS = {
  blue   : "#5B8CFF",
  purple : "#9B6DFF",
  green  : "#42D392",
  red    : "#FF667D",
  orange : "#FF9D5C",
  cyan   : "#55D6FF",
  pink   : "#FF6EB4",
};

const GENRE_COLORS = {
  "Pop"        : "#5B8CFF",
  "Rock"       : "#FF6B6B",
  "Arabesk"    : "#9B6DFF",
  "Slow"       : "#42D392",
  "Rap"        : "#FF9D5C",
  "Elektronik" : "#55D6FF",
  "Jazz"       : "#F4C87A",
  "Classical"  : "#B8A9FF",
  "Türk Halk"  : "#FF8C69",
  "Türk Sanat" : "#FFB347",
  "90'lar"     : "#FF69B4",
  "80'ler"     : "#DA70D6",
  "Oldies"     : "#98FB98",
  "Lounge"     : "#87CEEB",
  "Disco"      : "#FF00FF",
  "Diğer"      : "#7090B0",
};

const GENRE_ICONS = {
  "Pop"        : "🎵",
  "Rock"       : "🎸",
  "Arabesk"    : "💔",
  "Slow"       : "🌙",
  "Rap"        : "🎧",
  "Elektronik" : "⚡",
  "Jazz"       : "🎷",
  "Classical"  : "🎻",
  "Türk Halk"  : "🪘",
  "Türk Sanat" : "🎼",
  "90'lar"     : "📼",
  "80'ler"     : "🕹️",
  "Lounge"     : "☕",
  "Disco"      : "🪩",
  "Oldies"     : "🎙️",
  "Diğer"      : "📻",
};

const DEFAULT_SETTINGS = {
  accent          : "blue",
  volume          : 72,
  notifications   : true,
  spectrum        : true,
  autoRefresh     : true,
  autoUpdateNotif : true,
  showGenreBadge  : true,
  cardStyle       : "gradient",
  listDensity     : "normal",
  autoPlay        : false,
  sleepMinutes    : 0,
  equalizer       : "flat",
};

const CATEGORY_PRESETS = [
  { icon:"🎵", label:"Pop",        tag:"pop"        },
  { icon:"🎸", label:"Rock",       tag:"rock"       },
  { icon:"💔", label:"Arabesk",    tag:"arabesk"    },
  { icon:"🌙", label:"Slow",       tag:"slow"       },
  { icon:"🎧", label:"Rap",        tag:"rap"        },
  { icon:"⚡", label:"Elektronik", tag:"electronic" },
];

const GENRE_TAGS = [
  "pop","rock","arabesk","slow","rap","electronic","jazz","classical",
  "türk halk","türk sanat",
];

const SUBTITLES = [
  "Bugün ne dinlesem?","Modumuzu yükseltelim!",
  "Kulağına güzel bir şeyler koyalım.","Hayat müziksiz olmaz.",
  "Bir radyo seç, bırak aksın.","Kafayı takma, müziği aç.",
  "Bugünkü soundtrack hazır mı?","Ritme bin, gitsin.",
  "Duygu ne ise, radyo da o.","Keyfine bak, gerisini biz hallederiz.",
];

const EQ_PRESETS = {
  flat   : { label:"Düz",       desc:"Doğal ses"              },
  bass   : { label:"Bas Güçlü", desc:"Derin bas, güçlü ritim" },
  treble : { label:"Tiz Güçlü", desc:"Berrak, parlak ses"     },
  vocal  : { label:"Vokal",     desc:"Ses odaklı, net konuşma"},
};

/* ═══════════════════════════════════════════════════════════
   STORAGE
═══════════════════════════════════════════════════════════ */
function readStorage(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}
function writeStorage(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

/* ═══════════════════════════════════════════════════════════
   STATION HELPERS
═══════════════════════════════════════════════════════════ */
function stationId(s) {
  return String(s?.stationuuid || s?.url_resolved || s?.url || s?.name || "");
}

function normalizeStation(raw) {
  if (!raw || typeof raw !== "object") return null;
  const stream = String(raw.url_resolved || raw.url || raw.stream || "").trim();
  if (!raw.name || !/^https?:\/\//i.test(stream)) return null;
  const tags  = String(raw.tags || "").split(",").map(t => t.trim()).filter(Boolean);
  const genre = tags[0] || raw.genre || "Diğer";
  return {
    ...raw,
    stationuuid : raw.stationuuid || stationId(raw),
    stream,
    genre,
    tags,
    favicon     : null,
    logo        : null,
    favicon_url : null,
    color       : GENRE_COLORS[genre] ?? GENRE_COLORS["Diğer"],
  };
}

function normalizeStations(data) {
  if (!Array.isArray(data)) return [];
  const seen = new Map();
  for (const raw of data) {
    const s  = normalizeStation(raw);
    if (!s) continue;
    const id = stationId(s);
    if (id && !seen.has(id)) seen.set(id, s);
  }
  return Array.from(seen.values());
}

/* ═══════════════════════════════════════════════════════════
   FETCH
═══════════════════════════════════════════════════════════ */
async function fetchWithTimeout(url, opts = {}, ms = 20000) {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, {
      ...opts,
      signal : ctrl.signal,
      cache  : opts.cache || "no-store",
    });
  } finally {
    clearTimeout(tid);
  }
}

async function fetchStations({ name = "", tag = "" } = {}) {
  const p = new URLSearchParams({
    limit:"100", hidebroken:"true", order:"clickcount", reverse:"true",
  });
  if (name) p.set("name", name);
  if (tag)  p.set("tag",  tag);
  const res = await fetchWithTimeout(`${RADIO_API}?${p}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`RadioBrowser: ${res.status}`);
  return normalizeStations(await res.json());
}

/* ═══════════════════════════════════════════════════════════
   UTILS
═══════════════════════════════════════════════════════════ */
function getGreeting() {
  const h = new Date().getHours();
  if (h >= 5  && h < 12) return "Günaydın ☀️";
  if (h >= 12 && h < 17) return "İyi günler 🎵";
  if (h >= 17 && h < 21) return "İyi akşamlar 🌆";
  return "İyi geceler 🌙";
}

function fmtSecs(val) {
  const s = Math.max(0, Number(val) || 0);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

function fmtDate(val) {
  if (!val) return "--";
  try {
    const d = new Date(val);
    if (isNaN(d.getTime())) return String(val);
    return d.toLocaleString("tr-TR", {
      day:"2-digit", month:"2-digit", year:"numeric",
      hour:"2-digit", minute:"2-digit",
    });
  } catch {
    return String(val);
  }
}

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m
    ? `${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)}`
    : "91,140,255";
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ═══════════════════════════════════════════════════════════
   WEB AUDIO  — app-level singleton
   Tek AudioContext + tek MediaElementSource.
   Hem beat analizi hem canvas visualizer bu node'u paylaşır.
═══════════════════════════════════════════════════════════ */
class AudioEngine {
  constructor() {
    this._ctx      = null;   // AudioContext
    this._src      = null;   // MediaElementSourceNode
    this._beat     = null;   // AnalyserNode (beat/glow)
    this._vis      = null;   // AnalyserNode (canvas)
    this._linked   = false;  // source bağlandı mı
  }

  _ensureCtx() {
    if (!this._ctx) {
      this._ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return this._ctx;
  }

  /** audioElement'i sisteme bağla (bir kez çağrılır). */
  link(audioEl) {
    if (this._linked || !audioEl) return;
    try {
      const ctx   = this._ensureCtx();
      this._src   = ctx.createMediaElementSource(audioEl);
      this._beat  = ctx.createAnalyser();
      this._vis   = ctx.createAnalyser();
      this._beat.fftSize = 32;
      this._vis.fftSize  = 64;
      this._src.connect(this._beat);
      this._src.connect(this._vis);
      this._beat.connect(ctx.destination);
      this._linked = true;
    } catch (e) {
      console.warn("[AudioEngine] link hatası:", e);
    }
  }

  /** Beat analizi (düşük frekanslı, hızlı). */
  getBeatLevel() {
    if (!this._beat) return 0;
    const buf = new Uint8Array(this._beat.frequencyBinCount);
    this._beat.getByteFrequencyData(buf);
    const avg = (buf[0] + buf[1] + buf[2] + buf[3]) / 4;
    return avg / 255;
  }

  /** Canvas için ham analyser node'u. */
  get visAnalyser() { return this._vis; }

  /** AudioContext'i suspend/resume et. */
  async resume() {
    try {
      const ctx = this._ensureCtx();
      if (ctx.state === "suspended") {
        await ctx.resume();
      }
    } catch (e) {
      console.warn("[AudioEngine] resume hatası:", e);
    }
  }
}

/* Tek global instance */
const audioEngine = new AudioEngine();

/* ═══════════════════════════════════════════════════════════
   SPLASH
═══════════════════════════════════════════════════════════ */
function SplashScreen({ progress, status, onDone }) {
  const [out, setOut] = useState(false);
  useEffect(() => {
    if (progress < 100) return;
    const t = setTimeout(() => {
      setOut(true);
      setTimeout(onDone, 600);
    }, 400);
    return () => clearTimeout(t);
  }, [progress, onDone]);

  return (
    <div className={`splash${out ? " fade-out" : ""}`}>
      <div className="splash-logo"><Radio size={40} /></div>
      <div className="splash-title">
        <strong>{APP_NAME}</strong>
        <span>Radyo dünyasına hoş geldin</span>
      </div>
      <div className="splash-progress">
        <div className="splash-bar-track">
          <div className="splash-bar-fill" style={{ width: `${progress}%` }} />
        </div>
        <div className="splash-status">
          <span>{status}</span>
          <strong>%{progress}</strong>
        </div>
      </div>
      <div className="splash-dots"><i /><i /><i /></div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   GENRE AVATAR
═══════════════════════════════════════════════════════════ */
function GenreAvatar({ station, size = "md" }) {
  const genre = station?.genre || "Diğer";
  const color = GENRE_COLORS[genre] ?? "#7090B0";
  const icon  = GENRE_ICONS[genre]  ?? "📻";
  const rgb   = hexToRgb(color);
  return (
    <div
      className={`genre-avatar genre-avatar--${size}`}
      style={{
        background  : `linear-gradient(135deg,rgba(${rgb},.22),rgba(${rgb},.08))`,
        borderColor : `rgba(${rgb},.28)`,
        boxShadow   : `0 4px 16px rgba(${rgb},.18)`,
      }}
    >
      <span className="genre-avatar__icon">{icon}</span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   SPECTRUM  (CSS fallback, AudioContext gerektirmez)
═══════════════════════════════════════════════════════════ */
function Spectrum({ active = false }) {
  return (
    <div className={`spectrum${active ? " active" : ""}`} aria-hidden="true">
      {Array.from({ length: 24 }).map((_, i) => <i key={i} />)}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   CANVAS VISUALIZER  — paylaşılan analyser kullanır
═══════════════════════════════════════════════════════════ */
function AudioVisualizer({ playing, color = "#5B8CFF" }) {
  const canvasRef = useRef(null);
  const rafRef    = useRef(null);

  useEffect(() => {
    const an = audioEngine.visAnalyser;
    if (!playing || !an || !canvasRef.current) {
      cancelAnimationFrame(rafRef.current);
      return;
    }

    const canvas = canvasRef.current;
    const cCtx   = canvas.getContext("2d");
    const buf    = new Uint8Array(an.frequencyBinCount);
    const rgb    = hexToRgb(color);

    function draw() {
      rafRef.current = requestAnimationFrame(draw);
      an.getByteFrequencyData(buf);
      const W = canvas.width;
      const H = canvas.height;
      cCtx.clearRect(0, 0, W, H);
      const bw = (W / buf.length) * 2.2;
      let x = 0;
      for (let i = 0; i < buf.length; i++) {
        const bh    = (buf[i] / 255) * H;
        const alpha = 0.35 + (buf[i] / 255) * 0.65;
        const g = cCtx.createLinearGradient(0, H - bh, 0, H);
        g.addColorStop(0, `rgba(${rgb},${alpha})`);
        g.addColorStop(1, `rgba(${rgb},0.05)`);
        cCtx.fillStyle = g;
        cCtx.beginPath();
        if (cCtx.roundRect) {
          cCtx.roundRect(x, H - bh, Math.max(1, bw - 1), bh, [2, 2, 0, 0]);
        } else {
          cCtx.rect(x, H - bh, Math.max(1, bw - 1), bh);
        }
        cCtx.fill();
        x += bw + 1;
      }
    }

    draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, color]);

  return <canvas ref={canvasRef} className="full-canvas" width={240} height={48} />;
}

/* ═══════════════════════════════════════════════════════════
   FAVORITE BUTTON
═══════════════════════════════════════════════════════════ */
function FavoriteButton({ active, onClick, size = 17 }) {
  const [pop, setPop] = useState(false);
  function handle(e) {
    e.stopPropagation();
    setPop(true);
    setTimeout(() => setPop(false), 500);
    onClick();
  }
  return (
    <button
      type="button"
      className={`favorite-button${active ? " active" : ""}${pop ? " favorite-pop" : ""}`}
      onClick={handle}
      title={active ? "Favorilerden çıkar" : "Favorilere ekle"}
    >
      <Heart size={size} fill={active ? "currentColor" : "none"} />
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════
   STATION CARD
═══════════════════════════════════════════════════════════ */
function StationCard({ station, active, favorite, updateLocked, compact, onPlay, onFavorite }) {
  const genre = station?.genre || "Diğer";
  const color = GENRE_COLORS[genre] ?? "#7090B0";
  const rgb   = hexToRgb(color);
  return (
    <article
      className={`station-card${active ? " active" : ""}${updateLocked ? " update-locked" : ""}${compact ? " compact" : ""}`}
      style={{ "--sc": color, "--sc-rgb": rgb }}
    >
      <button
        type="button"
        className="station-main"
        onClick={updateLocked ? undefined : onPlay}
        disabled={updateLocked}
      >
        <GenreAvatar station={station} size={compact ? "sm" : "md"} />
        <div className="station-copy">
          <div className="station-name">{station.name || "Radyo"}</div>
          <div className="station-subline">
            <span
              className="station-genre-tag"
              style={{ background:`rgba(${rgb},.15)`, color, borderColor:`rgba(${rgb},.3)` }}
            >
              {GENRE_ICONS[genre]} {genre}
            </span>
            {station.bitrate > 0 && <span className="station-bitrate">{station.bitrate}k</span>}
            {station.country  && <span className="station-country">🇹🇷</span>}
            {active && <span className="live-label"><i />CANLI</span>}
          </div>
        </div>
      </button>

      <FavoriteButton active={favorite} onClick={onFavorite} />

      <button
        type="button"
        className="card-play-button"
        style={{ background: color, boxShadow: `0 4px 18px rgba(${rgb},.38)` }}
        onClick={updateLocked ? undefined : onPlay}
        disabled={updateLocked}
        title={active ? "Duraklat" : "Oynat"}
      >
        {active ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
      </button>
    </article>
  );
}

/* ═══════════════════════════════════════════════════════════
   PAGE HEADER
═══════════════════════════════════════════════════════════ */
function PageHeader({ title, subtitle, action }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   SYSTEM STATUS CARD
═══════════════════════════════════════════════════════════ */
function SystemStatusCard({ serviceStatus, radioUpdateStatus, stationsCount, lastStationRefresh }) {
  const allOk    = serviceStatus.gateway && serviceStatus.vite && serviceStatus.updater;
  const updating = radioUpdateStatus?.state === "updating";
  const isErr    = radioUpdateStatus?.state === "error";
  return (
    <div className="system-status-card">
      <div className="system-status-header">
        <div>
          <strong>Sistem Durumu</strong>
          <span>Servisler ve radyo güncelleme</span>
        </div>
        <div className={allOk ? "status-online" : "status-warning"}>
          <i />{allOk ? "Tümü aktif" : "Kontrol ediliyor"}
        </div>
      </div>

      <div className="service-status-grid">
        {[
          { key:"gateway", label:"Gateway",    icon:<Wifi size={14} /> },
          { key:"vite",    label:"Web Server", icon:<MonitorSpeaker size={14} /> },
          { key:"updater", label:"Güncelleme", icon:<RefreshCw size={14} /> },
        ].map(({ key, label, icon }) => (
          <div key={key} className="service-status-item">
            <div className="service-status-dot">
              <i className={serviceStatus[key] ? "online" : "offline"} />
            </div>
            <div>{icon}<span>{label}</span></div>
          </div>
        ))}
      </div>

      <div className={`radio-update-info${isErr ? " update-error" : ""}`}>
        <div>
          <strong>{updating ? "Güncelleniyor..." : isErr ? "Güncelleme başarısız" : "Liste güncel"}</strong>
          <span>{radioUpdateStatus?.message || "Hazırlanıyor..."}</span>
        </div>
        <div className="update-meta">
          <span>{radioUpdateStatus?.total || stationsCount || 0} radyo</span>
          <span>{fmtDate(radioUpdateStatus?.updated_at || lastStationRefresh)}</span>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   NOW PLAYING CARD
═══════════════════════════════════════════════════════════ */
function NowPlayingCard({ station, playing, onOpen }) {
  if (!station) return null;
  const color = GENRE_COLORS[station.genre] ?? "#5B8CFF";
  const rgb   = hexToRgb(color);
  return (
    <div
      className="now-playing-card"
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      style={{ "--np-rgb": rgb }}
    >
      <GenreAvatar station={station} size="lg" />
      <div className="now-playing-info">
        <strong>{station.name}</strong>
        <span>
          <span className="now-playing-badge"><i />ŞU AN ÇALIYOR</span>
          {station.genre}
        </span>
      </div>
      <div className={`now-playing-wave${playing ? " active" : ""}`} aria-hidden="true">
        {Array.from({ length: 8 }).map((_, i) => <i key={i} />)}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   MINI PLAYER  (floating PiP)
═══════════════════════════════════════════════════════════ */
function MiniPlayer({ station, playing, favorite, volume, onPlay, onStop, onPrev, onNext, onFavorite, onVolumeChange, onExpand, onClose }) {
  if (!station) return null;
  const color = GENRE_COLORS[station.genre] ?? "#5B8CFF";
  const rgb   = hexToRgb(color);
  return (
    <div className="mini-player" style={{ "--mp-rgb": rgb, "--mp-color": color }}>
      <div className="mini-player__track">
        <GenreAvatar station={station} size="xs" />
        <div className="mini-player__info">
          <strong>{station.name}</strong>
          <span>{station.genre}</span>
        </div>
      </div>

      <div className="mini-player__controls">
        <button type="button" className="mp-btn" onClick={onPrev} title="Önceki">
          <SkipBack size={14} />
        </button>
        <button type="button" className="mp-btn mp-btn--play" onClick={playing ? onStop : onPlay}>
          {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
        </button>
        <button type="button" className="mp-btn" onClick={onNext} title="Sonraki">
          <SkipForward size={14} />
        </button>
        <FavoriteButton active={favorite} onClick={onFavorite} size={14} />
      </div>

      <div className="mini-player__volume">
        {volume > 0 ? <Volume2 size={13} /> : <VolumeX size={13} />}
        <input
          type="range" min="0" max="100" value={volume}
          onChange={e => onVolumeChange(Number(e.target.value))}
          aria-label="Ses seviyesi"
        />
      </div>

      <div className="mini-player__actions">
        <button type="button" className="mp-btn" onClick={onExpand} title="Büyüt">
          <Maximize2 size={13} />
        </button>
        <button type="button" className="mp-btn" onClick={onClose} title="Kapat">
          <X size={13} />
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   FULL PLAYER MODAL
═══════════════════════════════════════════════════════════ */
function FullPlayer({ station, playing, favorite, volume, accent, onPlay, onStop, onPrev, onNext, onFavorite, onVolumeChange, onClose }) {
  useEffect(() => {
    const fn = e => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", fn);
    return () => document.removeEventListener("keydown", fn);
  }, [onClose]);

  const color = GENRE_COLORS[station?.genre] ?? accent;
  const rgb   = hexToRgb(color);

  return (
    <div
      className="full-player-overlay"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="full-player-card" style={{ "--fp-rgb": rgb, "--fp-color": color }}>
        <button type="button" className="full-close" onClick={onClose} aria-label="Kapat">
          <X size={18} />
        </button>

        <div className="full-now-label">ŞU AN ÇALIYOR</div>

        <div className="full-cover">
          <div className="full-cover-ring" />
          <div className="full-cover-ring-2" />
          <div className="full-cover-img">
            <span style={{ fontSize: 72 }}>{GENRE_ICONS[station?.genre] ?? "📻"}</span>
          </div>
        </div>

        <div className="full-info">
          <strong>{station?.name}</strong>
          <span>{station?.genre}{station?.country ? ` · ${station.country}` : ""}</span>
        </div>

        {/* Paylaşılan analyser'ı kullanan canvas — audioRef gerekmiyor */}
        <AudioVisualizer playing={playing} color={color} />

        <div className="full-controls">
          <button type="button" className="full-btn" onClick={onPrev}><SkipBack size={22} /></button>
          <button type="button" className="full-play-btn" onClick={playing ? onStop : onPlay}>
            {playing ? <Pause size={28} fill="currentColor" /> : <Play size={28} fill="currentColor" />}
          </button>
          <button type="button" className="full-btn" onClick={onNext}><SkipForward size={22} /></button>
          <button
            type="button"
            className={`full-fav-btn${favorite ? " active" : ""}`}
            onClick={onFavorite}
          >
            <Heart size={22} fill={favorite ? "currentColor" : "none"} />
          </button>
        </div>

        <div className="full-volume">
          <span className="full-volume-icon">
            {volume > 0 ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </span>
          <input
            type="range" min="0" max="100" value={volume}
            onChange={e => onVolumeChange(Number(e.target.value))}
            aria-label="Ses seviyesi"
          />
          <span className="full-volume-val">%{volume}</span>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   HISTORY ITEM
═══════════════════════════════════════════════════════════ */
function HistoryItem({ station, active, onPlay }) {
  return (
    <div
      className="history-item"
      onClick={onPlay}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPlay(); } }}
    >
      <GenreAvatar station={station} size="sm" />
      <div style={{ minWidth: 0, flex: 1 }}>
        <strong>{station.name}</strong>
        <span>{station.genre}{station.country ? ` · ${station.country}` : ""}</span>
      </div>
      {active && <span className="live-label"><i />CANLI</span>}
      <button
        type="button"
        className="history-play"
        onClick={e => { e.stopPropagation(); onPlay(); }}
        aria-label={active ? "Duraklat" : "Oynat"}
      >
        {active ? <Pause size={15} /> : <Play size={15} />}
      </button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   SETTING ROW HELPERS
═══════════════════════════════════════════════════════════ */
function SettingRow({ label, desc, children }) {
  return (
    <div className="setting-row">
      <div>
        <strong>{label}</strong>
        {desc && <span>{desc}</span>}
      </div>
      {children}
    </div>
  );
}

function ToggleBtn({ on, onToggle }) {
  return (
    <button type="button" className={`toggle${on ? " on" : ""}`} onClick={onToggle} role="switch" aria-checked={on}>
      <i />
    </button>
  );
}

function SegmentedControl({ options, value, onChange }) {
  return (
    <div className="segmented-control">
      {options.map(opt => (
        <button
          key={opt.value}
          type="button"
          className={value === opt.value ? "active" : ""}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   APP
═══════════════════════════════════════════════════════════ */
export default function App() {
  const audioRef    = useRef(null);
  const subtitleRef = useRef(null);

  /* --- Splash --- */
  const [splashVisible,  setSplashVisible]  = useState(true);
  const [splashProgress, setSplashProgress] = useState(0);
  const [splashStatus,   setSplashStatus]   = useState("Başlatılıyor...");

  /* --- Nav --- */
  const [page,        setPage]        = useState("home");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  /* --- Radio --- */
  const [stations,       setStations]       = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [error,          setError]          = useState("");
  const [currentStation, setCurrentStation] = useState(null);
  const [playing,        setPlaying]        = useState(false);

  /* --- Search --- */
  const [query,         setQuery]         = useState("");
  const [selectedGenre, setSelectedGenre] = useState("");

  /* --- Persisted --- */
  const [favorites, setFavorites] = useState(() => readStorage(STORAGE.favorites, []));
  const [history,   setHistory]   = useState(() => readStorage(STORAGE.history,   []));
  const [settings,  setSettings]  = useState(() => {
    const saved = readStorage(STORAGE.settings, {});
    // Güvenlik: sleepMinutes localStorage'dan geliyorsa sıfırla
    // (kapatılmadan önce zamanlayıcı aktifken crash olmuş olabilir)
    return { ...DEFAULT_SETTINGS, ...saved, sleepMinutes: 0 };
  });

  /* --- Sleep (hesaplanmış, kalıcı değil) --- */
  const [sleepSeconds, setSleepSeconds] = useState(0);

  /* --- Audio error --- */
  const [audioError, setAudioError] = useState("");
  
  /* --- Auto recovery --- */
  const recoveryAttemptRef = useRef(0);
  const recoveryTimerRef = useRef(null);

  /* --- Services --- */
  const [serviceStatus,     setServiceStatus]     = useState({ gateway:false, vite:false, updater:false });
  const [radioUpdateStatus, setRadioUpdateStatus] = useState(null);

  /* --- UI --- */
  const [manualUpdating,     setManualUpdating]     = useState(false);
  const [lastStationRefresh, setLastStationRefresh] = useState(null);
  const [toast,              setToast]              = useState(null);
  const [isMobile,           setIsMobile]           = useState(() => window.innerWidth <= 920);
  const [showFullPlayer,     setShowFullPlayer]     = useState(false);
  const [showMiniPlayer,     setShowMiniPlayer]     = useState(false);

  /* --- Beat (ritim efektleri) --- */
  const [beatScale, setBeatScale] = useState(0);
  const [beatGlow,  setBeatGlow]  = useState(0);
  const beatRafRef  = useRef(null);

  const accent    = ACCENTS[settings.accent] ?? ACCENTS.blue;
  const accentRgb = hexToRgb(accent);

  /* Subtitle — bir kez seç */
  useEffect(() => {
    if (!subtitleRef.current) {
      subtitleRef.current = SUBTITLES[Math.floor(Math.random() * SUBTITLES.length)];
    }
  }, []);
  const subtitle = subtitleRef.current ?? SUBTITLES[0];

  /* --- Toast helper --- */
  const showToast = useCallback((title, message, type = "info") => {
    const id = Date.now();
    setToast({ id, title, message, type });
    setTimeout(() => setToast(c => (c?.id === id ? null : c)), 4500);
  }, []);

  /* ─────────────────────────────────────────────────────
     SPLASH BOOT
  ───────────────────────────────────────────────────── */
  useEffect(() => {
    let cancelled = false;

    async function boot() {
      setSplashStatus("Yerel liste kontrol ediliyor...");
      setSplashProgress(20);
      await delay(300);
      if (cancelled) return;

      let local = [];
      try {
        const r = await fetch(`/stations.json?ts=${Date.now()}`, { cache: "no-store" });
        if (r.ok) local = normalizeStations(await r.json());
      } catch {}
      if (cancelled) return;

      setSplashStatus("Radio Browser'dan güncelleniyor...");
      setSplashProgress(55);
      let remote = [];
      try { remote = await fetchStations(); } catch {}
      if (cancelled) return;

      setSplashStatus("Türk radyolar filtreleniyor...");
      setSplashProgress(80);
      await delay(200);
      if (cancelled) return;

      const merged = remote.length > 0 ? remote : local;
      if (merged.length > 0) {
        setStations(merged);
        setLastStationRefresh(new Date());
        // settings.notifications o anki değeri closure'da yakalanır
        // ama bu boot sadece bir kez çalışır, stale closure riski önemsiz
        if (settings.notifications) {
          showToast("Radyolar güncellendi 🎵", `${merged.length} istasyon hazır.`, "success");
        }
      }
      setLoading(false);
      setError(merged.length === 0 ? "Radyo listesi alınamadı." : "");
      setSplashStatus("Hazır!");
      setSplashProgress(100);
    }

    boot();
    return () => { cancelled = true; };
    // İlk mount'ta bir kez çalışır. showToast ve settings.notifications kasıtlı olarak
    // dependency listesine alınmadı — boot tek seferlik bir işlemdir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ─────────────────────────────────────────────────────
     LOCAL REFRESH  (30s)
  ───────────────────────────────────────────────────── */
  useEffect(() => {
    if (!settings.autoRefresh || splashVisible) return;
    let alive = true;
    async function poll() {
      try {
        const r = await fetch(`/stations.json?ts=${Date.now()}`, { cache: "no-store" });
        if (!r.ok) return;
        const norm = normalizeStations(await r.json());
        if (!alive || !norm.length) return;
        setStations(prev => {
          const a = prev.map(stationId).join("|");
          const b = norm.map(stationId).join("|");
          return a === b ? prev : norm;
        });
        setLastStationRefresh(new Date());
      } catch {}
    }
    poll();
    const t = setInterval(poll, 30000);
    return () => { alive = false; clearInterval(t); };
  }, [settings.autoRefresh, splashVisible]);

  /* ─────────────────────────────────────────────────────
     SERVICE STATUS  (5s)
  ───────────────────────────────────────────────────── */
  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const r = await fetch(`/service_status.json?ts=${Date.now()}`, { cache: "no-store" });
        if (!r.ok) return;
        const d = await r.json();
        if (alive) {
          setServiceStatus({
            gateway : Boolean(d.gateway),
            vite    : Boolean(d.vite),
            updater : Boolean(d.updater),
          });
        }
      } catch {}
    }
    poll();
    const t = setInterval(poll, 5000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  /* ─────────────────────────────────────────────────────
     UPDATE STATUS  (5s)
  ───────────────────────────────────────────────────── */
  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const r = await fetch(`/station_update_status.json?ts=${Date.now()}`, { cache: "no-store" });
        if (!r.ok) return;
        const d = await r.json();
        if (alive) setRadioUpdateStatus(d);
      } catch {}
    }
    poll();
    const t = setInterval(poll, 5000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  /* ─────────────────────────────────────────────────────
     UPDATE NOTIFICATIONS
  ───────────────────────────────────────────────────── */
  const prevStateRef = useRef(null);
  const prevTsRef    = useRef(null);
  useEffect(() => {
    if (!settings.notifications || !settings.autoUpdateNotif) return;
    const st = radioUpdateStatus?.state;
    const ts = radioUpdateStatus?.timestamp;
    if (!st) return;
    const sc = st !== prevStateRef.current;
    const tc = ts !== prevTsRef.current;
    if (!sc && !tc) return;
    prevStateRef.current = st;
    prevTsRef.current    = ts;
    if (st === "updating")       showToast("Güncelleniyor", "İstasyon listesi yenileniyor.", "update");
    if (st === "ready"  && sc)   showToast("Hazır", radioUpdateStatus.message || "Yeni liste aktif.", "success");
    if (st === "error"  && sc)   showToast("Hata",  radioUpdateStatus.message || "Mevcut liste korunuyor.", "error");
  }, [radioUpdateStatus, settings.notifications, settings.autoUpdateNotif, showToast]);

  /* ─────────────────────────────────────────────────────
     CSS VARIABLES
  ───────────────────────────────────────────────────── */
  useEffect(() => {
    const r = document.documentElement;
    r.style.setProperty("--accent",       accent);
    r.style.setProperty("--accent-rgb",   accentRgb);
    r.style.setProperty("--player-color", accent);
    r.style.setProperty("--range-value",
      `${Math.min(100, Math.max(0, Number(settings.volume)))}%`);
    r.style.setProperty("--beat-scale", String(beatScale));
    r.style.setProperty("--beat-glow",  String(beatGlow));
  }, [accent, accentRgb, settings.volume, beatScale, beatGlow]);

  /* ─────────────────────────────────────────────────────
     BEAT LOOP  — AudioEngine'in analyser'ını kullanır
     AudioContext / MediaElementSource BURADA yaratılmaz.
     audioEngine.link() sadece ilk audio play'de çağrılır.
  ───────────────────────────────────────────────────── */
  useEffect(() => {
    if (!playing) {
      cancelAnimationFrame(beatRafRef.current);
      setBeatScale(0);
      setBeatGlow(0);
      return;
    }

    function tick() {
      beatRafRef.current = requestAnimationFrame(tick);
      const level = audioEngine.getBeatLevel();
      setBeatScale(level);
      setBeatGlow(level);
    }
    tick();
    return () => cancelAnimationFrame(beatRafRef.current);
  }, [playing]);

  /* ─────────────────────────────────────────────────────
     PERSIST
  ───────────────────────────────────────────────────── */
  useEffect(() => { writeStorage(STORAGE.favorites, favorites); }, [favorites]);
  useEffect(() => { writeStorage(STORAGE.history,   history);   }, [history]);
  useEffect(() => {
    // sleepMinutes kalıcıya yazılırken sıfırlanmış olmalı —
    // uygulama kapanırken zamanlayıcı aktifse bir sonraki açılışta
    // beklenmedik kapanma olmasın diye sıfırlayarak kaydediyoruz.
    writeStorage(STORAGE.settings, { ...settings, sleepMinutes: 0 });
  }, [settings]);

  /* ─────────────────────────────────────────────────────
     RESPONSIVE
  ───────────────────────────────────────────────────── */
  useEffect(() => {
    const fn = () => setIsMobile(window.innerWidth <= 920);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);

  /* ─────────────────────────────────────────────────────
     BODY SCROLL LOCK
  ───────────────────────────────────────────────────── */
  useEffect(() => {
    document.body.style.overflow = sidebarOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [sidebarOpen]);

  /* ─────────────────────────────────────────────────────
     AUDIO VOLUME
  ───────────────────────────────────────────────────── */
  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.volume = Math.min(100, Math.max(0, Number(settings.volume))) / 100;
  }, [settings.volume]);

  /* ─────────────────────────────────────────────────────
     SLEEP TIMER
  ───────────────────────────────────────────────────── */
  useEffect(() => {
    const mins = settings.sleepMinutes ?? 0;
    if (mins <= 0) { setSleepSeconds(0); return; }
    setSleepSeconds(mins * 60);
    const t = setInterval(() => {
      setSleepSeconds(prev => {
        if (prev <= 1) {
          clearInterval(t);
          // audioRef.current?.pause() — ref'i direkt kullanıyoruz, güvenli
          audioRef.current?.pause();
          setPlaying(false);
          setSettings(p => ({ ...p, sleepMinutes: 0 }));
          showToast("Uyku zamanlayıcısı", "Radyo kapatıldı.", "info");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [settings.sleepMinutes, showToast]);

  /* ─────────────────────────────────────────────────────
     COMPUTED
  ───────────────────────────────────────────────────── */
  const favoriteIds = useMemo(() => new Set(favorites), [favorites]);

  const favoriteStations = useMemo(
    () => stations.filter(s => favoriteIds.has(stationId(s))),
    [stations, favoriteIds],
  );

  const recentStations = useMemo(
    () => history
      .map(id => stations.find(s => stationId(s) === id))
      .filter(Boolean)
      .slice(0, 20),
    [history, stations],
  );

  const filteredStations = useMemo(() => {
    let list = stations;
    if (selectedGenre) {
      const w = selectedGenre.toLocaleLowerCase("tr-TR");
      list = list.filter(s =>
        [s.genre, ...(s.tags ?? [])].some(v =>
          String(v).toLocaleLowerCase("tr-TR").includes(w)
        )
      );
    }
    const q = query.trim().toLocaleLowerCase("tr-TR");
    if (!q) return list;
    return list.filter(s =>
      [s.name, s.country, s.genre, ...(s.tags ?? [])]
        .join(" ")
        .toLocaleLowerCase("tr-TR")
        .includes(q)
    );
  }, [stations, selectedGenre, query]);

  const homeStations = useMemo(() => stations.slice(0, 10), [stations]);
  const updating     = radioUpdateStatus?.state === "updating";
  const compact      = settings.listDensity === "compact";

  /* ─────────────────────────────────────────────────────
     ACTIONS
  ───────────────────────────────────────────────────── */
  const toggleFavorite = useCallback(station => {
    const id = stationId(station);
    if (!id) return;
    setFavorites(prev => {
      if (prev.includes(id)) {
        showToast("Favoriden çıkarıldı", station.name ?? "Radyo", "info");
        return prev.filter(x => x !== id);
      }
      showToast("Favorilere eklendi ❤️", station.name ?? "Radyo", "success");
      return [id, ...prev];
    });
  }, [showToast]);

  /**
   * Tüm hataları yakalar. async olduğu için unhandled rejection olmaz
   * çünkü iç try/catch var ve her çağrı .catch() ile sarılıyor.
   * 
   * İYİLEŞTİRMELER:
   * - Retry mekanizması (2 deneme)
   * - Daha iyi error handling
   * - Audio context'in kesinlikle çalıştığından emin ol
   * - Stream timeout kontrolü
   */
  const playStation = useCallback(async station => {
    if (!station?.stream) return;
    if (!audioRef.current) return;
    if (updating) { showToast("Güncelleniyor", "Lütfen bekle.", "update"); return; }

    const same = currentStation && stationId(currentStation) === stationId(station);
    if (same && playing) {
      audioRef.current.pause();
      setPlaying(false);
      return;
    }

    setAudioError("");
    
    // Retry mekanizması - 2 deneme
    let lastError = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        // Audio element'i temizle ve hazırla
        const audio = audioRef.current;
        audio.pause();
        audio.currentTime = 0;
        
        // Yeni stream'i yükle
        audio.src = station.stream;
        audio.load();
        
        setCurrentStation(station);

        // AudioEngine'e audio element'i bağla (sadece ilk seferinde bağlanır)
        audioEngine.link(audio);
        
        // AudioContext'i kesinlikle başlat
        try {
          await audioEngine.resume();
        } catch (ctxErr) {
          console.warn("[AudioContext]", ctxErr);
        }

        // Yayını başlat - timeout ile
        const playPromise = audio.play();
        
        // 8 saniye timeout - stream açılmazsa hata
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error("STREAM_TIMEOUT")), 8000);
        });

        await Promise.race([playPromise, timeoutPromise]);
        
        // Başarılı! 
        setPlaying(true);
        recoveryAttemptRef.current = 0; // Recovery counter'ı sıfırla
        
        const id = stationId(station);
        setHistory(prev => [id, ...prev.filter(x => x !== id)].slice(0, 20));
        
        // Başarılı olduysa döngüden çık
        return;
        
      } catch (e) {
        lastError = e;
        console.error(`[AUDIO] Deneme ${attempt}/2:`, e);
        
        // İlk denemeyse kısa bekle ve tekrar dene
        if (attempt < 2) {
          await new Promise(resolve => setTimeout(resolve, 500));
          continue;
        }
      }
    }
    
    // Tüm denemeler başarısız
    setPlaying(false);
    
    let msg = "Bu yayın oynatılamadı. Başka bir radyo dene.";
    if (lastError?.name === "NotAllowedError") {
      msg = "Tarayıcı oynatmayı engelledi. Sayfayı tıkladıktan sonra tekrar dene.";
    } else if (lastError?.name === "NotSupportedError") {
      msg = "Bu yayın formatı desteklenmiyor.";
    } else if (lastError?.message === "STREAM_TIMEOUT") {
      msg = "Yayın bağlantısı zaman aşımına uğradı.";
    } else if (lastError?.name === "AbortError") {
      msg = "Yayın yükleme iptal edildi.";
    }
    
    setAudioError(msg);
    showToast("Yayın açılamadı", msg, "error");
  }, [currentStation, playing, updating, showToast]);

  const stopPlayback = useCallback(() => {
    audioRef.current?.pause();
    setPlaying(false);
    // Recovery timer'ı temizle
    if (recoveryTimerRef.current) {
      clearTimeout(recoveryTimerRef.current);
      recoveryTimerRef.current = null;
    }
    recoveryAttemptRef.current = 0;
  }, []);

  /**
   * changeStation — playStation'ı çağırır, Promise'i catch'ler.
   * onClick handler'larından güvenle çağrılabilir.
   */
  const changeStation = useCallback(dir => {
    if (!stations.length) return;
    const idx = currentStation
      ? stations.findIndex(s => stationId(s) === stationId(currentStation))
      : -1;
    const next = stations[(idx + dir + stations.length) % stations.length];
    playStation(next).catch(e => console.error("[CHANGE_STATION]", e));
  }, [stations, currentStation, playStation]);

  function toggleMute() {
    setSettings(p => ({ ...p, volume: Number(p.volume) > 0 ? 0 : 72 }));
  }

  const loadStations = useCallback(async (opts = {}) => {
    try {
      setLoading(true);
      setError("");
      const result = await fetchStations(opts);
      if (!result.length) throw new Error("Boş liste");
      setStations(result);
      setLastStationRefresh(new Date());
      return result;
    } catch (e) {
      console.warn("[LOAD_STATIONS]", e);
      setError("Radyo listesi alınamadı.");
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshStations = useCallback(async () => {
    if (manualUpdating) return;
    setManualUpdating(true);
    showToast("Yenileniyor", "Güncel liste alınıyor...", "update");
    try {
      const r = await loadStations();
      showToast(
        r.length > 0 ? "Yenilendi"   : "Başarısız",
        r.length > 0 ? `${r.length} istasyon hazır.` : "Mevcut liste korunuyor.",
        r.length > 0 ? "success"     : "error",
      );
    } finally {
      setManualUpdating(false);
    }
  }, [manualUpdating, loadStations, showToast]);

  async function discoverGenre(tag) {
    setSelectedGenre(tag);
    setPage("discover");
    setSidebarOpen(false);
    await loadStations({ tag });
  }

  function navigate(target) {
    setPage(target);
    setSidebarOpen(false);
  }

  function playRandom() {
    if (!stations.length) { showToast("Boş", "Liste hazır değil.", "error"); return; }
    playStation(stations[Math.floor(Math.random() * stations.length)])
      .catch(e => console.error("[PLAY_RANDOM]", e));
  }

  function set(key, value) {
    setSettings(p => ({ ...p, [key]: value }));
  }

  /* Nav items */
  const navItems = [
    { id:"home",      label:"Ana Sayfa", icon:Home    },
    { id:"favorites", label:"Favoriler", icon:Heart   },
    { id:"stations",  label:"Radyolar",  icon:Radio   },
    { id:"discover",  label:"Keşfet",    icon:Compass },
    { id:"history",   label:"Geçmiş",    icon:History },
  ];

  /* Shared card renderer */
  function renderCard(s, prefix = "") {
    const sid  = stationId(s);
    const actv = Boolean(playing && currentStation && stationId(currentStation) === sid);
    return (
      <StationCard
        key={prefix + sid}
        station={s}
        active={actv}
        favorite={favoriteIds.has(sid)}
        updateLocked={updating}
        compact={compact}
        onPlay={() => playStation(s).catch(e => console.error("[CARD_PLAY]", e))}
        onFavorite={() => toggleFavorite(s)}
      />
    );
  }

  const favOfCurrent = Boolean(currentStation && favoriteIds.has(stationId(currentStation)));

  /* ═══════════════════════════════════════════════════════
     RENDER
  ═══════════════════════════════════════════════════════ */
  return (
    <>
      {splashVisible && (
        <SplashScreen
          progress={splashProgress}
          status={splashStatus}
          onDone={() => setSplashVisible(false)}
        />
      )}

      <div className="app">
        {/* Audio element — AudioEngine bu ref'i link() ile alır */}
        <audio
          ref={audioRef}
          preload="auto"
          crossOrigin="anonymous"
          onPlay={() => {
            setPlaying(true);
            // Başarılı play - recovery counter'ı sıfırla
            recoveryAttemptRef.current = 0;
            if (recoveryTimerRef.current) {
              clearTimeout(recoveryTimerRef.current);
              recoveryTimerRef.current = null;
            }
          }}
          onPause={() => setPlaying(false)}
          onError={(e) => {
            console.error("[AUDIO_ELEMENT_ERROR]", e);
            setPlaying(false);
            const errMsg = (() => {
              const audio = audioRef.current;
              if (!audio?.error) return "Yayın bağlantısı kullanılamadı.";
              
              switch(audio.error.code) {
                case audio.error.MEDIA_ERR_ABORTED:
                  return "Yayın yüklemesi iptal edildi.";
                case audio.error.MEDIA_ERR_NETWORK:
                  return "Ağ hatası - İnternet bağlantınızı kontrol edin.";
                case audio.error.MEDIA_ERR_DECODE:
                  return "Yayın formatı çözümlenemedi.";
                case audio.error.MEDIA_ERR_SRC_NOT_SUPPORTED:
                  return "Bu yayın formatı desteklenmiyor.";
                default:
                  return "Bilinmeyen yayın hatası.";
              }
            })();
            setAudioError(errMsg);
            
            // Auto-recovery: 3 denemeden azsa yeniden bağlanmayı dene
            if (currentStation && recoveryAttemptRef.current < 3 && audio.error.code === audio.error.MEDIA_ERR_NETWORK) {
              recoveryAttemptRef.current += 1;
              console.warn(`[AUTO_RECOVERY] Deneme ${recoveryAttemptRef.current}/3 - 3 saniye sonra yeniden bağlanılacak`);
              
              if (recoveryTimerRef.current) clearTimeout(recoveryTimerRef.current);
              recoveryTimerRef.current = setTimeout(() => {
                console.log("[AUTO_RECOVERY] Yeniden bağlanılıyor...");
                if (audioRef.current && currentStation) {
                  audioRef.current.load();
                  audioRef.current.play().catch(e => {
                    console.error("[AUTO_RECOVERY] Başarısız:", e);
                  });
                }
              }, 3000);
            } else {
              showToast("Ses hatası", errMsg, "error");
            }
          }}
          onStalled={() => {
            console.warn("[AUDIO_STALLED] Stream takıldı - devam ediliyor");
            // Stalled durumda tarayıcı genelde kendisi halleder, ama yine de load deneyelim
            const audio = audioRef.current;
            if (audio && currentStation) {
              setTimeout(() => {
                if (audio.paused && !audio.ended) {
                  console.log("[AUDIO_STALLED] Manuel load tetikleniyor");
                  audio.load();
                }
              }, 2000);
            }
          }}
          onWaiting={() => {
            console.log("[AUDIO_WAITING] Tamponlanıyor...");
          }}
          onCanPlay={() => {
            console.log("[AUDIO_CAN_PLAY] Yayın hazır");
          }}
          onCanPlayThrough={() => {
            console.log("[AUDIO_CAN_PLAY_THROUGH] Tampon tamamlandı");
          }}
          onSuspend={() => {
            console.log("[AUDIO_SUSPEND] Yükleme askıya alındı");
          }}
          onLoadStart={() => {
            console.log("[AUDIO_LOAD_START] Stream yükleniyor");
          }}
          onLoadedMetadata={() => {
            console.log("[AUDIO_LOADED_METADATA] Metadata yüklendi");
          }}
          onLoadedData={() => {
            console.log("[AUDIO_LOADED_DATA] İlk frame yüklendi");
          }}
        />

        {/* Full Player */}
        {showFullPlayer && currentStation && (
          <FullPlayer
            station={currentStation}
            playing={playing}
            favorite={favOfCurrent}
            volume={settings.volume}
            accent={accent}
            onPlay={() => playStation(currentStation).catch(e => console.error("[FP_PLAY]", e))}
            onStop={stopPlayback}
            onPrev={() => changeStation(-1)}
            onNext={() => changeStation(1)}
            onFavorite={() => toggleFavorite(currentStation)}
            onVolumeChange={v => set("volume", v)}
            onClose={() => setShowFullPlayer(false)}
          />
        )}

        {/* Mini Player */}
        {showMiniPlayer && currentStation && !showFullPlayer && (
          <MiniPlayer
            station={currentStation}
            playing={playing}
            favorite={favOfCurrent}
            volume={settings.volume}
            onPlay={() => playStation(currentStation).catch(e => console.error("[MP_PLAY]", e))}
            onStop={stopPlayback}
            onPrev={() => changeStation(-1)}
            onNext={() => changeStation(1)}
            onFavorite={() => toggleFavorite(currentStation)}
            onVolumeChange={v => set("volume", v)}
            onExpand={() => { setShowMiniPlayer(false); setShowFullPlayer(true); }}
            onClose={() => setShowMiniPlayer(false)}
          />
        )}

        {/* Overlay */}
        <div
          className={`sidebar-overlay${sidebarOpen ? " visible" : ""}`}
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />

        {/* ══════ SIDEBAR ══════ */}
        <aside className={`sidebar${sidebarOpen ? " open" : ""}`} aria-label="Navigasyon menüsü">
          <div className="brand-area">
            <div className="brand-row">
              <div className="brand-icon"><Radio size={20} /></div>
              <div className="brand-text">
                <strong>Keyfe Keder</strong>
                <span>Radyo</span>
              </div>
              <button type="button" className="mobile-close" onClick={() => setSidebarOpen(false)} aria-label="Menüyü kapat">
                <X size={17} />
              </button>
            </div>
            <div className="brand-tagline">Keyfime Kederime göre Radyo</div>
            <div className="live-row">
              <span className="live-status-dot" />
              <span>LIVE</span>
              <small>v{APP_VERSION}</small>
            </div>
          </div>

          <div className="sidebar-divider" />

          <nav className="sidebar-nav" aria-label="Sayfalar">
            {navItems.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                className={page === id ? "active" : ""}
                onClick={() => navigate(id)}
                aria-current={page === id ? "page" : undefined}
              >
                <Icon size={17} />
                <span>{label}</span>
                {id === "favorites" && favoriteStations.length > 0 && (
                  <b>{favoriteStations.length}</b>
                )}
              </button>
            ))}
          </nav>

          <div className="sidebar-bottom">
            <button
              type="button"
              className={page === "settings" ? "active" : ""}
              onClick={() => navigate("settings")}
              aria-current={page === "settings" ? "page" : undefined}
            >
              <Settings size={17} />
              <span>Ayarlar</span>
            </button>
          </div>
        </aside>

        {/* ══════ MAIN ══════ */}
        <main className="main">
          {/* Topbar */}
          <header className="topbar">
            <button
              type="button"
              className="mobile-menu-btn"
              onClick={() => setSidebarOpen(true)}
              aria-label="Menüyü aç"
            >
              <Menu size={20} />
            </button>

            <div className="top-search" role="search">
              <Search size={16} aria-hidden="true" />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Radyo, tür ara..."
                aria-label="Radyo ara"
              />
              {query && (
                <button
                  type="button"
                  className="search-clear"
                  onClick={() => setQuery("")}
                  aria-label="Aramayı temizle"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            <button
              type="button"
              className="top-action"
              onClick={() => { refreshStations().catch(e => console.error("[TOPBAR_REFRESH]", e)); }}
              disabled={manualUpdating}
              title="Radyoları yenile"
              aria-label="Radyoları yenile"
            >
              {manualUpdating
                ? <LoaderCircle size={18} className="spin" />
                : <RotateCw size={18} />}
            </button>
          </header>

          {/* Content */}
          <div className="content">

            {/* ─── HOME ─── */}
            {page === "home" && (
              <div className="page-anim">
                <div className="hero">
                  <div>
                    <div className="eyebrow"><Sparkles size={13} />KEYFE KEDER RADYO</div>
                    <h1>{getGreeting()}</h1>
                    <p>{subtitle}</p>
                  </div>
                  <button type="button" className="random-button" onClick={playRandom}>
                    <Dice5 size={18} />Rastgele
                  </button>
                </div>

                {currentStation && (
                  <NowPlayingCard
                    station={currentStation}
                    playing={playing}
                    onOpen={() => setShowFullPlayer(true)}
                  />
                )}

                {(updating || radioUpdateStatus?.state === "error") && (
                  <div className={`update-banner ${radioUpdateStatus?.state === "error" ? "error" : "updating"}`}>
                    {updating ? <LoaderCircle size={19} className="spin" /> : <AlertTriangle size={19} />}
                    <div>
                      <strong>{updating ? "Radyolar güncelleniyor..." : "Güncelleme başarısız"}</strong>
                      <span>{radioUpdateStatus?.message || "Mevcut liste korunuyor."}</span>
                    </div>
                  </div>
                )}

                <SystemStatusCard
                  serviceStatus={serviceStatus}
                  radioUpdateStatus={radioUpdateStatus}
                  stationsCount={stations.length}
                  lastStationRefresh={lastStationRefresh}
                />

                <div className="section-title-row">
                  <div><h2>Hızlı Keşif</h2><p>Moduna uygun bir radyo seç.</p></div>
                </div>
                <div className="category-grid">
                  {CATEGORY_PRESETS.map(cat => (
                    <button
                      key={cat.tag}
                      type="button"
                      className="category-card"
                      onClick={() => {
                        discoverGenre(cat.tag).catch(e => console.error("[DISCOVER]", e));
                      }}
                    >
                      <span>{cat.icon}</span>
                      <strong>{cat.label}</strong>
                      <ChevronRight size={14} />
                    </button>
                  ))}
                </div>

                <div className="section-title-row">
                  <div><h2>Popüler Radyolar</h2><p>En çok dinlenen yayınlar.</p></div>
                  <button type="button" className="section-link" onClick={() => navigate("stations")}>
                    Tümünü gör <ChevronRight size={14} />
                  </button>
                </div>

                {loading ? (
                  <div className="loading-area">
                    {[...Array(6)].map((_, i) => <div key={i} className="station-skeleton" />)}
                  </div>
                ) : error ? (
                  <div className="empty-card error">
                    <Radio size={28} />
                    <strong>Yüklenemedi</strong>
                    <span>{error}</span>
                    <button type="button" onClick={() => { refreshStations().catch(() => {}); }}>
                      Tekrar dene
                    </button>
                  </div>
                ) : (
                  <div className="station-list">
                    {homeStations.map(s => renderCard(s))}
                  </div>
                )}

                {recentStations.length > 0 && (
                  <>
                    <div className="section-title-row">
                      <div><h2>Son Dinlenenler</h2><p>Kaldığın yerden devam et.</p></div>
                      <button type="button" className="section-link" onClick={() => navigate("history")}>
                        Tümü <ChevronRight size={14} />
                      </button>
                    </div>
                    <div className="station-list">
                      {recentStations.slice(0, 5).map(s => renderCard(s, "rec-"))}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ─── STATIONS ─── */}
            {page === "stations" && (
              <div className="page-anim">
                <PageHeader
                  title="Radyolar"
                  subtitle={`${filteredStations.length} canlı yayın`}
                  action={
                    <button type="button" className="section-link" onClick={() => { refreshStations().catch(() => {}); }}>
                      <RefreshCw size={14} />Güncelle
                    </button>
                  }
                />
                <div className="filter-panel">
                  <div className="filter-heading">
                    <SlidersHorizontal size={15} /><span>Tür filtresi</span>
                  </div>
                  <div className="chips">
                    <button
                      type="button"
                      className={`chip${selectedGenre ? "" : " active"}`}
                      onClick={() => setSelectedGenre("")}
                    >
                      Tümü
                    </button>
                    {GENRE_TAGS.map(tag => (
                      <button
                        key={tag}
                        type="button"
                        className={`chip${selectedGenre === tag ? " active" : ""}`}
                        onClick={() => setSelectedGenre(tag)}
                      >
                        {tag.charAt(0).toUpperCase() + tag.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
                {filteredStations.length > 0
                  ? <div className="station-list">{filteredStations.map(s => renderCard(s))}</div>
                  : <div className="empty-card"><Search size={28} /><strong>Radyo bulunamadı.</strong></div>
                }
              </div>
            )}

            {/* ─── FAVORITES ─── */}
            {page === "favorites" && (
              <div className="page-anim">
                <PageHeader title="Favoriler" subtitle="Sevdiğin radyolar." />
                {favoriteStations.length > 0
                  ? <div className="station-list">{favoriteStations.map(s => renderCard(s))}</div>
                  : (
                    <div className="empty-card big">
                      <div className="empty-icon"><Heart size={32} /></div>
                      <strong>Henüz favori yok.</strong>
                      <span>Kalp ikonuna bas.</span>
                      <button type="button" onClick={() => navigate("stations")}>
                        Radyolara git <ChevronRight size={14} />
                      </button>
                    </div>
                  )}
              </div>
            )}

            {/* ─── DISCOVER ─── */}
            {page === "discover" && (
              <div className="page-anim">
                <PageHeader title="Keşfet" subtitle="Türüne göre yeni radyolar bul." />
                <div className="discover-tabs">
                  {GENRE_TAGS.map(tag => (
                    <button
                      key={tag}
                      type="button"
                      className={selectedGenre === tag ? "active" : ""}
                      onClick={() => { discoverGenre(tag).catch(() => {}); }}
                    >
                      {tag.charAt(0).toUpperCase() + tag.slice(1)}
                    </button>
                  ))}
                </div>
                <div className="section-title-row">
                  <div>
                    <h2>
                      {selectedGenre
                        ? `${selectedGenre.charAt(0).toUpperCase() + selectedGenre.slice(1)} Radyoları`
                        : "Öne çıkanlar"}
                    </h2>
                  </div>
                </div>
                {loading
                  ? <div className="loading-area">{[...Array(8)].map((_, i) => <div key={i} className="station-skeleton" />)}</div>
                  : <div className="station-list">
                      {(selectedGenre ? filteredStations : stations.slice(0, 20)).map(s => renderCard(s))}
                    </div>
                }
              </div>
            )}

            {/* ─── HISTORY ─── */}
            {page === "history" && (
              <div className="page-anim">
                <PageHeader
                  title="Dinleme Geçmişi"
                  subtitle={`${recentStations.length} istasyon`}
                  action={recentStations.length > 0
                    ? (
                      <button
                        type="button"
                        className="section-link danger-link"
                        onClick={() => { setHistory([]); showToast("Geçmiş temizlendi", "", "info"); }}
                      >
                        <Trash2 size={14} />Temizle
                      </button>
                    ) : null
                  }
                />
                {recentStations.length > 0 ? (
                  <div className="history-list">
                    {recentStations.map(s => {
                      const sid = stationId(s);
                      return (
                        <HistoryItem
                          key={sid}
                          station={s}
                          active={Boolean(playing && currentStation && stationId(currentStation) === sid)}
                          onPlay={() => playStation(s).catch(() => {})}
                        />
                      );
                    })}
                  </div>
                ) : (
                  <div className="empty-card big">
                    <div className="empty-icon"><History size={32} /></div>
                    <strong>Henüz bir şey dinlemedin.</strong>
                    <button type="button" onClick={() => navigate("stations")}>
                      Radyo bul <ChevronRight size={14} />
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* ─── SETTINGS ─── */}
            {page === "settings" && (
              <div className="page-anim">
                <PageHeader title="Ayarlar" subtitle="Keyfe Keder Radyo'yu kişiselleştir." />

                {/* Görünüm */}
                <div className="settings-section">
                  <div className="settings-section-title">🎨 Görünüm</div>
                  <div className="settings-card">
                    <SettingRow label="Accent rengi" desc="Arayüz vurgu rengi">
                      <div className="accent-list">
                        {Object.entries(ACCENTS).map(([name, color]) => (
                          <button
                            key={name}
                            type="button"
                            className={`accent-dot${settings.accent === name ? " selected" : ""}`}
                            style={{ backgroundColor: color }}
                            title={name}
                            onClick={() => set("accent", name)}
                            aria-label={`${name} accent rengi`}
                          />
                        ))}
                      </div>
                    </SettingRow>
                    <SettingRow label="Kart stili" desc="Radyo kartlarının görünümü">
                      <SegmentedControl
                        options={[
                          { value:"gradient", label:"Gradient" },
                          { value:"minimal",  label:"Minimal"  },
                          { value:"glass",    label:"Glass"    },
                        ]}
                        value={settings.cardStyle}
                        onChange={v => set("cardStyle", v)}
                      />
                    </SettingRow>
                    <SettingRow label="Liste yoğunluğu" desc="Kartların boyutu">
                      <SegmentedControl
                        options={[
                          { value:"normal",  label:"Normal"   },
                          { value:"compact", label:"Kompakt"  },
                        ]}
                        value={settings.listDensity}
                        onChange={v => set("listDensity", v)}
                      />
                    </SettingRow>
                    <SettingRow label="Tür rozeti göster" desc="Kartlarda tür etiketini göster">
                      <ToggleBtn on={settings.showGenreBadge} onToggle={() => set("showGenreBadge", !settings.showGenreBadge)} />
                    </SettingRow>
                    <SettingRow label="Ses spektrumu" desc="Player'daki animasyonlu spektrum">
                      <ToggleBtn on={settings.spectrum} onToggle={() => set("spectrum", !settings.spectrum)} />
                    </SettingRow>
                  </div>
                </div>

                {/* Ses */}
                <div className="settings-section">
                  <div className="settings-section-title">🔊 Ses</div>
                  <div className="settings-card">
                    <div className="setting-row column">
                      <div>
                        <strong>Ses seviyesi</strong>
                        <span>%{settings.volume}</span>
                      </div>
                      <input
                        className="range"
                        type="range" min="0" max="100" value={settings.volume}
                        onChange={e => set("volume", Number(e.target.value))}
                        aria-label="Ses seviyesi"
                      />
                    </div>
                    <SettingRow label="Equalizer" desc={EQ_PRESETS[settings.equalizer]?.desc ?? ""}>
                      <SegmentedControl
                        options={Object.entries(EQ_PRESETS).map(([v, { label }]) => ({ value: v, label }))}
                        value={settings.equalizer}
                        onChange={v => set("equalizer", v)}
                      />
                    </SettingRow>
                  </div>
                </div>

                {/* Çalma */}
                <div className="settings-section">
                  <div className="settings-section-title">▶️ Çalma</div>
                  <div className="settings-card">
                    <SettingRow label="Otomatik oynatma" desc="Site açıldığında son radyoyu başlat">
                      <ToggleBtn on={settings.autoPlay} onToggle={() => set("autoPlay", !settings.autoPlay)} />
                    </SettingRow>
                    <div className="setting-row">
                      <div>
                        <strong>Uyku zamanlayıcısı</strong>
                        <span>Belirli süre sonra kapat</span>
                      </div>
                      <div className="sleep-selector">
                        {[0, 15, 30, 60, 90].map(m => (
                          <button
                            key={m}
                            type="button"
                            className={`sleep-chip${settings.sleepMinutes === m ? " active" : ""}`}
                            onClick={() => set("sleepMinutes", m)}
                          >
                            {m === 0 ? "Kapalı" : `${m}dk`}
                          </button>
                        ))}
                      </div>
                    </div>
                    {sleepSeconds > 0 && (
                      <div className="setting-row">
                        <div><strong>Kalan süre</strong></div>
                        <strong className="sleep-countdown">{fmtSecs(sleepSeconds)}</strong>
                      </div>
                    )}
                  </div>
                </div>

                {/* Bildirimler */}
                <div className="settings-section">
                  <div className="settings-section-title">🔔 Bildirimler</div>
                  <div className="settings-card">
                    <SettingRow label="Bildirimler" desc="Sistem ve güncelleme bildirimleri">
                      <ToggleBtn on={settings.notifications} onToggle={() => set("notifications", !settings.notifications)} />
                    </SettingRow>
                    <SettingRow label="Güncelleme bildirimi" desc="Radyo listesi güncellenince bildir">
                      <ToggleBtn on={settings.autoUpdateNotif} onToggle={() => set("autoUpdateNotif", !settings.autoUpdateNotif)} />
                    </SettingRow>
                  </div>
                </div>

                {/* Radyo sistemi */}
                <div className="settings-section">
                  <div className="settings-section-title">📡 Radyo Sistemi</div>
                  <div className="settings-card">
                    <SettingRow label="Otomatik yenileme" desc="30sn'de bir lokal listeyi kontrol et">
                      <ToggleBtn on={settings.autoRefresh} onToggle={() => set("autoRefresh", !settings.autoRefresh)} />
                    </SettingRow>
                    <SettingRow label="Radyo listesini güncelle" desc="Güncel istasyonları yeniden al">
                      <button
                        type="button"
                        className="settings-action-button"
                        onClick={() => { refreshStations().catch(() => {}); }}
                        disabled={manualUpdating}
                      >
                        {manualUpdating
                          ? <LoaderCircle size={15} className="spin" />
                          : <RefreshCw size={15} />}
                        {manualUpdating ? "Güncelleniyor..." : "Güncelle"}
                      </button>
                    </SettingRow>
                    <SettingRow
                      label="Güncelleme durumu"
                      desc={radioUpdateStatus?.message ?? "Bekleniyor."}
                    >
                      {radioUpdateStatus?.state === "error"
                        ? <AlertTriangle size={17} color="#ff8a91" />
                        : <CheckCircle2  size={17} color="#4ade80" />}
                    </SettingRow>
                    <SettingRow label="Radyo sayısı" desc="Kullanılabilir istasyonlar">
                      <strong className="stat-value">
                        {radioUpdateStatus?.total ?? stations.length ?? 0}
                      </strong>
                    </SettingRow>
                    <SettingRow label="Son güncelleme" desc={fmtDate(radioUpdateStatus?.updated_at ?? lastStationRefresh)}>
                      <Clock size={16} color="#3c5068" />
                    </SettingRow>
                  </div>
                </div>

                {/* Servisler */}
                <div className="settings-section">
                  <div className="settings-section-title">⚙️ Sistem Servisleri</div>
                  <div className="settings-card">
                    {[
                      { key:"gateway", label:"Gateway",    desc: serviceStatus.gateway ? "8787 aktif" : "Bekleniyor" },
                      { key:"vite",    label:"Web Server", desc: serviceStatus.vite    ? "5173 aktif" : "Bekleniyor" },
                      { key:"updater", label:"Auto Update",desc: serviceStatus.updater ? "Aktif"      : "Bekleniyor" },
                    ].map(({ key, label, desc }) => (
                      <SettingRow key={key} label={label} desc={desc}>
                        <div className="service-status-dot">
                          <i className={serviceStatus[key] ? "online" : "offline"} />
                        </div>
                      </SettingRow>
                    ))}
                  </div>
                </div>

                {/* Uygulama */}
                <div className="settings-section">
                  <div className="settings-section-title">ℹ️ Uygulama</div>
                  <div className="settings-card">
                    <SettingRow label={APP_NAME} desc={`Web v${APP_VERSION} · React + Vite + RadioBrowser`}>
                      <ExternalLink size={16} color="#3c5068" />
                    </SettingRow>
                  </div>
                </div>
              </div>
            )}

          </div>
        </main>

        {/* ══════ PLAYER BAR ══════ */}
        {currentStation && !showMiniPlayer && (
          <div
            className={`player-bar${playing ? " playing" : ""}`}
            style={{ "--player-color": accent }}
          >
            {/* Station info */}
            <div
              className="player-station"
              onClick={() => setShowFullPlayer(true)}
              role="button"
              tabIndex={0}
              onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setShowFullPlayer(true); } }}
            >
              <GenreAvatar station={currentStation} size="md" />
              <div className="player-station-copy">
                <strong>{currentStation.name}</strong>
                <span>
                  {playing && <i className="player-live-dot" />}
                  {playing ? "CANLI" : "HAZIR"}
                  {" · "}
                  {currentStation.genre ?? "Diğer"}
                </span>
              </div>
            </div>

            {/* Controls */}
            <div className="player-controls">
              {settings.spectrum && <Spectrum active={playing} />}
              <button type="button" className="player-small-button" onClick={() => changeStation(-1)} title="Önceki">
                <SkipBack size={16} />
              </button>
              <button
                type="button"
                className="player-main-button"
                onClick={() => {
                  if (playing) {
                    stopPlayback();
                  } else {
                    playStation(currentStation).catch(() => {});
                  }
                }}
                title={playing ? "Duraklat" : "Oynat"}
              >
                {playing ? <Pause size={21} fill="currentColor" /> : <Play size={21} fill="currentColor" />}
              </button>
              <button type="button" className="player-small-button" onClick={() => changeStation(1)} title="Sonraki">
                <SkipForward size={16} />
              </button>
            </div>

            {/* Actions */}
            <div className="player-actions">
              <button type="button" className="player-icon-button" onClick={toggleMute} title={settings.volume > 0 ? "Sesi kapat" : "Sesi aç"}>
                {settings.volume > 0 ? <Volume2 size={17} /> : <VolumeX size={17} />}
              </button>
              <input
                className="player-volume"
                type="range" min="0" max="100" value={settings.volume}
                onChange={e => set("volume", Number(e.target.value))}
                aria-label="Ses seviyesi"
              />
              <div className="player-sleep">
                <Timer size={15} />
                {sleepSeconds > 0 && <span>{fmtSecs(sleepSeconds)}</span>}
              </div>
              <button
                type="button"
                className={`player-icon-button${favOfCurrent ? " favorite" : ""}`}
                onClick={() => toggleFavorite(currentStation)}
                title={favOfCurrent ? "Favorilerden çıkar" : "Favorilere ekle"}
              >
                <Heart size={17} fill={favOfCurrent ? "currentColor" : "none"} />
              </button>
              <button
                type="button"
                className="player-icon-button"
                onClick={() => setShowFullPlayer(true)}
                title="Tam ekran"
              >
                <Maximize2 size={17} />
              </button>
              <button
                type="button"
                className="player-icon-button"
                onClick={() => setShowMiniPlayer(true)}
                title="Mini player"
              >
                <Minimize2 size={17} />
              </button>
            </div>
          </div>
        )}

        {/* ══════ MOBILE NAV ══════ */}
        {isMobile && (
          <nav className="mobile-nav" aria-label="Alt navigasyon">
            {navItems.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                className={page === id ? "active" : ""}
                onClick={() => navigate(id)}
                aria-current={page === id ? "page" : undefined}
              >
                <Icon size={20} />
                <span>{label}</span>
              </button>
            ))}
            <button
              type="button"
              className={page === "settings" ? "active" : ""}
              onClick={() => navigate("settings")}
              aria-current={page === "settings" ? "page" : undefined}
            >
              <Settings size={20} />
              <span>Ayarlar</span>
            </button>
          </nav>
        )}

        {/* Floating settings (desktop) */}
        {!isMobile && currentStation && !showMiniPlayer && (
          <button
            type="button"
            className="floating-settings"
            onClick={() => navigate("settings")}
          >
            <Settings size={14} />Ayarlar
          </button>
        )}

        {/* Audio error toast */}
        {audioError && (
          <div className="error-toast" role="alert">
            <div>
              <strong>Yayın hatası</strong>
              <span>{audioError}</span>
            </div>
            <button type="button" onClick={() => setAudioError("")} aria-label="Kapat">
              <X size={16} />
            </button>
          </div>
        )}

        {/* Notification toast */}
        {toast && (
          <div className={`app-toast ${toast.type ?? "info"}`} role="alert" aria-live="polite">
            <div className="app-toast-icon">
              {toast.type === "success" ? <CheckCircle2 size={18} />
                : toast.type === "error"  ? <AlertTriangle size={18} />
                : toast.type === "update" ? <LoaderCircle size={18} className="spin" />
                : <Activity size={18} />}
            </div>
            <div>
              <strong>{toast.title}</strong>
              <span>{toast.message}</span>
            </div>
            <button type="button" onClick={() => setToast(null)} aria-label="Kapat">
              <X size={15} />
            </button>
          </div>
        )}
      </div>
    </>
  );
}
