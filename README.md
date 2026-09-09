# Fixly

Fixly is a local-services marketplace connecting customers with service providers.

## Monorepo Apps

- `apps/web` - Next.js frontend (customer, provider, and admin views)
- `apps/api` - NestJS API with auth, requests, offers, bookings, payments, conversations, reviews, reports, and notifications
- `apps/worker` - BullMQ workers for async jobs (email, notifications, cleanup)
- `packages/database` - Prisma schema, migrations, client, and seed
- `packages/config` - shared environment validation

## Core Features

- Cookie-based authentication with refresh sessions
- Argon2id password hashing
- Service catalog and request lifecycle
- Provider offers and transactional acceptance
- Booking lifecycle transitions
- Stripe payment intent flow with webhook handling
- Realtime messaging (Socket.IO + Redis adapter)
- Reviews and provider rating aggregation
- Reports and admin moderation actions
- Request attachments (local storage in development)

## Tech Stack

- Next.js 16, React 19, TanStack Query
- NestJS 12
- Prisma + PostgreSQL
- Redis + BullMQ
- Stripe
- pnpm workspaces

## Quick Start

1. Install dependencies:

   `pnpm install`

2. Create environment file:

   `cp .env.example .env`

3. Start infrastructure:

   `docker compose up -d`

4. Generate client, migrate, seed:

   `pnpm db:generate`
   `pnpm db:migrate`
   `pnpm db:seed`

5. Start all apps:

   `pnpm dev`

## Useful Scripts

- `pnpm dev` - run web, api, worker in parallel
- `pnpm build` - build all packages/apps
- `pnpm typecheck` - typecheck all packages/apps
- `pnpm lint` - lint all packages/apps
- `pnpm test` - run all available tests

## Seed Accounts

After running `pnpm db:seed`:

- Admin: `admin@fixly.test` / `Password123!`
- Customer: `customer@fixly.test` / `Password123!`
- Provider: `provider@fixly.test` / `Password123!`

## Notes

- Stripe routes require `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`.
- Without Stripe in development, API supports a development payment confirmation route.
