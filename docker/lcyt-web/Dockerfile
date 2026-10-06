# lcyt-web: the built web UI bundle, for the LCYT backend to serve (STATIC_DIR). The image only copies the bundle
# into the /out volume on start, so a compose stack can share it with the backend container:
#   volumes: [web:/out]   (this container)   and   [web:/srv/web:ro] + STATIC_DIR=/srv/web   (backend)
# It exits right after the copy (exit code 0); with `restart: "no"` and `depends_on: service_completed_successfully`
# in compose that is the expected state.
# Build from the repository root:  docker build -f docker/lcyt-web/Dockerfile -t lcyt-web .
# Published by .github/workflows/publish-images.yml as ghcr.io/jsilvanus/lcyt-web.
FROM node:22-slim AS build
WORKDIR /app
COPY . .
RUN npm ci --workspace=packages/lcyt --workspace=packages/lcyt-web --include-workspace-root \
 && npm run build:web

FROM busybox
COPY --from=build /app/packages/lcyt-web/dist /dist
CMD ["sh", "-c", "rm -rf /out/* && cp -r /dist/. /out/ && echo \"lcyt-web: copied $(find /dist -type f | wc -l) files to /out, done (this container is meant to exit)\""]
