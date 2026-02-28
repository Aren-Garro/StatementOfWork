# SOW Creator (Local-First)

**A production-focused, fee-free Statement of Work creator that rivals $200-$600/year commercial alternatives.**

## Why Choose This Over Paid Alternatives?

Commercial SOW and proposal software like PandaDoc ($228-$588/year per user), Dropbox Sign ($180-$300/year per user), and Upland Qvidian (enterprise pricing) charge hundreds to thousands annually for features you get here for **$0**[cite:1][web:21][web:25][web:26][web:27][web:30].

### Cost Comparison

| Feature | This Tool | PandaDoc Business | Dropbox Sign Standard | Upland Qvidian |
|---------|-----------|-------------------|----------------------|----------------|
| **Price** | **FREE** | $588/year/user | $300/year/user | Enterprise only |
| Document templates | ✅ Unlimited | ✅ Unlimited | ✅ 15 templates | ✅ Enterprise |
| E-signatures | ✅ Native capture | ✅ Included | ✅ Unlimited | ✅ Included |
| Local-first editing | ✅ Full offline | ❌ Cloud only | ❌ Cloud only | ❌ Cloud only |
| Revision history | ✅ Built-in | ✅ Included | ⚠️ Limited | ✅ Enterprise |
| Export to PDF | ✅ Browser print | ✅ Included | ✅ Included | ✅ Included |
| Custom branding | ✅ Full control | ⚠️ Business+ only | ⚠️ Standard+ only | ✅ Enterprise |
| Data ownership | ✅ 100% yours | ❌ Cloud vendor | ❌ Cloud vendor | ❌ Cloud vendor |
| API/Integration | ✅ Optional plugin | ✅ Included | ✅ $3,000+/year | ✅ Enterprise |
| Vendor lock-in | ✅ None | ❌ High | ❌ High | ❌ Very high |
| Jurisdiction clauses | ✅ US_BASE, US_NY, US_CA | ❌ Manual only | ❌ Manual only | ⚠️ Custom setup |

### What You Get That Others Charge For

**Core Features (Always Free)**
- **Local-first architecture**: Work offline, own your data, zero subscription fees
- **Unlimited templates**: Create and save as many SOW templates as needed
- **Smart markdown editor**: Professional formatting with custom directives (`:::pricing`, `:::timeline`, `:::signature`, `:::variables`)
- **Native signature capture**: Client and consultant signatures with metadata and tamper-proof revision locking
- **Instant PDF generation**: Browser-native print-to-PDF (no cloud processing)
- **Client profile management**: Store client details locally with variable autofill
- **Revision control**: Complete history with read-only prior versions and automatic/manual forking
- **Jurisdiction clause packs**: Pre-configured legal clauses for US_BASE, US_NY, US_CA, EU_BASE, UK_BASE, CA_BASE, and AU_BASE with compliance checks
- **Import/Export**: Markdown and JSON portability for backup and migration

**Optional Sharing Plugin (Self-Hosted)**
- **Expiring read-only links**: Share signed SOWs with clients without email attachments
- **Rate limiting & abuse controls**: Built-in CAPTCHA and IP-based rate limiting
- **No per-document fees**: Unlike PandaDoc's $3/extra doc beyond 60/year[web:25]
- **No "powered by" branding**: Your documents, your brand (PandaDoc adds badges on lower tiers[web:21])

## What This Version Provides

### Document Creation & Editing
- Local-first editor with autosave in IndexedDB
- In-browser markdown rendering with custom SOW directives
- Real-time preview with professional formatting
- Variable substitution from client profiles
- Required-section guardrail checks for compliance

### Signatures & Security
- Native signature capture with full metadata
- Signed revision locking (prevents changes post-signature)
- Client + consultant signature workflows
- Audit trail embedded in document metadata
- Tamper-evident revision history

### Collaboration & Sharing
- Optional sharing plugin for expiring read-only links
- Public read-only pages with no login required
- Export to Markdown/JSON for team collaboration
- SQLite backend for published document management
- Self-hosted: deploy on your infrastructure

### Legal & Compliance
- Jurisdiction clause packs (US_BASE, US_NY, US_CA, EU_BASE, UK_BASE, CA_BASE, AU_BASE)
- Required-section validation before finalization
- Revision history for legal audit trail
- Custom clause library support
- Export for legal review before client delivery

## Quick Start

```bash
python -m venv .venv
. .venv/Scripts/activate  # On Windows
# source .venv/bin/activate  # On macOS/Linux
pip install -r requirements.txt
python run.py
```

Open `http://localhost:5000` and start creating professional SOWs immediately.

## Core Architecture

- **`templates/editor.html`**: Single-page app shell for the editor interface
- **`static/js/editor.js`**: Local-first app logic with IndexedDB storage, markdown renderer, signatures, client management, revisions, and clause packs
- **`static/css/app.css`**: Responsive editor UI, status/guardrail/revision controls, and print-optimized styles
- **`app/routes.py`**: Optional sharing plugin APIs and public read-only route handlers
- **`app/models.py`**: SQLite schema for templates and published documents (backend-compatible features)

## Optional Sharing Plugin API

Base path: `/plugin`

Unlike commercial tools that charge per published document, this plugin is completely free when self-hosted.

### Endpoints

- **`POST /plugin/v1/publish`**
  - Body: `{ "title": "...", "html": "...", "expires_in_days": 30, "revision": 2, "signed": true, "signed_only": true, "jurisdiction": "US_NY" }`
  - Returns: `publish_id`, `view_url`, `expires_at`, `revision`, `signed`, `jurisdiction`, `sanitized`
  
- **`GET /plugin/v1/p/<publish_id>`**
  - Returns publish metadata
  
- **`DELETE /plugin/v1/p/<publish_id>`**
  - Soft-deletes a published document
  
- **`GET /plugin/v1/health`**
  - Health check endpoint
  
- **`POST /plugin/v1/health/check`**
  - Client connectivity verification
  
- **`POST /plugin/v1/cleanup`**
  - Marks expired published documents as deleted
  - Returns: `cleaned`, `scanned`, `timestamp`
  
- **`GET /p/<publish_id>`**
  - Public read-only page for clients (no login required)

## Abuse Controls

Built-in protection without enterprise pricing:

- Per-IP rate limiting on publish endpoints
- CAPTCHA gate support for high-volume usage
- Set `PUBLISH_CAPTCHA_TOKEN` environment variable to enable token verification
- Configurable `TRUST_PROXY_HOPS` for reverse proxy deployments

## Environment Variables

See `.env.example` for configuration defaults.

## Development & Quality

### Pre-commit Hooks

```bash
python -m pip install pre-commit
pre-commit install
pre-commit run --all-files
```

### Testing

`pytest.ini` configured for robust testing:

- Runs tests in `tests/` directory
- Clears cache automatically (`--cache-clear`)
- Uses local cache directory (`.pytest_cache_local`)
- CI uses `--basetemp=/tmp/pytest-basetemp` to avoid permission issues

**Optional browser smoke tests:**

```bash
npx playwright test tests/e2e/playwright_smoke.mjs
```

## Legacy Template Migration

Migrate from older SQLite templates to local-first JSON format:

```bash
python scripts/export_legacy_templates.py --db data/sow.db --out legacy_templates.json
```

Import packages via the UI Import button.

## Deployment Options

### Local Use (No Cost)

Run locally for personal use—no server required. Perfect for freelancers and solo consultants.

### Self-Hosted Sharing (Your Infrastructure)

Deploy on your own server or cloud platform:

- **Fly.io**: Included `fly.toml` configuration
- **Docker**: Included `Dockerfile` for containerized deployment
- **VPS/Cloud**: Run on any Python-compatible hosting

**Estimated hosting cost**: $5-15/month for light usage vs. $228-588/year per user for commercial alternatives.

## Use Cases

### For Freelancers & Solo Consultants
- Create professional SOWs without monthly fees
- Maintain client profiles for faster document generation
- Print to PDF and email, or use optional sharing plugin
- **Savings**: $180-588/year vs. PandaDoc or Dropbox Sign

### For Small Agencies (2-5 People)
- Self-host the sharing plugin for team collaboration
- Export/import templates across team members
- Maintain brand consistency without "powered by" badges
- **Savings**: $360-2,940/year vs. commercial per-seat licensing

### For Businesses with Compliance Needs
- Jurisdiction-specific clause packs with validation
- Complete audit trail and revision history
- Data sovereignty (no third-party cloud storage)
- **Savings**: Thousands annually vs. enterprise SOW platforms

### For Developers & Integrators
- Open API for custom workflows
- JSON/Markdown format for programmatic generation
- No vendor lock-in or API usage fees
- **Savings**: $3,000+/year vs. Dropbox Sign API plans[web:30]

## Security & Privacy

### Local-First = Your Data, Your Control

- All documents stored in browser IndexedDB by default
- Optional self-hosted backend under your control
- No third-party tracking or analytics
- No data mining for AI training (unlike cloud vendors)
- See `docs/threat-model.md` for detailed security analysis

### Comparison to Cloud Vendors

| Security Feature | This Tool | PandaDoc | Dropbox Sign |
|------------------|-----------|----------|-------------|
| Data location | Your device/server | Their cloud | Their cloud |
| Data access | You only | Vendor + You | Vendor + You |
| Privacy policy | None needed | Complex | Complex |
| Data portability | Full (JSON/MD) | Limited export | Limited export |
| Vendor access | Never | Yes (ToS) | Yes (ToS) |

## Roadmap & Contributions

### Planned Enhancements

- [x] Additional jurisdiction packs (EU, UK, Canada, Australia)
- [x] Enhanced template gallery with industry-specific examples
- [ ] Multi-language support for international consultants
- [ ] Advanced pricing table calculations (discounts, taxes)
- [ ] Gantt chart integration for timeline visualization
- [ ] Custom clause library builder UI
- [ ] Email integration for direct client delivery
- [x] Mobile-responsive signature capture

### How to Contribute

Contributions welcome! Areas of focus:

1. **Legal clauses**: Add jurisdiction-specific clause packs
2. **Templates**: Contribute industry-specific SOW templates
3. **Integrations**: Build connectors to CRMs, project management tools
4. **Translations**: Help internationalize the interface
5. **Testing**: Expand test coverage and browser compatibility

## License

MIT License - Use freely for commercial and personal projects. See `LICENSE` for details.

## Why We Built This

Commercial SOW and proposal software has become prohibitively expensive for freelancers and small businesses. PandaDoc's "Business" tier costs $588/year per user, Dropbox Sign charges $300/year for basic team features, and enterprise platforms like Upland Qvidian are priced out of reach for most consultants[web:21][web:25][web:27][web:34].

We believe creating professional, legally sound SOWs shouldn't require expensive subscriptions or vendor lock-in. This tool provides:

- **Zero recurring costs** for core functionality
- **Data ownership** without cloud vendor dependencies  
- **Professional results** that rival $500+/year alternatives
- **Open source** for transparency and customization

## Notes

- Sharing is entirely optional—local editing and PDF export work fully offline
- Legacy `/api/*` endpoints remain available for backward compatibility
- Threat model and security documentation: `docs/threat-model.md`
- No telemetry, no phone-home, no hidden data collection

---

**Ready to save $200-$600/year per user?** Clone this repo and start creating professional SOWs today.

**Questions?** Open an issue or contribute improvements via pull request.
