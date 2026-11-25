# Nebulix compute node

Runs **real Android devices** (Nebulix Android) and **Linux virtual machines** (Nebulix Cloud PC) on a server that is
*not* the Nebulix web server.

```
Browser ──(create / start / stop, tickets)──▶ Nebulix server (Fly.io) ──(HMAC-signed control API)──▶ compute node
Browser ◀──────────────(WebSocket: H.264 video + touch/keys/clipboard, short-lived ticket)───────────────── compute node
```

* Devices are the **official Android Emulator** with **AOSP x86_64 system images** (Android 5 – 16), accelerated with KVM.
  There is **no Google Play** and no Google apps (that needs Google's licence and certification); apps are installed
  from APK files.
* The screen is streamed by [scrcpy](https://github.com/Genymobile/scrcpy)'s server (Apache-2.0) running inside the
  device: H.264 packets are relayed unchanged and decoded in the browser with WebCodecs. Fly.io never carries video.
* Features: create/delete, phone / tablet / compact profiles, CPU, RAM and storage per device, start/stop/restart with
  quick-boot (stopping saves where you left off), named snapshots (save / restore / delete), APK install (drag and
  drop), installed apps (open, force stop, uninstall), file transfer with the device's Download folder, screenshots,
  screen recording (up to 3 min), clipboard both ways, GPS location, rotation, resolution/density, `adb shell`
  commands, logcat, several devices at once, automatic stop of idle devices.

## Cloud PC (virtual machines)

* Needs `qemu-system-x86_64` (QEMU 7.1+). `qemu-img` is used when installed; otherwise disks are created through QEMU
  itself.
* Put system images in `NX_VM_IMAGES` (default `./vm-images`): `*.qcow2` ready-made disks (each machine gets a
  copy-on-write disk on top) and `*.iso` installers / live systems (the machine gets an empty disk). Optional display
  names in `images.json`, e.g. `{ "debian-12.qcow2": { "name": "Debian 12" } }`.
  Example: `curl -L -o vm-images/debian-12.qcow2 https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-nocloud-amd64.qcow2`
  (log in as `root` with no password — change it right away).
* The screen is QEMU's VNC server bound to 127.0.0.1, relayed to the browser over the agent's WebSocket (`/v1/vnc`)
  with a ticket; the browser draws it with noVNC. Power, keys, screenshots and snapshots go through QMP.
* Windows guests are possible only with your own valid licence and installation media.

## Requirements

* Linux x86_64 with **KVM** (`/dev/kvm`): a bare-metal server or a VM with nested virtualisation. Fly.io machines
  cannot do this, which is why this is a separate service.
* Node.js 18+. About 1 GB of disk per Android version plus 2–16 GB per device. Roughly 1 CPU core and 2–3 GB RAM per
  running device.
* A public **HTTPS** address (browsers block `ws://` from an `https://` page): put the agent behind Caddy / nginx /
  Cloudflare Tunnel.

## Run

```sh
git clone https://github.com/VIcStyless/nebulix && cd nebulix/services/compute-node
./setup.sh 34 30                     # Android 14 and 11 — any of 21…36
export NX_NODE_SECRET=$(openssl rand -hex 32)   # keep it: you paste it into Nebulix → Admin → Compute
export NX_ALLOWED_ORIGINS=https://nebulix.fly.dev
node agent.js
```

Then in Nebulix: **Admin → Compute → Connect a compute node** with the node's HTTPS address and the secret.

| Variable | Default | Meaning |
|---|---|---|
| `NX_NODE_SECRET` | — (required, ≥ 32 chars) | Shared with the Nebulix server; signs control calls and browser tickets |
| `NX_NODE_PORT` / `NX_NODE_HOST` | `8790` / `0.0.0.0` | Where the agent listens |
| `NX_ALLOWED_ORIGINS` | `https://nebulix.fly.dev` | Comma-separated sites allowed to open streams / uploads |
| `NX_MAX_RUNNING` | half the CPU cores | Devices running at the same time |
| `NX_MAX_DEVICES` | `50` | Devices stored on this node |
| `NX_IDLE_MINUTES` | `30` | Stop a running device nobody has watched for this long |
| `NX_SDK`, `NX_DATA`, `NX_SCRCPY` | `./sdk`, `./data`, `./scrcpy-server.jar` | Paths |
| `NX_VM_IMAGES`, `NX_QEMU`, `NX_QEMU_IMG` | `./vm-images`, `qemu-system-x86_64`, `qemu-img` | Cloud PC images and binaries |
| `NX_GPU` | `swiftshader_indirect` | Emulator GPU mode (`host` on servers with a GPU) |

## Security

* Control calls must carry `Authorization: NX <ts>.<HMAC-SHA256(secret, ts \n METHOD \n path \n sha256(body))>`,
  valid for 2 minutes. Browser calls need a ticket (HMAC-signed, 10 minutes, bound to one device and its owner).
* Each device is a full virtual machine (KVM); `adb shell` commands run inside the device, never on the host. Host
  commands are always run with argument arrays (no shell).
* Uploads are size-limited (APK 500 MB, files 200 MB); APKs must be ZIP files and are installed with `adb install`.
