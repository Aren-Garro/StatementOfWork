"""Database models for template persistence."""
import sqlite3
import json
import os
from datetime import datetime
from flask import g


DATABASE_PATH = os.path.join(
    os.path.dirname(os.path.dirname(__file__)), 'data', 'sow.db'
)


def get_db():
    """Get database connection for current request."""
    if 'db' not in g:
        os.makedirs(os.path.dirname(DATABASE_PATH), exist_ok=True)
        g.db = sqlite3.connect(DATABASE_PATH)
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
            views INTEGER NOT NULL DEFAULT 0
        )
    ''')

    # Seed sample templates if empty
    count = db.execute('SELECT COUNT(*) FROM templates').fetchone()[0]
    if count == 0:
        _seed_templates(db)

    db.commit()


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
