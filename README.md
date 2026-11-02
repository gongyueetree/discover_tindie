# Tindie Resources — Production System

A real, database-backed Next.js app for the Tindie "Resources" section:

- **Public site**: home (Top 12 daily discoveries), `/archive` (by day), `/directory` (50 curated resources)
- **Admin** (`/admin`, login-protected): discovery inbox → approve/publish, resource directory + broken-link re-verify, source pause/resume, submission moderation, dashboard
- **Auth**: email + password (Auth.js + Drizzle adapter), role-based (`user` / `editor` / `admin`)
- **AI pipeline**: daily Vercel Cron → `runDiscoveryPipeline()` inserts new candidates as `needs_review`. Currently a **mock** with two clearly-marked integration points (real sources + Claude API).
- **Persistence**: real Postgres — saves, comments, submissions, approvals are shared across all users and devices (not localStorage).

## Stack
Next.js 14 (App Router) · Vercel Postgres · Drizzle ORM · Auth.js v5 · Tailwind · Vercel Cron.

---

## Deploy to Vercel (step by step)

### 1. Push to GitHub
Create a repo and push this folder (or upload the files via GitHub's web "Add file → Upload files").

### 2. Import into Vercel
- vercel.com → **Add New… → Project** → import the repo.
- Framework preset: **Next.js** (auto-detected). Leave build settings default.

### 3. Add a database
- In the project → **Storage → Create → Postgres** (Vercel Postgres).
- Vercel automatically injects `POSTGRES_URL` into the project's environment.

### 4. Set environment variables
Project → **Settings → Environment Variables** (see `.env.example`):

| Variable | Value |
|---|---|
| `AUTH_SECRET` | run `openssl rand -base64 32` |
| `CRON_SECRET` | any long random string |
| `SEED_ADMIN_EMAIL` | e.g. `you@yourdomain.com` |
| `SEED_ADMIN_PASSWORD` | a strong password |

(`POSTGRES_URL` is already set by step 3. `ANTHROPIC_API_KEY` only later, when wiring real AI.)

### 5. Create the tables + seed data
Run locally against the production DB (pull the env first), **or** from any machine:

```bash
npm install
# put the Vercel POSTGRES_URL + the vars above into a local .env
npm run db:migrate   # creates all 11 tables
npm run db:seed      # 50 resources, 7 sources, ~12 published + 4 review-queue discoveries, admin user
```

Tip: `vercel env pull .env` copies the project's env vars locally.

### 6. Done
- Public: `https://<project>.vercel.app/`
- Admin: `https://<project>.vercel.app/admin` → redirected to `/login`. Sign in with the seed admin.
- Daily cron is configured in `vercel.json` (05:00 UTC) and calls `/api/cron/discover`.

---

## How the daily pipeline works (and how to make it real)

`src/lib/pipeline.ts` runs on a schedule and:
1. `fetchCandidates()` — **MOCK** today (shuffles a sample pool).
2. `scoreCandidate()` — relevance/novelty/trust scoring.
3. `summarize()` — **MOCK** today (returns canned text).
4. `applyGuardrails()` — diversity caps (≤3 per category, ≤2 per source, target 12).
5. Inserts as `status: 'needs_review'` for one-click human approval in the admin.

**To go live, replace two functions (signatures stay the same):**
- **INTEGRATION POINT 1 — `fetchCandidates()`**: pull from real RSS/API/crawl of each active source. Respect each source's ToS; only use OG/press/repo-licensed images; record `imageLicense`.
- **INTEGRATION POINT 2 — `summarize()`**: call the Anthropic API with `ANTHROPIC_API_KEY` to generate an **original** summary + "why it matters" (the commented example uses `claude-haiku-4-5-20251001`). Never copy source text.

Nothing else needs to change — approvals, archive, and the public feed already read from the DB.

---

## Local development

```bash
npm install
cp .env.example .env   # fill in a local or Vercel POSTGRES_URL + AUTH_SECRET
npm run db:migrate && npm run db:seed
npm run dev            # http://localhost:3000
```

## Roles
- `admin` / `editor` → can open `/admin` and call `/api/admin/*`.
- Everyone else → redirected to `/login`.
Change a user's role directly in the `users` table (`role` column).

## Security notes
- Admin area + admin APIs are enforced in `src/middleware.ts`.
- The cron endpoint requires `Authorization: Bearer $CRON_SECRET` (Vercel Cron sends this automatically when `CRON_SECRET` is set).
- Change the seed admin password after first login.

