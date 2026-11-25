#!/bin/sh
# Downloads what a Nebulix compute node needs next to agent.js (official Google packages + scrcpy server, Apache-2.0).
# Usage: ./setup.sh [api levels...]   e.g. ./setup.sh 34 30   (default: 34 = Android 14)
set -e
cd "$(dirname "$0")"
B=https://dl.google.com/android/repository
EMU=emulator-linux_x64-16970787.zip          # Android Emulator 37.3.10 (stable channel)
PT=platform-tools_r37.0.3-linux.zip          # adb
SCRCPY=3.3.4
mkdir -p sdk dl
[ -d sdk/emulator ] || { curl -fL -o dl/$EMU $B/$EMU && (cd sdk && unzip -q ../dl/$EMU); }
[ -d sdk/platform-tools ] || { curl -fL -o dl/$PT $B/$PT && (cd sdk && unzip -q ../dl/$PT); }
[ -f scrcpy-server.jar ] || curl -fL -o scrcpy-server.jar https://github.com/Genymobile/scrcpy/releases/download/v$SCRCPY/scrcpy-server-v$SCRCPY
LEVELS=${*:-34}
for api in $LEVELS; do
  d=sdk/system-images/android-$api/default
  [ -f $d/x86_64/system.img ] && continue
  # AOSP "default" images (no Google Play). File names come from Google's repository index.
  f=$(curl -fsL $B/sys-img/android/sys-img2-3.xml | tr -d '\n' | grep -o "<remotePackage path=\"system-images;android-$api;default;x86_64\".*" | grep -o 'x86_64-[^<]*\.zip' | grep -v 'windows\|darwin' | head -1)
  [ -n "$f" ] || { echo "No AOSP x86_64 image for API $api"; continue; }
  curl -fL -o dl/$f $B/sys-img/android/$f && mkdir -p $d && (cd $d && unzip -q ../../../../dl/$f)
done
[ -e /dev/kvm ] || echo "WARNING: /dev/kvm is missing — enable hardware virtualisation (KVM); the emulator is unusable without it."
echo "Done. By downloading you accept the Android SDK License Agreement: https://developer.android.com/studio/terms"
