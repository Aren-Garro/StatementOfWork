# SOW Creator (Local-First)

Production-focused, fee-free Statement of Work creator.

## What this version provides

- Local-first editor with autosave in IndexedDB.
- In-browser markdown rendering (including `:::pricing`, `:::timeline`, `:::signature`, `:::variables`).
- Instant print-to-PDF flow via browser print.
- Optional sharing plugin endpoints for expiring read-only links.

## Quick start

```bash
python -m venv .venv
. .venv/Scripts/activate
pip install -r requirements.txt
python run.py
```

Open `http://localhost:5000`.

## Core architecture

- `templates/editor.html`: single-page app shell.
- `static/js/editor.js`: local-first app logic, IndexedDB storage, markdown renderer, print export.
- `static/css/app.css`: responsive editor and preview styles.
- `app/routes.py`: optional publish plugin APIs and public read-only route.
- `app/models.py`: SQLite schema (`templates`, `published_docs`).

## Optional sharing plugin API

Base path: `/plugin`

- `POST /plugin/v1/publish`
  - Body: `{ "title": "...", "html": "...", "expires_in_days": 30 }`
  - Returns: `publish_id`, `view_url`, `expires_at`
- `GET /plugin/v1/p/<publish_id>`
  - Returns publish metadata.
- `DELETE /plugin/v1/p/<publish_id>`
  - Soft-deletes a publish.
- `GET /plugin/v1/health`
  - Health check.
- Public read-only page: `GET /p/<publish_id>`

## Abuse controls

- Per-IP rate limit on publish endpoint.
- CAPTCHA gate support for high-volume clients.

Set `PUBLISH_CAPTCHA_TOKEN` in env to enable simple token verification. When set, clients above threshold must send `X-Captcha-Token` with this value.

## Environment variables

See `.env.example` for defaults.

## Notes

- Sharing is optional. If no sharing plugin URL is configured in the UI, local editing and PDF export still work fully.
- Existing `/api/*` endpoints remain available for compatibility.
