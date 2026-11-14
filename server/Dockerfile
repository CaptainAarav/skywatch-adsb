# Skywatch ADS-B server: build with tsc, run on node:22-slim as a non-root user. No runtime dependencies.
# Build context is the REPOSITORY ROOT:  docker build -f server/Dockerfile -t skywatch .
FROM node:22-slim AS build
WORKDIR /repo/server
COPY server/package.json server/tsconfig.json ./
RUN npm install --no-audit --no-fund
COPY server/src ./src
COPY server/test ./test
RUN npx tsc -p tsconfig.json

# `docker build --target test` runs the server's unit and integration tests (used by tools/run-checks.sh)
FROM build AS test
RUN node --test "dist/test/*.test.js"

FROM node:22-slim AS runtime
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data STATIC_DIR=/app/html
WORKDIR /app
COPY --from=build /repo/server/dist/src ./dist
COPY server/package.json ./
COPY html ./html
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
