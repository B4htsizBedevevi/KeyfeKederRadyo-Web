import os
import sys
import time
import vlc


VLC_PATH = r"C:\Program Files\VideoLAN\VLC"

if not os.path.exists(os.path.join(VLC_PATH, "libvlc.dll")):
    print("HATA: VLC bulunamadi!")
    sys.exit(1)

# VLC DLL klasörünü sisteme tanit
os.add_dll_directory(VLC_PATH)

# VLC plugin klasoru
plugin_path = os.path.join(VLC_PATH, "plugins")

instance = vlc.Instance(
    f"--plugin-path={plugin_path}"
)

player = instance.media_player_new()

# Test yayini
RADIO_URL = "https://stream.radioparadise.com/mp3-192"

media = instance.media_new(RADIO_URL)
player.set_media(media)

print("=" * 50)
print("RADIO AUDIO TEST")
print("=" * 50)
print()
print("Yayin baslatiliyor...")
print("URL:", RADIO_URL)
print()
print("Durdurmak icin CTRL+C")
print()

player.play()

time.sleep(3)

state = player.get_state()

print("VLC STATE:", state)

if state in (
    vlc.State.Playing,
    vlc.State.Buffering,
):
    print()
    print("YAYIN CALISIYOR! ✓")
else:
    print()
    print("Yayin baslamadi.")
    print("VLC State:", state)

try:
    while True:
        time.sleep(1)

except KeyboardInterrupt:
    print()
    print("Yayin durduruluyor...")

finally:
    player.stop()
    print("Test tamamlandi.")