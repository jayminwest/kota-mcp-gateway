FROM mirror.gcr.io/library/node:20-slim AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

FROM mirror.gcr.io/library/node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8084
COPY --from=builder /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/.env.example ./
COPY --from=builder /app/README.md ./

EXPOSE 8084
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD node scripts/health-check.js || exit 1
CMD ["node", "dist/index.js"]
