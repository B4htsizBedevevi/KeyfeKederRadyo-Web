"""
╔══════════════════════════════════════════════════════╗
║           KEYFE KEDER RADYO  —  BAŞLATICI            ║
║  Çalıştır : python start.py                          ║
║  Durdur   : Ctrl+C                                   ║
╚══════════════════════════════════════════════════════╝

Sıra:
  1. Eski 8787 / 5173 portlarını kapat
  2. web/dist/ klasörünü sil  ← eski UI'ı tamamen yok eder
  3. Taze vite build al        ← çıktı log dosyasına + ekrana
  4. Node.js Gateway başlat   (port 8787)
  5. Python Auto-Updater başlat
  6. Vite Preview başlat      (port 5173)
  7. Tarayıcı aç
  8. Watchdog — servisler çöktüyse otomatik yeniden başlatır
"""

from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from datetime import datetime
from pathlib import Path

# ─────────────────────────────────────────────────────────────
# PATHS
# ─────────────────────────────────────────────────────────────
ROOT        = Path(__file__).resolve().parent
SERVER_DIR  = ROOT / "server"
WEB_DIR     = ROOT / "web"
DIST_DIR    = WEB_DIR / "dist"
LOG_DIR     = ROOT / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)

SERVER_FILE  = SERVER_DIR / "server.js"
UPDATER_FILE = ROOT / "station_auto_update.py"
WEB_PKG      = WEB_DIR / "package.json"
STATUS_FILE  = WEB_DIR / "public" / "service_status.json"
BUILD_LOG    = LOG_DIR / "build.log"

# .venv varsa onu kullan, yoksa sistem Python'u
_VENV_PY = ROOT / ".venv" / "Scripts" / "python.exe"

# ─────────────────────────────────────────────────────────────
# PORTS
# ─────────────────────────────────────────────────────────────
GATEWAY_HOST = "127.0.0.1"
GATEWAY_PORT = 8787
WEB_HOST     = "127.0.0.1"
WEB_PORT     = 5173

# ─────────────────────────────────────────────────────────────
# GLOBALS
# ─────────────────────────────────────────────────────────────
_gateway  : subprocess.Popen | None = None
_updater  : subprocess.Popen | None = None
_vite     : subprocess.Popen | None = None
_stopping : bool = False

# ─────────────────────────────────────────────────────────────
# TERMINAL RENK  (Windows ANSI etkinleştir)
# ─────────────────────────────────────────────────────────────
if sys.platform == "win32":
    os.system("color")

def _c(code: str, text: str) -> str:
    return f"\033[{code}m{text}\033[0m"

def ok(t: str)              -> str: return _c("32;1", f"[OK]   {t}")
def info(t: str)            -> str: return _c("36",   f"[..]   {t}")
def warn(t: str)            -> str: return _c("33",   f"[!!]   {t}")
def err(t: str)             -> str: return _c("31;1", f"[ERR]  {t}")
def step(n: int, t: str)    -> str: return _c("35;1", f"[{n}/7]") + f" {t}"
def dim(t: str)             -> str: return _c("90",   t)

# ─────────────────────────────────────────────────────────────
# LOG  (hem ekrana yaz hem launcher.log dosyasına)
# ─────────────────────────────────────────────────────────────
_log_lock = threading.Lock()

def _append_log(path: Path, line: str) -> None:
    try:
        with _log_lock:
            with path.open("a", encoding="utf-8", errors="replace") as f:
                f.write(line + "\n")
    except Exception:
        pass

def log(msg: str) -> None:
    ts   = datetime.now().strftime("%H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line)
    _append_log(LOG_DIR / "launcher.log", line)

# ─────────────────────────────────────────────────────────────
# PYTHON / NPM BULMA
# ─────────────────────────────────────────────────────────────
def get_python() -> str:
    return str(_VENV_PY) if _VENV_PY.exists() else sys.executable

def get_npm() -> str | None:
    for cmd in ("npm.cmd", "npm.exe", "npm"):
        try:
            r = subprocess.run(
                [cmd, "--version"],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=5,
                shell=False,
            )
            if r.returncode == 0:
                return cmd
        except Exception:
            continue
    return None

# ─────────────────────────────────────────────────────────────
# PORT YARDIMCILARI
# ─────────────────────────────────────────────────────────────
def port_open(host: str, port: int, timeout: float = 1.0) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(timeout)
        try:
            s.connect((host, port))
            return True
        except OSError:
            return False

def wait_port(host: str, port: int, seconds: float = 30) -> bool:
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if port_open(host, port):
            return True
        time.sleep(0.4)
    return False

def kill_port(port: int) -> None:
    """Windows'ta belirtilen portu dinleyen süreci öldürür."""
    if sys.platform != "win32":
        return
    try:
        subprocess.run(
            [
                "powershell.exe",
                "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
                (
                    f"$pids = Get-NetTCPConnection -LocalPort {port} -State Listen "
                    f"-ErrorAction SilentlyContinue | "
                    f"Select-Object -ExpandProperty OwningProcess -Unique; "
                    f"foreach($id in $pids)"
                    f"{{ Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }}"
                ),
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=8,
        )
        time.sleep(0.6)
    except Exception:
        pass

# ─────────────────────────────────────────────────────────────
# PROCESS BAŞLATICI + PIPE
# ─────────────────────────────────────────────────────────────
def _pipe(proc: subprocess.Popen, log_path: Path) -> None:
    """Proses stdout'unu arka planda log dosyasına akıtır."""
    def _worker() -> None:
        try:
            with log_path.open("a", encoding="utf-8", errors="replace") as f:
                while True:
                    line = proc.stdout.readline()
                    if not line:
                        if proc.poll() is not None:
                            break
                        time.sleep(0.05)
                        continue
                    f.write(f"[{datetime.now().strftime('%H:%M:%S')}] {line.rstrip()}\n")
                    f.flush()
        except Exception:
            pass
    threading.Thread(target=_worker, daemon=True).start()

def spawn(cmd: list[str], cwd: Path, log_name: str, label: str) -> subprocess.Popen | None:
    flags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
    try:
        p = subprocess.Popen(
            cmd,
            cwd=str(cwd),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            text=True,
            encoding="utf-8",
            errors="replace",
            creationflags=flags,
            shell=False,
        )
        _pipe(p, LOG_DIR / log_name)
        return p
    except FileNotFoundError:
        log(err(f"{label} komutu bulunamadı: {cmd[0]}"))
    except Exception as e:
        log(err(f"{label} başlatılamadı: {e}"))
    return None

# ─────────────────────────────────────────────────────────────
# STATUS JSON  (web/public/service_status.json)
# ─────────────────────────────────────────────────────────────
def write_status(all_stopped: bool = False) -> None:
    gw_ok  = (not all_stopped) and (_gateway is not None) and (_gateway.poll() is None) and port_open(GATEWAY_HOST, GATEWAY_PORT)
    web_ok = (not all_stopped) and (_vite    is not None) and (_vite.poll()    is None) and port_open(WEB_HOST,     WEB_PORT)
    upd_ok = (not all_stopped) and (_updater is not None) and (_updater.poll() is None)
    payload = {
        "gateway":    gw_ok,
        "vite":       web_ok,
        "updater":    upd_ok,
        "checked_at": datetime.now().isoformat(timespec="seconds"),
        "timestamp":  time.time(),
    }
    tmp = STATUS_FILE.with_suffix(".json.tmp")
    try:
        STATUS_FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        tmp.replace(STATUS_FILE)
    except Exception:
        pass

# ─────────────────────────────────────────────────────────────
# BUILD  — eski dist/ sil, taze build al, çıktıyı loga yaz
# ─────────────────────────────────────────────────────────────
def run_build(npm: str) -> bool:
    # 1. Eski dist/ klasörünü sil
    if DIST_DIR.exists():
        try:
            shutil.rmtree(DIST_DIR)
            print(info("Eski dist/ silindi."))
        except Exception as e:
            print(warn(f"dist/ silinemedi: {e}"))

    print(info("Vite build başlıyor... (ilk çalıştırmada ~30 sn sürebilir)"))

    # Build log dosyasını aç (eski içeriği temizle)
    try:
        BUILD_LOG.write_text(
            f"[{datetime.now().isoformat(timespec='seconds')}] BUILD BAŞLADI\n",
            encoding="utf-8",
        )
    except Exception:
        pass

    try:
        # stdout + stderr'i hem terminale hem log dosyasına akıt
        proc = subprocess.Popen(
            [npm, "run", "build"],
            cwd=str(WEB_DIR),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            text=True,
            encoding="utf-8",
            errors="replace",
            shell=False,
        )

        output_lines: list[str] = []
        try:
            with BUILD_LOG.open("a", encoding="utf-8", errors="replace") as bf:
                assert proc.stdout is not None
                for line in proc.stdout:
                    stripped = line.rstrip()
                    # Terminale yaz
                    print(dim(f"  {stripped}"))
                    # Log dosyasına yaz
                    bf.write(stripped + "\n")
                    bf.flush()
                    output_lines.append(stripped)
        except Exception:
            pass

        proc.wait(timeout=300)
        success = proc.returncode == 0

        try:
            with BUILD_LOG.open("a", encoding="utf-8", errors="replace") as bf:
                bf.write(
                    f"\n[{datetime.now().isoformat(timespec='seconds')}] "
                    f"BUILD {'BAŞARILI' if success else 'BAŞARISIZ'} "
                    f"(returncode={proc.returncode})\n"
                )
        except Exception:
            pass

        if not success:
            # Son 20 satırı göster — hata nerede?
            tail = output_lines[-20:] if len(output_lines) >= 20 else output_lines
            print()
            print(err("Build başarısız — son çıktı:"))
            for l in tail:
                print(f"  {l}")
            print()
            print(warn(f"Tam çıktı için: {BUILD_LOG}"))

        return success

    except subprocess.TimeoutExpired:
        try:
            proc.kill()
        except Exception:
            pass
        log(err("Vite build zaman aşımına uğradı (>300 sn)."))
        return False
    except Exception as e:
        log(err(f"Vite build çalıştırılamadı: {e}"))
        return False

# ─────────────────────────────────────────────────────────────
# SERVİS BAŞLATICILAR
# ─────────────────────────────────────────────────────────────
def start_gateway() -> None:
    global _gateway
    if _gateway and _gateway.poll() is None:
        return
    _gateway = spawn(["node", SERVER_FILE.name], SERVER_DIR, "gateway.log", "Gateway")

def start_updater() -> None:
    global _updater
    if _updater and _updater.poll() is None:
        return
    _updater = spawn([get_python(), str(UPDATER_FILE)], ROOT, "auto_update.log", "AutoUpdate")

def start_vite_preview(npm: str) -> None:
    global _vite
    if _vite and _vite.poll() is None:
        return
    _vite = spawn(
        [npm, "run", "preview", "--", "--host", "0.0.0.0", "--port", str(WEB_PORT)],
        WEB_DIR,
        "vite.log",
        "VitePreview",
    )

# ─────────────────────────────────────────────────────────────
# WATCHDOG  — 15sn'de bir tüm servisleri kontrol eder
# ─────────────────────────────────────────────────────────────
def _watchdog(npm: str) -> None:
    while not _stopping:
        time.sleep(15)
        if _stopping:
            break
        try:
            if not (_gateway and _gateway.poll() is None and port_open(GATEWAY_HOST, GATEWAY_PORT)):
                log(warn("Gateway çöktü — yeniden başlatılıyor"))
                start_gateway()
            if not (_vite and _vite.poll() is None and port_open(WEB_HOST, WEB_PORT)):
                log(warn("Vite Preview çöktü — yeniden başlatılıyor"))
                start_vite_preview(npm)
            if not (_updater and _updater.poll() is None):
                log(warn("Auto-Updater çöktü — yeniden başlatılıyor"))
                start_updater()
            write_status()
        except Exception as e:
            log(warn(f"Watchdog döngüsünde hata: {e}"))

# ─────────────────────────────────────────────────────────────
# CLEANUP  (Ctrl+C veya normal çıkış)
# ─────────────────────────────────────────────────────────────
def _stop_proc(proc: subprocess.Popen | None, label: str) -> None:
    if not proc:
        return
    try:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=2)
    except Exception as e:
        log(warn(f"{label} durdurulurken hata: {e}"))

def cleanup() -> None:
    global _stopping
    _stopping = True
    write_status(all_stopped=True)
    print()
    print(dim("Servisler durduruluyor..."))
    _stop_proc(_vite,    "VitePreview")
    _stop_proc(_updater, "AutoUpdate")
    _stop_proc(_gateway, "Gateway")
    print(ok("Tüm servisler durduruldu."))

# ─────────────────────────────────────────────────────────────
# LAN IP
# ─────────────────────────────────────────────────────────────
def lan_ip() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except Exception:
        return "192.168.x.x"

# ─────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────
def main() -> None:
    # Banner
    print()
    print(_c("34;1", "╔══════════════════════════════════════════════════╗"))
    print(_c("34;1", "║") + _c("37;1", "        KEYFE KEDER RADYO  —  BAŞLATICI         ") + _c("34;1", "║"))
    print(_c("34;1", "╚══════════════════════════════════════════════════╝"))
    print()

    # Gerekli dosya/klasör kontrolü
    missing = [p for p in [SERVER_FILE, UPDATER_FILE, WEB_PKG] if not p.exists()]
    if missing:
        for p in missing:
            print(err(f"Bulunamadı: {p}"))
        print()
        print(warn("Lütfen eksik dosyaları kontrol et ve tekrar çalıştır."))
        sys.exit(1)

    npm = get_npm()
    if npm is None:
        print(err("npm bulunamadı."))
        print(warn("Node.js'i https://nodejs.org adresinden indir ve kur."))
        sys.exit(1)

    print(ok(f"Python  : {get_python()}"))
    print(ok(f"npm     : {npm}"))
    print()

    # ── ADIM 1: Eski portları kapat ─────────────────────────
    print(step(1, "Eski portlar kapatılıyor (8787, 5173)..."))
    kill_port(GATEWAY_PORT)
    kill_port(WEB_PORT)
    print(ok("Portlar temizlendi."))
    print()

    # ── stations.json senkronizasyonu ───────────────────────
    src_st = ROOT / "stations.json"
    dst_st = WEB_DIR / "public" / "stations.json"
    if src_st.exists():
        try:
            dst_st.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src_st, dst_st)
        except Exception:
            pass

    # ── ADIM 2: Taze build ──────────────────────────────────
    print(step(2, "Taze build alınıyor (eski dist/ silindi)..."))
    build_ok = run_build(npm)
    if not build_ok:
        print()
        print(err("Build başarısız. Yukarıdaki hata mesajını incele."))
        print(warn(f"Ayrıca tam log için: {BUILD_LOG}"))
        print()
        # Önceki dist/ varsa eski sürümle devam et — kullanıcıya sor
        if DIST_DIR.exists() and any(DIST_DIR.iterdir()):
            print(warn("Eski dist/ mevcut. Yine de devam edilsin mi? [e/H]"))
            try:
                ans = input().strip().lower()
            except (EOFError, KeyboardInterrupt):
                ans = ""
            if ans != "e":
                sys.exit(1)
            print(warn("Eski build ile devam ediliyor..."))
        else:
            print(err("dist/ bulunamadı, devam edilemiyor."))
            sys.exit(1)
    else:
        print(ok("Build tamamlandı."))
    print()

    # ── ADIM 3: Gateway ─────────────────────────────────────
    print(step(3, "Gateway başlatılıyor..."))
    start_gateway()
    gw_ok = wait_port(GATEWAY_HOST, GATEWAY_PORT, 12)
    print((ok if gw_ok else warn)(f"Gateway {'aktif' if gw_ok else 'henüz cevap vermiyor — logs/gateway.log incele'}"))
    print()

    # ── ADIM 4: Auto-Updater ────────────────────────────────
    print(step(4, "Auto-Updater başlatılıyor..."))
    start_updater()
    time.sleep(1.2)
    upd_ok = _updater is not None and _updater.poll() is None
    print((ok if upd_ok else warn)(f"Auto-Updater {'aktif' if upd_ok else 'başlatılamadı — logs/auto_update.log incele'}"))
    print()

    # ── ADIM 5: Vite Preview ────────────────────────────────
    print(step(5, "Vite Preview başlatılıyor..."))
    start_vite_preview(npm)
    web_ok = wait_port(WEB_HOST, WEB_PORT, 25)
    print((ok if web_ok else warn)(
        f"Vite Preview {'aktif' if web_ok else 'cevap vermiyor — logs/vite.log incele'}"
    ))
    print()

    # İlk status dosyasını yaz
    write_status()

    # ── ADIM 6: Özet ────────────────────────────────────────
    ip = lan_ip()
    print(_c("34;1", "══════════════════════════════════════════════════"))
    print(_c("32;1", "              SİSTEM HAZIR — TEK UI"))
    print(_c("34;1", "══════════════════════════════════════════════════"))
    print()
    print(f"  {'PC (localhost)':<26}  http://localhost:{WEB_PORT}")
    print(f"  {'Telefon / Tablet':<26}  http://{ip}:{WEB_PORT}")
    print(f"  {'Gateway API':<26}  http://127.0.0.1:{GATEWAY_PORT}")
    print()
    print(_c("33", "  F5 / Ctrl+F5 / yenileme → her zaman aynı UI"))
    print(_c("33", "  Eski cache yok — dist/ her açılışta sıfırlanır"))
    print()
    print(dim(f"  Build log  : {BUILD_LOG}"))
    print(dim( "  Durdurmak için Ctrl+C"))
    print()

    # ── ADIM 7: Tarayıcı ────────────────────────────────────
    if web_ok:
        print(step(6, "Tarayıcı açılıyor..."))
        try:
            webbrowser.open(f"http://localhost:{WEB_PORT}")
            print(ok("Tarayıcı açıldı."))
        except Exception:
            print(warn(f"Tarayıcı açılamadı — elle git: http://localhost:{WEB_PORT}"))
        print()

    # ── Watchdog başlat ─────────────────────────────────────
    print(step(7, "Watchdog aktif — servisler izleniyor."))
    threading.Thread(target=_watchdog, args=(npm,), daemon=True).start()

    # ── Ana döngü ───────────────────────────────────────────
    try:
        while not _stopping:
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    finally:
        cleanup()


if __name__ == "__main__":
    main()
