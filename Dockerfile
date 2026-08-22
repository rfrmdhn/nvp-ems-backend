# syntax=docker/dockerfile:1
#
# Multi-stage build: deps -> build -> runtime. All four compose services
# (migrate/api/worker all share this one image; postgres/redis use official
# images) are built from this single Dockerfile — see docker-compose.yml and
# EMS-BACKEND-PLAN.md §10.
#
# Note: the runtime stage intentionally keeps ALL dependencies (not just
# production ones), because the one-shot `migrate` service needs the `prisma`
# CLI and `ts-node` (both devDependencies, used to run `prisma migrate deploy`
# and `prisma db seed` -> `ts-node prisma/seed.ts`) available with zero
# network access at container startup. Trading a larger image for a
# guaranteed-to-work `docker compose up --build` is the right tradeoff for
# this technical test.

##### ---- deps: install all dependencies (Prisma client generates via postinstall) ----
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

##### ---- build: compile TypeScript (nest build) ---------------------------
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

##### ---- runtime: final image used by migrate/api/worker services --------
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY prisma ./prisma
COPY package.json ./package.json
COPY tsconfig.json ./tsconfig.json

# Upload scratch space for the CSV import endpoint's disk storage (§8).
RUN mkdir -p uploads

EXPOSE 3000

# docker-compose overrides `command:` per service:
#   migrate -> sh -c "npx prisma migrate deploy && npx prisma db seed"
#   api     -> node dist/main.js
#   worker  -> node dist/worker.js
CMD ["node", "dist/main.js"]
