import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App.jsx";
import "./styles.css";

/*
 * Radio stream bridge
 *
 * App.jsx assigns the station's direct URL to <audio>. Direct browser
 * playback is unreliable for many radio streams because of CORS and
 * cross-origin stream headers. The gateway already exposes /api/relay,
 * so transparently route normal HTTP/HTTPS radio streams through it.
 *
 * Because the relay is same-origin in production and Vite proxies /api
 * during local development, this works in both environments without
 * hard-coding localhost or the production hostname.
 */
(() => {
  const proto = HTMLMediaElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, "src");

  if (!descriptor?.set || !descriptor.get) return;
  if (window.__KKR_MEDIA_BRIDGE__) return;

  const originalSet = descriptor.set;
  const originalGet = descriptor.get;

  const gatewayUrl = (value) => {
    if (typeof value !== "string" || !value.trim()) return value;

    const raw = value.trim();

    // Keep local blob/data URLs and our own endpoints untouched.
    if (/^(blob:|data:)/i.test(raw)) return raw;
    if (raw.startsWith("/api/") || raw.startsWith("/gateway/")) return raw;

    let url;
    try {
      url = new URL(raw, window.location.href);
    } catch {
      return raw;
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return raw;
    }

    // Same-origin media is already under our control.
    if (url.origin === window.location.origin && url.pathname.startsWith("/api/")) {
      return raw;
    }

    return `/api/relay?url=${encodeURIComponent(url.href)}`;
  };

  Object.defineProperty(proto, "src", {
    configurable: descriptor.configurable,
    enumerable: descriptor.enumerable,
    get: originalGet,
    set(value) {
      originalSet.call(this, gatewayUrl(value));
    },
  });

  window.__KKR_MEDIA_BRIDGE__ = {
    restore() {
      Object.defineProperty(proto, "src", descriptor);
      delete window.__KKR_MEDIA_BRIDGE__;
    },
  };
})();

const rootElement =
  document.getElementById("root");

if (!rootElement) {
  throw new Error(
    "React root elementi bulunamadı."
  );
}

ReactDOM.createRoot(
  rootElement
).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);