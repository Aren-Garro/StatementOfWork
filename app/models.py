"""Database models for template persistence."""
import json
import os
import sqlite3
from datetime import datetime
from urllib.parse import urlparse, unquote

from flask import current_app, g


DEFAULT_DATABASE_PATH = os.path.join(
    os.path.dirname(os.path.dirname(__file__)), 'data', 'sow.db'
)
# Backward-compatible alias for tests and scripts.
DATABASE_PATH = DEFAULT_DATABASE_PATH


def _resolve_database_path() -> str:
    database_url = (current_app.config.get('DATABASE_URL') or '').strip()
    if not database_url:
        return DATABASE_PATH
    if database_url == 'sqlite:///data/sow.db' and DATABASE_PATH != DEFAULT_DATABASE_PATH:
        return DATABASE_PATH

    parsed = urlparse(database_url)
    if parsed.scheme and parsed.scheme != 'sqlite':
        raise RuntimeError('Only sqlite DATABASE_URL values are supported')

    if parsed.netloc and parsed.netloc not in {'', 'localhost'}:
        raise RuntimeError('Unsupported sqlite DATABASE_URL host')

    if not parsed.path:
        return DATABASE_PATH

    raw_path = unquote(parsed.path)
    if os.name == 'nt' and raw_path.startswith('/') and len(raw_path) > 2 and raw_path[2] == ':':
        raw_path = raw_path[1:]

    if os.path.isabs(raw_path):
        return raw_path

    repo_root = os.path.dirname(os.path.dirname(__file__))
    return os.path.abspath(os.path.join(repo_root, raw_path.lstrip('/')))


def get_db():
    """Get database connection for current request."""
    if 'db' not in g:
        db_path = _resolve_database_path()
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        g.db = sqlite3.connect(db_path)
        g.db.row_factory = sqlite3.Row
    return g.db


def close_db(e=None):
    """Close database connection."""
    db = g.pop('db', None)
    if db is not None:
        db.close()


def init_db(app):
    """Initialize database schema."""
    app.teardown_appcontext(close_db)

    db = get_db()
    db.execute('''
        CREATE TABLE IF NOT EXISTS templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT DEFAULT '',
            markdown TEXT NOT NULL,
            variables TEXT DEFAULT '{}',
            pdf_template TEXT DEFAULT 'modern',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    ''')

    db.execute('''
        CREATE TABLE IF NOT EXISTS published_docs (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            html TEXT NOT NULL,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            deleted INTEGER NOT NULL DEFAULT 0,
            views INTEGER NOT NULL DEFAULT 0,
            revision INTEGER,
            signed INTEGER NOT NULL DEFAULT 0,
            jurisdiction TEXT NOT NULL DEFAULT 'US_BASE',
            template TEXT NOT NULL DEFAULT 'modern',
            page_size TEXT NOT NULL DEFAULT 'Letter'
        )
    ''')

    db.execute('''
        CREATE TABLE IF NOT EXISTS rate_limit_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            client_ip TEXT NOT NULL,
            created_at REAL NOT NULL
        )
    ''')
    db.execute(
        'CREATE INDEX IF NOT EXISTS idx_rate_limit_events_ip_time '
        'ON rate_limit_events(client_ip, created_at)'
    )

    _ensure_column(db, 'published_docs', 'revision', 'INTEGER')
    _ensure_column(db, 'published_docs', 'signed', 'INTEGER NOT NULL DEFAULT 0')
    _ensure_column(db, 'published_docs', 'jurisdiction', "TEXT NOT NULL DEFAULT 'US_BASE'")
    _ensure_column(db, 'published_docs', 'template', "TEXT NOT NULL DEFAULT 'modern'")
    _ensure_column(db, 'published_docs', 'page_size', "TEXT NOT NULL DEFAULT 'Letter'")

    # Seed sample templates if empty
    count = db.execute('SELECT COUNT(*) FROM templates').fetchone()[0]
    if count == 0:
        _seed_templates(db)

    db.commit()


def _ensure_column(db, table: str, column: str, definition: str):
    """Add a column if it doesn't already exist (SQLite-safe migration helper)."""
    existing = db.execute(f"PRAGMA table_info({table})").fetchall()
    existing_names = {row[1] for row in existing}
    if column not in existing_names:
        db.execute(f'ALTER TABLE {table} ADD COLUMN {column} {definition}')


def _seed_templates(db):
    """Insert sample SOW templates."""
    samples_dir = os.path.join(
        os.path.dirname(os.path.dirname(__file__)), 'sample_sows'
    )

    samples = [
        {
            'name': 'Web Development SOW',
            'description': 'Standard statement of work for web development projects',
            'file': 'web_development.md',
            'variables': {
                'client_name': 'Client Name',
                'project_name': 'Web Development Project',
                'consultant_name': 'Your Name',
                'date': datetime.now().strftime('%Y-%m-%d')
            }
        },
        {
            'name': 'Consulting Proposal',
            'description': 'Professional consulting engagement proposal',
            'file': 'consulting.md',
            'variables': {
                'client_name': 'Client Name',
                'project_name': 'Consulting Engagement',
                'consultant_name': 'Your Name',
                'date': datetime.now().strftime('%Y-%m-%d')
            }
        },
        {
            'name': 'SaaS Project Brief',
            'description': 'SaaS product development project brief and SOW',
            'file': 'saas_project.md',
            'variables': {
                'client_name': 'Client Name',
                'project_name': 'SaaS Platform',
                'consultant_name': 'Your Name',
                'date': datetime.now().strftime('%Y-%m-%d')
            }
        }
    ]

    now = datetime.now().isoformat()
    for sample in samples:
        filepath = os.path.join(samples_dir, sample['file'])
        if os.path.exists(filepath):
            with open(filepath, 'r') as f:
                markdown = f.read()
        else:
            markdown = f'# {sample["name"]}\n\nSample template content.'

        db.execute(
            '''INSERT INTO templates (name, description, markdown, variables, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?)''',
            (sample['name'], sample['description'], markdown,
             json.dumps(sample['variables']), now, now)
        )
