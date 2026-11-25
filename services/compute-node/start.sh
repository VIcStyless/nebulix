#!/bin/sh
# First boot: fetch the system images onto the volume, then run the agent.
set -e
mkdir -p "$NX_DATA" "$NX_VM_IMAGES"
cd "$NX_VM_IMAGES"
[ -s debian-12.qcow2 ] || { echo "[compute] downloading Debian 12"; curl -fL -o debian-12.qcow2.part https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-nocloud-amd64.qcow2 && mv debian-12.qcow2.part debian-12.qcow2; }
[ -s alpine-virt.iso ] || { echo "[compute] downloading Alpine"; curl -fL -o alpine-virt.iso.part https://dl-cdn.alpinelinux.org/alpine/v3.20/releases/x86_64/alpine-virt-3.20.3-x86_64.iso && mv alpine-virt.iso.part alpine-virt.iso; }
[ -f images.json ] || echo '{ "debian-12.qcow2": { "name": "Debian 12" }, "alpine-virt.iso": { "name": "Alpine Linux 3.20" } }' > images.json
exec node /app/services/compute-node/agent.js
