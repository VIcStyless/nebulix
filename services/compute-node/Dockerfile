# Nebulix compute node as a container (used for the Fly.io node "nebulix-compute"). Build context: the repo root.
# Fly machines have no /dev/kvm, so this node runs Cloud PC machines with QEMU software emulation (TCG); Nebulix
# Android needs a KVM host (see README.md) and is not installed here.
FROM node:24.22.2-bookworm-slim
# ovmf + swtpm: UEFI firmware and TPM 2.0 for Windows guests (Windows itself is never included: the owner adds an ISO)
RUN apt-get update && apt-get install -y --no-install-recommends qemu-system-x86 qemu-utils ovmf swtpm ca-certificates curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY server/ws.js ./server/ws.js
COPY services/compute-node/agent.js services/compute-node/start.sh ./services/compute-node/
ENV NX_DATA=/data/node NX_VM_IMAGES=/data/vm-images NX_NODE_PORT=8790 NX_NODE_HOST=::
EXPOSE 8790
CMD ["sh", "/app/services/compute-node/start.sh"]
