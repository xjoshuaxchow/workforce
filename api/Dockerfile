FROM node:26-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates libgomp1 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY sql ./sql
COPY scripts ./scripts
RUN mkdir -p /app/.local && chown -R node:node /app
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8310
EXPOSE 8310
CMD ["node","src/index.js"]
