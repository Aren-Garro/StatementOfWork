"""Template CRUD operations."""
import json
from datetime import datetime
from app.models import get_db


class TemplateManager:
    """Manage SOW templates in the database."""

    def list_templates(self) -> list:
        """Return all templates."""
        db = get_db()
        rows = db.execute(
            'SELECT * FROM templates ORDER BY updated_at DESC'
        ).fetchall()
        return [self._row_to_dict(row) for row in rows]

    def get_template(self, template_id: int) -> dict | None:
        """Get a single template by ID."""
        db = get_db()
        row = db.execute(
            'SELECT * FROM templates WHERE id = ?', (template_id,)
        ).fetchone()
        return self._row_to_dict(row) if row else None

    def save_template(self, name: str, description: str,
                      markdown: str, variables: dict = None) -> dict:
        """Create a new template."""
        db = get_db()
        now = datetime.now().isoformat()
        cursor = db.execute(
            '''INSERT INTO templates (name, description, markdown, variables, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?)''',
            (name, description, markdown,
             json.dumps(variables or {}), now, now)
        )
        db.commit()
        return self.get_template(cursor.lastrowid)

    def update_template(self, template_id: int, data: dict) -> dict | None:
        """Update an existing template."""
        existing = self.get_template(template_id)
        if not existing:
            return None

        db = get_db()
        now = datetime.now().isoformat()
        db.execute(
            '''UPDATE templates
               SET name = ?, description = ?, markdown = ?,
                   variables = ?, updated_at = ?
               WHERE id = ?''',
            (
                data.get('name', existing['name']),
                data.get('description', existing['description']),
                data.get('markdown', existing['markdown']),
                json.dumps(data.get('variables', existing['variables'])),
                now,
                template_id
            )
        )
        db.commit()
        return self.get_template(template_id)

    def delete_template(self, template_id: int) -> bool:
        """Delete a template."""
        db = get_db()
        cursor = db.execute(
            'DELETE FROM templates WHERE id = ?', (template_id,)
        )
        db.commit()
        return cursor.rowcount > 0

    def duplicate_template(self, template_id: int) -> dict | None:
        """Duplicate an existing template."""
        existing = self.get_template(template_id)
        if not existing:
            return None
        return self.save_template(
            name=f"{existing['name']} (Copy)",
            description=existing['description'],
            markdown=existing['markdown'],
            variables=existing['variables']
        )

    @staticmethod
    def _row_to_dict(row) -> dict:
        """Convert a database row to a dictionary."""
        d = dict(row)
        if 'variables' in d and isinstance(d['variables'], str):
            d['variables'] = json.loads(d['variables'])
        return d
