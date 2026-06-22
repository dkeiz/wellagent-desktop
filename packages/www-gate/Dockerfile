FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src
COPY public ./public
COPY README.md ./

ENV WWW_GATE_HOST=0.0.0.0
ENV WWW_GATE_PORT=8080
ENV WWW_GATE_DB=/data/www-gate.sqlite

VOLUME ["/data"]
EXPOSE 8080

CMD ["node", "src/index.js"]
