# Production image for the ROFT LMS.
#
# Multi-stage so the shipped image contains the built application and its
# runtime dependencies only — no source, no build tooling, no dev packages.
#
# Builds on both x86 and ARM64. That matters: the cheap South African hosting
# worth having is Ampere ARM, and an image that only builds on x86 quietly
# removes those options later.

# ---------------------------------------------------------------- dependencies
FROM node:24-alpine AS deps
WORKDIR /app

# Copied on their own so this layer is cached until the manifests change,
# rather than on every source edit.
COPY package.json package-lock.json ./
RUN npm ci

# ----------------------------------------------------------------------- build
FROM node:24-alpine AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Next.js emits a self-contained server under .next/standalone.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ----------------------------------------------------------------------- tools
# Migrations, seeding, backups and the notification job.
#
# These need the source, the dev dependencies and the scripts directory, none
# of which belong in the image that faces the internet. Keeping them in a
# separate one-shot container means the running application stays minimal while
# the operational commands still work — the alternative, discovered the hard
# way, is a runtime image where `npx drizzle-kit` simply is not there.
FROM node:24-alpine AS tools
WORKDIR /app

RUN apk add --no-cache postgresql18-client openssl bash aws-cli

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NODE_ENV=production
CMD ["sh"]

# --------------------------------------------------------------------- runtime
FROM node:24-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

# Next's standalone server binds to $HOSTNAME, and Docker sets that to the
# container ID. The server then listens on one interface only: not on
# 127.0.0.1, so the health check below can never pass, and the container is
# reported unhealthy while actually serving traffic perfectly well.
ENV HOSTNAME=0.0.0.0

# Runs unprivileged. A container process that does not need root should not
# have it, and Node needs nothing here that does.
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 --ingroup nodejs nextjs

COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

# Evidence uploads live here; the compose file mounts a volume over it so they
# survive a redeploy.
RUN mkdir -p /app/storage && chown nextjs:nodejs /app/storage

USER nextjs
EXPOSE 3000

# The health endpoint queries the database, so an unhealthy container means
# something a restart might actually fix.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
