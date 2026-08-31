import os
import json
import re
import urllib.parse
import urllib.request
import urllib.error
import tempfile
import shutil
import time
import concurrent.futures

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIONS_FILE = os.path.join(BASE_DIR, "stations.json")
BACKUP_FILE = os.path.join(BASE_DIR, "stations.backup.json")

API_BASE = "https://de1.api.radio-browser.info/json/stations/search"

USER_AGENT = "RADIO/0.8.0 (Windows; Radio Player)"

MAX_TURKISH = 120
MAX_FOREIGN = 25
MIN_BITRATE = 48

# =========================================================
# YAYIN CANLILIK KONTROLÜ (STREAM HEALTH CHECK)
# =========================================================
#
# radio-browser.info'nun "hidebroken=true" parametresi kendi
# eski/güvenilmez ping sonuçlarına dayanır; pratikte gerçekten
# ölü olan birçok yayın "broken" olarak işaretlenmemiş olabilir.
# Bu yüzden listeye eklemeden önce her adayı gerçekten
# bağlanmayı deneyerek kontrol ediyoruz. Bu, "bazı istasyonlar
# hiç çalmıyor" sorununun kök nedenidir.

STREAM_CHECK_TIMEOUT = 6
STREAM_CHECK_WORKERS = 24
STREAM_CHECK_BUFFER = 3  # ihtiyaçtan kaç kat fazla aday test edilsin


def check_stream_alive(url):
    """Bir yayın URL'sine gerçekten bağlanıp veri akıp akmadığını kontrol eder."""

    url = text(url)

    if not valid_url(url):
        return False

    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Icy-MetaData": "1",
            # Tüm dosyayı indirmeden ilk birkaç KB'i isteriz;
            # çoğu icecast/shoutcast sunucusu Range'i yok sayıp
            # normal akışı gönderir, bu da sorun değil.
            "Range": "bytes=0-8192",
        },
    )

    try:
        with urllib.request.urlopen(
            request,
            timeout=STREAM_CHECK_TIMEOUT,
        ) as response:

            status = getattr(response, "status", None) or response.getcode()

            if status and status >= 400:
                return False

            chunk = response.read(4096)

            return bool(chunk)

    except urllib.error.HTTPError as error:
        # Bazı sunucular Range/HEAD benzeri isteklere 403/405 gibi
        # kodlarla cevap verir ama yayın aslında çalışıyordur.
        # Sadece "kesinlikle yok/kapalı" anlamına gelen kodları
        # gerçek hata sayıyoruz.
        return error.code not in (404, 410, 451, 500, 502, 503)

    except Exception:
        return False


def filter_alive(stations):
    """Verilen listeyi, eşzamanlı olarak gerçekten canlı olan yayınlara indirger."""

    if not stations:
        return []

    alive = []

    with concurrent.futures.ThreadPoolExecutor(
        max_workers=STREAM_CHECK_WORKERS
    ) as pool:

        future_map = {
            pool.submit(check_stream_alive, station.get("url")): station
            for station in stations
        }

        for future in concurrent.futures.as_completed(future_map):

            station = future_map[future]

            try:
                if future.result():
                    alive.append(station)
            except Exception:
                continue

    return alive


def filter_alive_safe(stations, min_ratio=0.20, min_sample=20):
    """
    filter_alive() çağırır, ama sonucu "akıllıca" yorumlar:
    eğer test edilen adayların çoğu (ör. %80'i) erişilemez
    çıkarsa, bu muhtemelen istasyonların değil, updater'ın
    çalıştığı makinenin/ağın geçici bir sorunudur (DNS, güvenlik
    duvarı, internet kesintisi vb). Böyle bir durumda listeyi
    tamamen boşaltmak yerine, filtrelemeyi o tur için atlarız ve
    mevcut adayları olduğu gibi geri veririz — böylece geçici bir
    ağ sorunu yüzünden iyi durumdaki istasyonlar listeden silinmez.
    """

    if len(stations) < 5:
        return stations

    alive = filter_alive(stations)

    if len(stations) >= min_sample and len(alive) < len(stations) * min_ratio:

        print(
            "[HEALTHCHECK] Şüpheli derecede düşük erişim orani "
            f"({len(alive)}/{len(stations)}). "
            "Ağ sorunu olabilir, bu turda filtre atlanıyor."
        )

        return stations

    print(
        f"[HEALTHCHECK] {len(alive)}/{len(stations)} yayın canlı olarak dogrulandı."
    )

    return alive

# =========================================================
# ENGELLENECEK DİLLER / ÜLKELER
# =========================================================

BLOCKED_LANGUAGES = {
    "arabic",
    "ar",
    "persian",
    "farsi",
    "urdu",
    "hebrew",
    "arabisch",
    "persan",
}

BLOCKED_COUNTRIES = {
    "saudi arabia",
    "united arab emirates",
    "egypt",
    "iraq",
    "jordan",
    "syria",
    "lebanon",
    "morocco",
    "algeria",
    "tunisia",
    "qatar",
    "kuwait",
    "bahrain",
    "oman",
    "yemen",
    "palestine",
}

BLOCKED_WORDS = {
    # --------------------------------------------------------
    # ARAPÇA
    # --------------------------------------------------------
    "arabic",
    "arab",
    "عربي",
    "العربية",
    "quran",
    "kuran radio",

    # --------------------------------------------------------
    # FARSI
    # --------------------------------------------------------
    "persian",
    "farsi",

    # --------------------------------------------------------
    # URDU
    # --------------------------------------------------------
    "urdu",

    # --------------------------------------------------------
    # KÜRT / KURDİ
    # --------------------------------------------------------
    "kurd",
    "kurdish",
    "kurdi",
    "kurdî",
    "kurdî",
    "kurdish radio",
    "kurdi radio",
    "kurd radio",
    "kurdî radio",

    # --------------------------------------------------------
    # HABER
    # --------------------------------------------------------
    "news",
    "news radio",
    "newsradio",
    "news talk",
    "news/talk",
    "talk news",
    "breaking news",
    "breakingnews",
    "haber",
    "haberler",
    "haber radio",
    "haber radyosu",
    "haberler radyosu",
    "son dakika",
    "gündem",
    "gundem",
    "current affairs",
    "talk radio",
    "talkradio",
    "talk station",
    "all news",
    "24 hour news",
    "24/7 news",
}

# =========================================================
# TÜRKİYE İŞARETLERİ
# =========================================================

TURKEY_COUNTRIES = {
    "turkey",
    "türkiye",
    "turkiye",
    "tr",
}

TURKISH_LANGUAGES = {
    "turkish",
    "türkçe",
    "turkce",
    "tr",
}

TURKISH_CITIES = {
    "istanbul",
    "ankara",
    "izmir",
    "bursa",
    "antalya",
    "adana",
    "konya",
    "mersin",
    "kayseri",
    "eskisehir",
    "eskişehir",
    "gaziantep",
    "diyarbakir",
    "diyarbakır",
    "trabzon",
    "samsun",
    "malatya",
    "erzurum",
    "van",
    "denizli",
    "manisa",
    "balikesir",
    "balıkesir",
    "sakarya",
    "kocaeli",
    "gebze",
    "bodrum",
    "fethiye",
    "mugla",
    "muğla",
    "aydın",
    "aydin",
}

# =========================================================
# YABANCI SEÇKİ
# =========================================================

FOREIGN_STATIONS = {
    "bbc radio 1",
    "bbc radio 2",
    "bbc radio 3",
    "bbc radio 4",
    "classic fm",
    "capital fm",
    "kiss fm",
    "virgin radio",
    "smooth jazz",
    "jazz24",
    "rock fm",
    "absolute radio",
}

# =========================================================
# TÜRLER
# =========================================================

GENRE_RULES = {

    # ========================================================
    # TÜRK ARABESK
    # ========================================================

    "Arabesk": [
        "arabesk",
        "arabesque",
        "fantazi",
        "fantasy",
        "turkish arabesk",
        "damar",
        "damar fm",
        "damar radio",
    ],

    # ========================================================
    # SLOW
    # ========================================================

    "Slow": [
        "slow",
        "slow pop",
        "slow music",
        "soft",
        "soft pop",
        "soft music",
        "love songs",
        "love song",
        "romantic",
        "romance",
        "ballad",
        "ballads",
        "chill",
        "slow hits",
        "slow türk",
        "slow turk",
    ],

    # ========================================================
    # ROCK
    # ========================================================

    "Rock": [
        "rock",
        "classic rock",
        "classic-rock",
        "alternative rock",
        "alternative",
        "hard rock",
        "indie rock",
        "indie",
        "punk rock",
        "punk",
        "metal",
        "heavy metal",
        "soft rock",
        "rock hits",
    ],

    # ========================================================
    # RAP / HIP HOP
    # ========================================================

    "Rap": [
        "rap",
        "hip hop",
        "hip-hop",
        "hiphop",
        "trap",
        "urban",
        "rnb",
        "r&b",
        "grime",
        "rap music",
        "hip hop music",
    ],

    # ========================================================
    # ELEKTRONİK
    # ========================================================

    "Elektronik": [
        "electronic",
        "edm",
        "dance",
        "dance music",
        "techno",
        "house",
        "deep house",
        "progressive house",
        "trance",
        "electro",
        "electro house",
        "drum and bass",
        "drum & bass",
        "dnb",
        "breakbeat",
        "hardstyle",
        "minimal",
        "downtempo",
    ],

    # ========================================================
    # JAZZ
    # ========================================================

    "Jazz": [
        "jazz",
        "smooth jazz",
        "jazz fusion",
        "fusion jazz",
        "acid jazz",
        "jazz blues",
        "blues",
        "soul jazz",
    ],

    # ========================================================
    # CLASSICAL
    # ========================================================

    "Classical": [
        "classical",
        "classic music",
        "classical music",
        "orchestra",
        "orchestral",
        "symphony",
        "symphonic",
        "opera",
        "piano",
        "baroque",
        "romantic classical",
        "chamber music",
    ],

    # ========================================================
    # TÜRK HALK MÜZİĞİ
    # ========================================================

    "Türk Halk": [
        "türk halk",
        "turk halk",
        "türkü",
        "turku",
        "türküler",
        "turkuler",
        "türkü radyo",
        "turku radio",
        "folk turkish",
        "turkish folk",
        "halk müziği",
        "halk muzigi",
        "anadolu",
        "anadolu müziği",
        "anadolu muzigi",
    ],

    # ========================================================
    # TÜRK SANAT MÜZİĞİ
    # ========================================================

    "Türk Sanat": [
        "türk sanat",
        "turk sanat",
        "türk sanat müziği",
        "turk sanat muzigi",
        "sanat müziği",
        "sanat muzigi",
        "turkish classical",
        "turkish art music",
        "fasıl",
        "fasil",
    ],

    # ========================================================
    # 80LER
    # ========================================================

    "80'ler": [
        "80s",
        "80's",
        "80s music",
        "1980s",
        "eighties",
        "80ler",
        "80'ler",
        "80 ler",
    ],

    # ========================================================
    # 90LAR
    # ========================================================

    "90'lar": [
        "90s",
        "90's",
        "90s music",
        "1990s",
        "nineties",
        "90lar",
        "90'lar",
        "90 lar",
    ],

    # ========================================================
    # OLDIES
    # ========================================================

    "Oldies": [
        "oldies",
        "oldies music",
        "old songs",
        "golden oldies",
        "classic hits",
        "retro",
        "retro music",
        "nostalgia",
        "nostalgic",
    ],

    # ========================================================
    # DISCO
    # ========================================================

    "Disco": [
        "disco",
        "funk",
        "funky",
        "funk music",
        "disco funk",
    ],

    # ========================================================
    # LOUNGE / CHILL
    # ========================================================

    "Lounge": [
        "lounge",
        "chillout",
        "chill out",
        "ambient",
        "downtempo",
        "relax",
        "relaxing",
        "coffee",
        "cafe",
        "cocktail",
    ],

    # ========================================================
    # POP
    # ========================================================

    "Pop": [
        "pop",
        "pop music",
        "top 40",
        "top40",
        "hits",
        "hit music",
        "mainstream",
        "top hits",
        "chart",
        "charts",
        "music",
    ],
}


# =========================================================
# YARDIMCI
# =========================================================

def text(value):
    if value is None:
        return ""

    try:
        return str(value).strip()
    except Exception:
        return ""


def norm(value):
    return re.sub(
        r"\s+",
        " ",
        text(value).lower()
    ).strip()


def safe_int(value):
    try:
        return int(value or 0)
    except Exception:
        return 0


def valid_url(url):
    try:
        parsed = urllib.parse.urlparse(text(url))

        return (
            parsed.scheme in ("http", "https")
            and bool(parsed.netloc)
        )

    except Exception:
        return False


def contains_arabic(value):
    value = text(value)

    for char in value:
        code = ord(char)

        if (
            0x0600 <= code <= 0x06FF
            or 0x0750 <= code <= 0x077F
            or 0x08A0 <= code <= 0x08FF
        ):
            return True

    return False


# =========================================================
# ENGEL KONTROLÜ
# =========================================================

def is_blocked(station):
    name = norm(station.get("name"))
    language = norm(station.get("language"))
    country = norm(station.get("country"))
    tags = norm(station.get("tags"))
    genre = norm(station.get("genre"))

    combined = " ".join([
        name,
        language,
        country,
        tags,
        genre
    ])

    if contains_arabic(combined):
        return True

    if language in BLOCKED_LANGUAGES:
        return True

    if country in BLOCKED_COUNTRIES:
        return True

    for word in BLOCKED_WORDS:
        if norm(word) in combined:
            return True

    return False


# =========================================================
# TÜRKÇE TESPİT
# =========================================================

def is_turkish(station):
    language = norm(station.get("language"))
    country = norm(station.get("country"))
    state = norm(station.get("state"))
    tags = norm(station.get("tags"))
    name = norm(station.get("name"))
    homepage = norm(station.get("homepage"))

    # En güçlü sinyaller
    if language in TURKISH_LANGUAGES:
        return True

    if country in TURKEY_COUNTRIES:
        return True

    if "turkish" in language:
        return True

    if "türkçe" in language:
        return True

    if "turkish" in tags:
        return True

    if "türkçe" in tags:
        return True

    # Türkiye şehirleri
    location_text = " ".join([
        name,
        state,
        tags,
        homepage
    ])

    for city in TURKISH_CITIES:
        if city in location_text:
            return True

    # Türk radyo isimlerinde sık görülen ifadeler
    indicators = [
        "radyo",
        "radyo ",
        "türkçe",
        "turkce",
        "türk fm",
        "turk fm",
        "türk rady",
        "istanbul fm",
        "ankara fm",
        "izmir fm",
    ]

    for indicator in indicators:
        if indicator in name:
            return True

    return False


# =========================================================
# TÜR TESPİT
# =========================================================

def detect_music_genre(station):
    name = norm(station.get("name"))
    tags = norm(station.get("tags"))
    genre = norm(station.get("genre"))
    homepage = norm(station.get("homepage"))

    combined = " ".join([
        name,
        tags,
        genre,
        homepage
    ])

    # Özel türler önce.
    # Böylece Jazz -> Slow gibi yanlış eşleşmeler azalır.

    priority = [
        "Arabesk",
        "Türk Sanat",
        "Türk Halk",
        "90'lar",
        "80'ler",
        "Oldies",
        "Disco",
        "Rap",
        "Rock",
        "Jazz",
        "Classical",
        "Elektronik",
        "Lounge",
        "Slow",
        "Pop",
    ]

    for category in priority:
        for keyword in GENRE_RULES[category]:

            if keyword in combined:
                return category

    # Tür bilgisi yoksa Türkçe radyoyu Pop'a koy.
    return "Pop"


# =========================================================
# TEMİZLE
# =========================================================

def clean_station(raw):
    if not isinstance(raw, dict):
        return None

    name = text(raw.get("name"))

    url = (
        text(raw.get("url_resolved"))
        or text(raw.get("url"))
    )

    if not name:
        return None

    if not valid_url(url):
        return None

    if is_blocked(raw):
        return None

    bitrate = safe_int(
        raw.get("bitrate")
    )

    if bitrate > 0 and bitrate < MIN_BITRATE:
        return None

    turkish = is_turkish(raw)

    return {
        "name": name,
        "url": url,
        "url_resolved": url,

        "genre": detect_music_genre(raw),

        "language": (
            "Turkish"
            if turkish
            else "English"
        ),

        "country": text(
            raw.get("country")
        ),

        "quality": (
            f"{bitrate} kbps"
            if bitrate > 0
            else "LIVE"
        ),

        "bitrate": bitrate,

        "votes": safe_int(
            raw.get("votes")
        ),

        "song": "Canlı yayın",

        "codec": text(
            raw.get("codec")
        ),

        "homepage": text(
            raw.get("homepage")
        ),
    }


# =========================================================
# API
# =========================================================

def api_request(params):
    query = urllib.parse.urlencode(params)

    url = API_BASE + "?" + query

    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/json",
        }
    )

    try:
        with urllib.request.urlopen(
            request,
            timeout=20
        ) as response:

            raw = response.read()

        data = json.loads(
            raw.decode("utf-8")
        )

        if isinstance(data, list):
            return data

    except Exception as error:
        print(
            "[API] Hata:",
            error
        )

    return []


def fetch_turkey_pool():
    all_results = []

    queries = [
        {
            "country": "Turkey",
            "hidebroken": "true",
            "order": "votes",
            "reverse": "true",
            "limit": "250",
        },

        {
            "countrycode": "TR",
            "hidebroken": "true",
            "order": "votes",
            "reverse": "true",
            "limit": "250",
        },

        {
            "language": "Turkish",
            "hidebroken": "true",
            "order": "votes",
            "reverse": "true",
            "limit": "250",
        },

        {
            "tag": "Turkish",
            "hidebroken": "true",
            "order": "votes",
            "reverse": "true",
            "limit": "250",
        },
    ]

    for params in queries:

        results = api_request(params)

        all_results.extend(results)

        # API'yi gereksiz yere boğmayalım.
        time.sleep(0.25)

    return all_results


def fetch_foreign():
    result = []

    for wanted in FOREIGN_STATIONS:

        data = api_request({
            "name": wanted,
            "hidebroken": "true",
            "order": "votes",
            "reverse": "true",
            "limit": "5",
        })

        for raw in data:

            station = clean_station(raw)

            if station is None:
                continue

            name = norm(
                station["name"]
            )

            if name == norm(wanted):
                result.append(station)

        time.sleep(0.15)

    return result


# =========================================================
# DUPLICATE
# =========================================================

def deduplicate(stations):
    result = []

    seen_urls = set()
    seen_names = set()

    for station in stations:

        url = norm(
            station.get("url")
        )

        name = norm(
            station.get("name")
        )

        if not url:
            continue

        if url in seen_urls:
            continue

        if name and name in seen_names:
            continue

        seen_urls.add(url)

        if name:
            seen_names.add(name)

        result.append(station)

    return result


# =========================================================
# SIRALAMA
# =========================================================

def sort_stations(stations):
    def score(station):

        turkish = (
            station.get("language")
            == "Turkish"
        )

        votes = safe_int(
            station.get("votes")
        )

        bitrate = safe_int(
            station.get("bitrate")
        )

        return (
            0 if turkish else 1,
            -votes,
            -bitrate,
            norm(
                station.get("name")
            ),
        )

    return sorted(
        stations,
        key=score
    )


# =========================================================
# MEVCUT LİSTE
# =========================================================

def load_existing():
    try:

        if not os.path.exists(
            STATIONS_FILE
        ):
            return []

        with open(
            STATIONS_FILE,
            "r",
            encoding="utf-8"
        ) as f:

            data = json.load(f)

        if isinstance(data, list):
            return data

    except Exception as error:

        print(
            "[LOAD] Hata:",
            error
        )

    return []


# =========================================================
# GÜVENLİ KAYDET
# =========================================================

def save_safe(stations):

    temp_path = None

    try:

        # Eski dosyayı yedekle.
        if os.path.exists(
            STATIONS_FILE
        ):

            shutil.copy2(
                STATIONS_FILE,
                BACKUP_FILE
            )

        fd, temp_path = tempfile.mkstemp(
            suffix=".json",
            dir=BASE_DIR
        )

        with os.fdopen(
            fd,
            "w",
            encoding="utf-8"
        ) as f:

            json.dump(
                stations,
                f,
                ensure_ascii=False,
                indent=2
            )

            f.flush()
            os.fsync(f.fileno())

        os.replace(
            temp_path,
            STATIONS_FILE
        )

        return True

    except Exception as error:

        print(
            "[SAVE] Hata:",
            error
        )

        if temp_path:
            try:

                if os.path.exists(
                    temp_path
                ):
                    os.remove(
                        temp_path
                    )

            except Exception:
                pass

        return False


# =========================================================
# UPDATE
# =========================================================

def update_stations():

    print()
    print("========================================")
    print("       RADIO STATION UPDATER 0.8")
    print("========================================")
    print()

    old = load_existing()

    print(
        "[INFO] Mevcut kayıt:",
        len(old)
    )

    # -----------------------------------------------------
    # TÜRKİYE HAVUZU
    # -----------------------------------------------------

    print()
    print(
        "[1/6] Türkiye radyo havuzu çekiliyor..."
    )

    turkey_raw = fetch_turkey_pool()

    print(
        "[INFO] Ham sonuç:",
        len(turkey_raw)
    )

    # -----------------------------------------------------
    # TÜRKÇE AYIKLA
    # -----------------------------------------------------

    print()
    print(
        "[2/6] Türkçe radyolar ayıklanıyor..."
    )

    turkish = []

    for raw in turkey_raw:

        if is_blocked(raw):
            continue

        station = clean_station(raw)

        if station is None:
            continue

        if station["language"] != "Turkish":
            continue

        turkish.append(station)

    turkish = deduplicate(turkish)
    turkish = sort_stations(turkish)

    print()
    print(
        "[2b/6] Türkçe yayınların canlılığı kontrol ediliyor..."
    )

    # Sadece ihtiyacımız olan miktarın birkaç katını test ederek
    # zaman kazanıyoruz; en oylanmış/adaylar zaten baştadır.
    turkish = filter_alive_safe(
        turkish[: MAX_TURKISH * STREAM_CHECK_BUFFER]
    )

    turkish = sort_stations(turkish)

    # Türkçe radyoları önce tut.
    turkish = turkish[:MAX_TURKISH]

    print(
        "[INFO] Türkçe radyolar (canlı, dogrulanmış):",
        len(turkish)
    )

    # -----------------------------------------------------
    # YABANCI
    # -----------------------------------------------------

    print()
    print(
        "[3/6] Seçilmiş yabancı radyolar..."
    )

    foreign = fetch_foreign()

    foreign = deduplicate(
        foreign
    )

    foreign = sort_stations(
        foreign
    )

    foreign = filter_alive_safe(
        foreign[: MAX_FOREIGN * STREAM_CHECK_BUFFER]
    )

    foreign = sort_stations(foreign)

    foreign = foreign[:MAX_FOREIGN]

    print(
        "[INFO] Yabancı radyolar (canlı, dogrulanmış):",
        len(foreign)
    )

    # -----------------------------------------------------
    # BİRLEŞTİR
    # -----------------------------------------------------

    print()
    print(
        "[4/6] Liste birleştiriliyor..."
    )

    stations = deduplicate(
        turkish + foreign
    )

    stations = sort_stations(
        stations
    )

    # -----------------------------------------------------
    # GÜVENLİK KONTROLÜ
    # -----------------------------------------------------

    print()
    print(
        "[5/6] Güvenlik kontrolleri..."
    )

    if len(turkish) < 5:

        print()
        print(
            "[GUARD] Yeterli Türkçe radyo bulunamadı!"
        )

        print(
            "[GUARD] stations.json DEĞİŞTİRİLMEYECEK."
        )

        print(
            "[GUARD] Mevcut liste korunuyor."
        )

        return {
            "success": False,
            "updated": False,
            "total": len(old),
            "message": (
                "Yeterli Türkçe radyo "
                "bulunamadı."
            ),
        }

    if len(stations) < 10:

        print(
            "[GUARD] Toplam radyo sayısı çok düşük."
        )

        print(
            "[GUARD] Mevcut liste korunuyor."
        )

        return {
            "success": False,
            "updated": False,
            "total": len(old),
            "message": (
                "Toplam radyo sayısı "
                "güvenlik sınırının altında."
            ),
        }

    # -----------------------------------------------------
    # SAVE
    # -----------------------------------------------------

    print()
    print(
        "[6/6] stations.json kaydediliyor..."
    )

    if not save_safe(stations):

        return {
            "success": False,
            "updated": False,
            "total": len(old),
            "message": (
                "stations.json "
                "kaydedilemedi."
            ),
        }

    old_urls = {
        norm(x.get("url"))
        for x in old
        if isinstance(x, dict)
    }

    new_urls = {
        norm(x.get("url"))
        for x in stations
    }

    new_count = len(
        new_urls - old_urls
    )

    removed_count = len(
        old_urls - new_urls
    )

    print()
    print("========================================")
    print("                SONUÇ")
    print("========================================")

    print(
        f"Toplam radyolar : {len(stations)}"
    )

    print(
        f"Türkçe          : {len(turkish)}"
    )

    print(
        f"Yabancı         : {len(foreign)}"
    )

    print(
        f"Yeni             : {new_count}"
    )

    print(
        f"Silinen          : {removed_count}"
    )

    print("========================================")

    return {
        "success": True,
        "updated": True,
        "total": len(stations),
        "turkish": len(turkish),
        "foreign": len(foreign),
        "new_count": new_count,
        "removed_count": removed_count,
        "message": "Liste başarıyla güncellendi.",
    }


# =========================================================
# MAIN
# =========================================================

if __name__ == "__main__":

    result = update_stations()

    print()

    print(
        json.dumps(
            result,
            ensure_ascii=False,
            indent=2
        )
    )


