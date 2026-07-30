FROM node:22-alpine

RUN addgroup -S luckcoin && adduser -S luckcoin -G luckcoin

WORKDIR /app

COPY package.json ./
COPY src ./src
COPY test ./test

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV LUCKCOIN_DIFFICULTY=2

EXPOSE 3000

USER luckcoin

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
