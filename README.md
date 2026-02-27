# SOW Creator (Local-First)

Production-focused, fee-free Statement of Work creator.

## What this version provides

- Local-first editor with autosave in IndexedDB.
- In-browser markdown rendering (including `:::pricing`, `:::timeline`, `:::signature`, `:::variables`).
- Instant print-to-PDF flow via browser print.
- Optional sharing plugin endpoints for expiring read-only links.
- Native signature capture metadata (client + consultant) with signed revision locking.
- Revision history with read-only prior revisions and manual/automatic revision fork.
- Client profiles (local) with variable autofill.
- US clause packs (`US_BASE`, `US_NY`, `US_CA`) and required-section guardrail checks.
- Markdown/JSON import and export for portability.

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
- `static/js/editor.js`: local-first app logic, IndexedDB storage, markdown renderer, signatures, clients, revisions, clause packs.
- `static/css/app.css`: responsive editor, status/guardrail/revision UI, and print styles.
- `app/routes.py`: optional publish plugin APIs and public read-only route.
- `app/models.py`: SQLite schema (`templates`, `published_docs`) for backend-compatible features.

## Optional sharing plugin API

Base path: `/plugin`

- `POST /plugin/v1/publish`
  - Body: `{ "title": "...", "html": "...", "expires_in_days": 30, "revision": 2, "signed": true, "signed_only": true, "jurisdiction": "US_NY" }`
  - Returns: `publish_id`, `view_url`, `expires_at`, `revision`, `signed`, `jurisdiction`, `sanitized`
- `GET /plugin/v1/p/<publish_id>`
  - Returns publish metadata.
- `DELETE /plugin/v1/p/<publish_id>`
  - Soft-deletes a publish.
- `GET /plugin/v1/health`
  - Health check.
- `POST /plugin/v1/health/check`
  - Connectivity check for client configuration.
- `POST /plugin/v1/cleanup`
  - Marks expired published documents as deleted.
  - Returns: `cleaned`, `scanned`, `timestamp`
- Public read-only page: `GET /p/<publish_id>`

## Abuse controls

- Per-IP rate limit on publish endpoint.
- CAPTCHA gate support for high-volume clients.

Set `PUBLISH_CAPTCHA_TOKEN` in env to enable simple token verification. When set, clients above threshold must send `X-Captcha-Token` with this value.

Set `TRUST_PROXY_HOPS` (default `0`) only when running behind trusted reverse proxies so Flask can safely resolve client IPs from forwarding headers.

## Environment variables

See `.env.example` for defaults.

## Development hooks

```bash
python -m pip install pre-commit
pre-commit install
pre-commit run --all-files
```

## Notes

- Sharing is optional. If no sharing plugin URL is configured in the UI, local editing and PDF export still work fully.
- Existing `/api/*` endpoints remain available for compatibility.

## Legacy Template Migration

Export legacy SQLite templates into importable local-first JSON packages:

```bash
python scripts/export_legacy_templates.py --db data/sow.db --out legacy_templates.json
```

The output contains `packages[]`; import each package in-app via the Import button.

## Test Configuration

`pytest.ini` is configured to run only `tests/`:

- `--cache-clear`
- local cache dir: `.pytest_cache_local`

CI runs pytest with `--basetemp=/tmp/pytest-basetemp` to avoid permission issues in locked workspace folders.

Optional manual browser smoke check:

```bash
npx playwright test tests/e2e/playwright_smoke.mjs
```
