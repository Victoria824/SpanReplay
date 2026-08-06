FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/observability-sdk/package.json ./packages/observability-sdk/package.json
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY packages ./packages
RUN npm run build:services

FROM node:22-alpine AS runtime
ARG BUILD_DATE="unknown"
ARG VCS_REF="unknown"
ARG VERSION="0.1.0"
ENV NODE_ENV=production
WORKDIR /app
LABEL org.opencontainers.image.title="SpanReplay services" \
      org.opencontainers.image.description="OpenTelemetry observability and deterministic failure replay for AI agents" \
      org.opencontainers.image.source="https://github.com/Victoria824/SpanReplay" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.created="$BUILD_DATE" \
      org.opencontainers.image.revision="$VCS_REF" \
      org.opencontainers.image.version="$VERSION"
COPY package.json package-lock.json ./
COPY packages/observability-sdk/package.json ./packages/observability-sdk/package.json
COPY --from=build /app/packages/observability-sdk/dist ./packages/observability-sdk/dist
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/data/replays && chown -R node:node /app
USER node
EXPOSE 4000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/src/bin/service.js"]
