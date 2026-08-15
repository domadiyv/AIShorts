# syntax=docker/dockerfile:1
#
# Single Linux image for the AIShorts backend. The api and worker run straight
# from source via tsx (no compile step); the shared package is compiled to dist
# and the Prisma client is generated at build time. docker-compose picks the
# per-service command (api / worker / migrate / admin).
FROM node:20-bookworm-slim AS app

# Prisma needs openssl at runtime; ca-certificates for outbound HTTPS (LLM, media).
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install workspace deps (apps/mobile is not a workspace and is .dockerignored).
COPY . .
RUN npm ci

# Generate the Prisma client and compile @aishorts/shared (its main is dist/index.js,
# which the api/worker/admin import at runtime).
RUN npm run -w @aishorts/shared db:generate \
 && npm run -w @aishorts/shared build

# Stage the bundled seed placeholders OUTSIDE the media volume mount point. At
# runtime the `media` volume mounts over services/api/media and hides these; the
# API copies them back in on startup (ensureSeedMedia + MEDIA_SEED_DIR) so the
# placeholders exist even in a pre-existing/empty volume.
RUN mkdir -p /app/media-seed \
 && cp -r services/api/media/seed/. /app/media-seed/ 2>/dev/null || true
ENV MEDIA_SEED_DIR=/app/media-seed

EXPOSE 4000 4001

# Default command is the API; compose overrides it for worker/migrate/admin.
CMD ["npx", "tsx", "services/api/src/server.ts"]
