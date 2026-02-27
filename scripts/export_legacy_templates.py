"""Export legacy SQLite templates into local-first JSON import packages.

Usage:
  python scripts/export_legacy_templates.py --db data/sow.db --out legacy_templates.json
"""
import argparse
import json
import sqlite3
from datetime import datetime


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", required=True, help="Path to legacy sow.db SQLite file")
    parser.add_argument("--out", required=True, help="Output JSON path")
    return parser.parse_args()


def main():
    args = parse_args()
    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT id, name, markdown, variables, created_at, updated_at FROM templates ORDER BY updated_at DESC"
    ).fetchall()
    conn.close()

    packages = []
    for row in rows:
        try:
            variables = json.loads(row["variables"] or "{}")
        except json.JSONDecodeError:
            variables = {}

        project_name = variables.get("project_name") or row["name"] or "Imported SOW"
        doc = {
            "id": f"legacy_{row['id']}",
            "title": project_name,
            "clientId": "",
            "clausePack": "US_BASE",
            "currentRevision": 1,
            "revisions": [
                {
                    "revision": 1,
                    "markdown": row["markdown"] or "",
                    "variables": variables,
                    "templateId": "modern",
                    "pageSize": "Letter",
                    "status": "draft",
                    "signatures": [],
                    "changeSummary": "Imported from legacy SQLite template",
                    "createdAt": row["created_at"] or datetime.utcnow().isoformat(),
                }
            ],
            "createdAt": row["created_at"] or datetime.utcnow().isoformat(),
            "updatedAt": row["updated_at"] or datetime.utcnow().isoformat(),
        }
        packages.append(
            {
                "exportedAt": datetime.utcnow().isoformat(),
                "doc": doc,
                "clients": [],
            }
        )

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump({"packages": packages}, f, indent=2)

    print(f"Exported {len(packages)} template package(s) to {args.out}")


if __name__ == "__main__":
    main()
