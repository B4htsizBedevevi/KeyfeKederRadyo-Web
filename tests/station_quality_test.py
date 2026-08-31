import requests


API = "https://de1.api.radio-browser.info/json/stations/search"

params = {
    "countrycode": "TR",
    "bitrateMin": 192,
    "hidebroken": "true",
    "is_https": "true",
    "order": "bitrate",
    "reverse": "true",
    "limit": 30,
}

headers = {
    "User-Agent": "RADIO/0.1"
}


print("=" * 70)
print("RADIO - YUKSEK KALITE ISTASYON TESTI")
print("=" * 70)
print()
print("192 kbps ve uzeri")
print("HTTPS stream")
print("Calismayan istasyonlar filtreleniyor")
print()


try:
    response = requests.get(
        API,
        params=params,
        headers=headers,
        timeout=15,
    )

    response.raise_for_status()

    stations = response.json()

except requests.RequestException as error:
    print("API BAGLANTI HATASI:")
    print(error)
    raise SystemExit(1)

print(f"{len(stations)} istasyon bulundu.")
print()

if not stations:
    print("Uygun istasyon bulunamadi.")
    raise SystemExit(0)


for index, station in enumerate(stations, start=1):

    name = station.get("name") or "Bilinmeyen"
    codec = station.get("codec") or "?"
    bitrate = station.get("bitrate") or 0
    country = station.get("country") or "?"
    tags = station.get("tags") or ""
    url = station.get("url_resolved") or station.get("url") or ""

    print(f"[{index}] {name}")
    print(f"    Bitrate : {bitrate} kbps")
    print(f"    Codec   : {codec}")
    print(f"    Ulke    : {country}")
    print(f"    Tur     : {tags[:80]}")
    print(f"    Stream  : {url}")
    print("-" * 70)