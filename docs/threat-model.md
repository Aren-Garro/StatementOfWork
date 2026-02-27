# Publish Flow Threat Model

## Scope

This model covers:

- `POST /plugin/v1/publish`
- `GET /p/<publish_id>`
- `POST /plugin/v1/cleanup`
- Supporting rate limit and captcha checks

## Assets

- Published SOW content (`published_docs.html`)
- Signature metadata (`signed`, `revision`, `jurisdiction`)
- Publish IDs and expiring URLs
- Availability of public read endpoints

## Trust boundaries

- Browser/editor client to Flask API boundary
- Reverse proxy boundary (optional, via `TRUST_PROXY_HOPS`)
- SQLite storage boundary

## Primary threats and mitigations

1. Stored XSS in published content
- Threat: attacker stores active HTML/JS and executes in readers' browsers.
- Mitigation: server-side sanitization is always applied before persistence.
- Residual risk: sanitizer is regex-based and should eventually be replaced with a dedicated HTML sanitizer library.

2. Rate-limit bypass through spoofed source IP
- Threat: attacker rotates forged forwarding headers.
- Mitigation: rate limiting uses `request.remote_addr`; forwarded headers are trusted only when `TRUST_PROXY_HOPS > 0` and proxy middleware is enabled.
- Residual risk: misconfigured proxy-hop count can still weaken controls.

3. Abusive publish volume / resource exhaustion
- Threat: repeated publish requests fill storage and degrade service.
- Mitigation: per-IP rate limit window and optional captcha requirement via `PUBLISH_CAPTCHA_TOKEN`.
- Residual risk: in-memory counters reset on restart and are not shared across workers.

4. Invalid or malformed publish/template payloads
- Threat: malformed payload causes 500s or bypasses business constraints.
- Mitigation: explicit request validation for required fields, type checks, revision/jurisdiction constraints, and signed-only enforcement.
- Residual risk: validation is hand-written; schema tooling would reduce drift.

5. Expired link retention
- Threat: expired documents remain accessible longer than expected.
- Mitigation: read route enforces expiry; cleanup endpoint soft-deletes expired rows.
- Residual risk: cleanup is manual/triggered and not yet scheduled as a background job.

## Operational controls

- Structured logs on publish and cleanup events (without document body content).
- CI on Linux/Windows for regression detection.
- Linting and pre-commit hooks for static quality gates.

## Next security steps

1. Replace regex sanitizer with allowlist-based sanitizer.
2. Move rate-limit state to shared storage for multi-worker deployments.
3. Add authn/authz controls for plugin mutation endpoints if exposed beyond trusted local use.
