from __future__ import annotations

import hashlib
import json
import logging
import shutil
import time
from datetime import datetime
from pathlib import Path

import station_updater


ROOT = Path(__file__).resolve().parent

STATIONS_FILE = (
    ROOT / "stations.json"
)

WEB_STATIONS_FILE = (
    ROOT
    / "web"
    / "public"
    / "stations.json"
)

STATUS_FILE = (
    ROOT
    / "web"
    / "public"
    / "station_update_status.json"
)

BACKUP_FILE = (
    ROOT
    / "stations.backup.json"
)

UPDATE_INTERVAL = 15 * 60

RETRY_INTERVAL = 60


logging.basicConfig(
    level=logging.INFO,
    format=(
        "%(asctime)s | "
        "%(levelname)s | "
        "%(message)s"
    ),
)


# ============================================================
# JSON
# ============================================================

def write_json(
    path: Path,
    data,
):
    path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    temp = path.with_suffix(
        path.suffix + ".tmp"
    )

    try:

        with temp.open(
            "w",
            encoding="utf-8",
            newline="\n",
        ) as file:

            json.dump(
                data,
                file,
                ensure_ascii=False,
                indent=2,
            )

            file.flush()

        temp.replace(
            path
        )

        return True

    except Exception as exc:

        logging.error(
            "JSON yazilamadi: %s",
            exc,
        )

        try:
            if temp.exists():
                temp.unlink()
        except Exception:
            pass

        return False


def read_json(
    path: Path,
    fallback,
):
    try:

        if not path.exists():
            return fallback

        with path.open(
            "r",
            encoding="utf-8",
        ) as file:

            return json.load(
                file
            )

    except Exception as exc:

        logging.warning(
            "JSON okunamadi: %s",
            exc,
        )

        return fallback


# ============================================================
# STATUS
# ============================================================

def set_status(
    state,
    message,
    total,
    changed=False,
    error=False,
):
    payload = {
        "state": state,
        "message": message,
        "total": int(total),
        "changed": bool(changed),
        "error": bool(error),
        "updated_at": datetime.now().isoformat(
            timespec="seconds"
        ),
        "timestamp": time.time(),
    }

    write_json(
        STATUS_FILE,
        payload,
    )


# ============================================================
# İMZA (içerik gerçekten değişti mi?)
# ============================================================
#
# Eskiden "değişti mi" kontrolü sadece istasyon SAYISINA
# bakıyordu. Bu, radio-browser sayı aynı kalsa bile içerideki
# istasyonlar değişmişse (ör. ölü bir istasyon canlı biriyle
# değiştiyse) web'e YENİ LİSTENİN ASLA YAYINLANMAMASINA sebep
# oluyordu — kullanıcı hep eski/bozuk listeyi görüyordu. Bunun
# yerine gerçek URL kümesinin imzasını karşılaştırıyoruz.

def stations_signature(stations):

    if not isinstance(stations, list):
        return ""

    urls = sorted(
        str(
            station.get(
                "url_resolved",
                station.get("url", ""),
            )
        ).strip().lower()
        for station in stations
        if isinstance(station, dict)
    )

    joined = "|".join(urls)

    return hashlib.sha256(
        joined.encode("utf-8")
    ).hexdigest()


# ============================================================
# COUNT
# ============================================================

def station_count(
    path: Path,
):
    data = read_json(
        path,
        [],
    )

    if not isinstance(
        data,
        list,
    ):
        return 0

    return len(data)


# ============================================================
# VALIDATE
# ============================================================

def validate_stations():

    data = read_json(
        STATIONS_FILE,
        None,
    )

    if not isinstance(
        data,
        list,
    ):
        return None

    valid = []

    for station in data:

        if not isinstance(
            station,
            dict,
        ):
            continue

        name = str(
            station.get(
                "name",
                "",
            )
        ).strip()

        stream = str(
            station.get(
                "url_resolved",
                station.get(
                    "url",
                    station.get(
                        "stream",
                        "",
                    ),
                ),
            )
        ).strip()

        if not name:
            continue

        if not stream:
            continue

        valid.append(
            station
        )

    if not valid:
        return None

    return valid


# ============================================================
# PUBLISH
# ============================================================

def publish_to_web():

    if not STATIONS_FILE.exists():
        return False

    WEB_STATIONS_FILE.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    temp = WEB_STATIONS_FILE.with_suffix(
        ".json.tmp"
    )

    try:

        shutil.copy2(
            STATIONS_FILE,
            temp,
        )

        temp.replace(
            WEB_STATIONS_FILE
        )

        return True

    except Exception as exc:

        logging.error(
            "Web stations.json yazilamadi: %s",
            exc,
        )

        try:
            if temp.exists():
                temp.unlink()
        except Exception:
            pass

        return False


# ============================================================
# UPDATE
# ============================================================

def update_once():

    old_count = station_count(
        STATIONS_FILE
    )

    # station_updater.update_stations() STATIONS_FILE'ın üzerine
    # yazacağı için, "gerçekten değişti mi" imzasını o çağrıdan
    # ÖNCE, eski içerikten alıyoruz.
    old_data = read_json(
        STATIONS_FILE,
        [],
    )

    old_signature = stations_signature(
        old_data
        if isinstance(old_data, list)
        else []
    )

    set_status(
        state="updating",
        message=(
            "Radyolar güncelleniyor..."
        ),
        total=old_count,
    )

    logging.info(
        "Radyo guncellemesi basliyor. "
        "Mevcut: %s",
        old_count,
    )

    try:

        result = (
            station_updater.update_stations()
        )

        if not isinstance(
            result,
            dict,
        ):

            result = {
                "success": bool(result),
                "message": (
                    "Guncelleme tamamlandi."
                ),
            }

        success = bool(
            result.get(
                "success",
                False,
            )
        )

        if not success:

            message = str(
                result.get(
                    "message",
                    "Guncelleme basarisiz.",
                )
            )

            set_status(
                state="error",
                message=(
                    "Radyolar guncellenemedi. "
                    "Mevcut liste korunuyor."
                ),
                total=old_count,
                error=True,
            )

            logging.warning(
                message
            )

            return False

        stations = (
            validate_stations()
        )

        if stations is None:

            set_status(
                state="error",
                message=(
                    "Yeni radyo listesi gecersiz. "
                    "Mevcut liste korunuyor."
                ),
                total=old_count,
                error=True,
            )

            logging.error(
                "Yeni istasyon listesi gecersiz."
            )

            return False

        new_count = len(
            stations
        )

        if new_count <= 0:

            set_status(
                state="error",
                message=(
                    "Yeni liste bos oldugu icin "
                    "mevcut liste korunuyor."
                ),
                total=old_count,
                error=True,
            )

            return False

        new_signature = stations_signature(
            stations
        )

        changed = (
            new_signature != old_signature
            or not WEB_STATIONS_FILE.exists()
        )

        # ÖNEMLİ: yedekleme ve web'e yayınlama her başarılı
        # güncellemede yapılır — sadece "changed" iken değil.
        # Bir dosya kopyalamak ucuzdur; ama bunu "changed" şartına
        # bağlamak, sayı aynı kalıp içerik değiştiğinde web
        # arayüzünün asla güncellenmemesine yol açan asıl hataydı.
        try:

            if STATIONS_FILE.exists():

                shutil.copy2(
                    STATIONS_FILE,
                    BACKUP_FILE,
                )

        except Exception as exc:

            logging.warning(
                "Backup olusturulamadi: %s",
                exc,
            )

        if not publish_to_web():

            set_status(
                state="error",
                message=(
                    "Radyo listesi alindi fakat "
                    "web listesine yazilamadi."
                ),
                total=old_count,
                error=True,
            )

            return False

        set_status(
            state="ready",
            message=(
                "Radyo listesi guncellendi."
                if changed
                else
                "Radyo listesi zaten guncel."
            ),
            total=new_count,
            changed=changed,
            error=False,
        )

        logging.info(
            "Guncelleme tamamlandi. "
            "Eski=%s Yeni=%s Degisti=%s",
            old_count,
            new_count,
            changed,
        )

        return True

    except Exception as exc:

        set_status(
            state="error",
            message=(
                "Guncelleme sirasinda hata olustu. "
                "Mevcut liste korunuyor."
            ),
            total=old_count,
            error=True,
        )

        logging.exception(
            "Guncelleme hatasi:"
        )

        return False


# ============================================================
# MAIN LOOP
# ============================================================

def main():

    logging.info(
        "========================================"
    )

    logging.info(
        "KEYFE KEDER RADYO AUTO UPDATE"
    )

    logging.info(
        "========================================"
    )

    # Acilir acilmaz bir kere calistir.
    success = update_once()

    while True:

        if success:

            sleep_time = (
                UPDATE_INTERVAL
            )

            logging.info(
                "Sonraki guncelleme %s dakika sonra.",
                UPDATE_INTERVAL // 60,
            )

        else:

            sleep_time = (
                RETRY_INTERVAL
            )

            logging.warning(
                "Guncelleme basarisiz. "
                "%s saniye sonra tekrar denenecek.",
                RETRY_INTERVAL,
            )

        time.sleep(
            sleep_time
        )

        success = update_once()


if __name__ == "__main__":
    main()