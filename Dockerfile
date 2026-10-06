# syntax=docker/dockerfile:1
# One image for the API (which also serves the built web app), the worker and the
# one-shot database jobs (bootstrap, migrate, development seed). The container
# command selects the process: see infra/compose.yaml and docs/OPERATIONS.md.
ARG NODE_IMAGE=node:24.21.0-alpine

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY . .
# Optional build secret `extra_ca`: CA bundle for a TLS-intercepting proxy (never stored in a layer).
RUN --mount=type=secret,id=extra_ca \
    if [ -s /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi \
 && npm ci --no-audit --no-fund \
 && npm run build \
 && npm prune --omit=dev --no-audit --no-fund \
 && mkdir -p /out/apps/web \
 && for d in packages/* apps/api apps/worker; do \
      mkdir -p "/out/$d" && cp "$d/package.json" "/out/$d/" && cp -r "$d/dist" "/out/$d/"; \
    done \
 && cp -r packages/database/migrations /out/packages/database/ \
 && cp apps/web/package.json /out/apps/web/ && cp -r apps/web/dist /out/apps/web/dist \
 && cp package.json package-lock.json /out/ \
 && cp -r node_modules /out/node_modules

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    WEB_DIST_DIR=/app/apps/web/dist
WORKDIR /app
COPY --from=build /out/ ./
USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/src/main.js"]
