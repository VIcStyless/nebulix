#!/bin/sh
# Downloads the free, open-source OS images used by the virtual machines (they are too big for git).
# Licenses and sources: public/vm/SOURCES.txt
set -e
cd "$(dirname "$0")/../public/vm"
for f in linux4.iso freedos722.img kolibri.img dsl-4.11.rc2.iso openbsd-floppy.img oberon.img; do
  [ -f "$f" ] || { echo "Downloading $f"; curl -fL -o "$f" "https://i.copy.sh/$f"; }
done
echo "Done. Android-x86 lives on the data volume: DATA_DIR/vm/android-x86-4.4-r5.iso"
echo "  curl -fL -o \"\$DATA_DIR/vm/android-x86-4.4-r5.iso\" https://sourceforge.net/projects/android-x86/files/Release%204.4/android-x86-4.4-r5.iso/download"
echo "  sha1: 4c0edceef12bf4b8afb1b8390d94a9af29bbbca8"
