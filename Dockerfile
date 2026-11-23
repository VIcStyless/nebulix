# Same build as the deployed image (reconstructed 1:1 from its build history).
FROM node:24.22.2-alpine3.24
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public
COPY scripts ./scripts
ENV NODE_ENV=production HOST=:: PORT=3000 DATA_DIR=/data TRUST_PROXY=1
EXPOSE 3000
CMD ["sh","-c","if [ -f /data/_import.tgz ]; then tar -xzf /data/_import.tgz -C /data && rm -f /data/_import.tgz && echo '[nebulix] imported data bundle'; fi; exec node server/index.js"]
