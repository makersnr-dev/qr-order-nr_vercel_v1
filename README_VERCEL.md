# QR Order API — Vercel Edition

This folder is ready to deploy the **API + Kiosk UI** on **Vercel** (Express mode). UI HTML stays the same.

## What changed vs Render?
- No code changes required. We just added a small `vercel.json` and this README.
- Static files are served by Vercel from the `/public` folder (Express' `express.static()` is ignored on Vercel; direct file reads like `res.sendFile(...)` still work, but static URLs like `/success.html` are best).

## Environment variables (set these in Vercel → Project → Settings → Environment Variables)
- `ADMIN_PASSWORD` — Admin login password (default: `admin1234`)
- `ALLOWED_ORIGINS` — Comma-separated allowlist for CORS (e.g., `https://your-admin.vercel.app,https://your-api.vercel.app`)
- `TOSS_CLIENT_KEY` — Toss Payments test/live client key (optional if you don't use Toss widget on this domain)
- `CODE_SECRET` — Secret used for daily code feature (any random string)

## Deploy (two options)

### A) GitHub flow (recommended)
1. Push this folder to a GitHub repo (e.g., `qrorder-api`).
2. On Vercel dashboard → **Add New… → Project** → import the repo.
3. Framework is detected automatically as **Express on Vercel**.
4. Add the environment variables above.
5. **Deploy**.

### B) Vercel CLI (zip import)
1. Install CLI: `npm i -g vercel` (aka `vc`).
2. `vc login`
3. `vc deploy` from this folder and follow prompts.

## Routes
- `GET /` → `public/index.html` (kiosk UI)
- `GET /menu`, `POST /orders`, `GET /orders`, `PATCH /orders/:id`, etc. — same as before
- `GET /events/orders` — SSE stream for live order updates
- `GET /payment/success` → `public/success.html`
- `GET /payment/fail` → `public/fail.html`

## Notes for Vercel limits
- **SSE** works on Vercel, but on Hobby plan the non-streaming function timeout is ~10s. Our SSE endpoint uses streaming; if you see disconnects, consider a simple polling fallback (e.g., `/orders` every 5–10s).
- **Uploads (multer)**: request body size is limited (~4.5 MB for serverless). Keep Excel imports small. For larger files, use Vercel Blob / S3 and import server-side.
- Static assets must sit under `/public`.

## Local dev
```bash
npm i
node server.js
# open http://localhost:3001
```
