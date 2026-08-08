#!/usr/bin/env python3
"""Apply a prepared real-image manifest to an existing catalog database."""

from __future__ import annotations

import argparse
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--uploads-dir", type=Path, required=True)
    parser.add_argument("--backup-dir", type=Path, required=True)
    args = parser.parse_args()

    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    expected_files = {
        item["url"].removeprefix("/uploads/")
        for images in manifest.values()
        for item in images
    }
    missing_files = [
        relative
        for relative in expected_files
        if not (args.uploads_dir / relative).is_file()
    ]
    if missing_files:
        raise RuntimeError(f"missing uploaded files: {missing_files[:20]}")

    connection = sqlite3.connect(args.db)
    try:
        rows = connection.execute("SELECT code, COUNT(*) FROM products GROUP BY code").fetchall()
        counts = {str(code): count for code, count in rows}
        invalid = [code for code in manifest if counts.get(code) != 1]
        if invalid:
            raise RuntimeError(f"codes not uniquely matched: {invalid[:20]}")
    finally:
        connection.close()

    args.backup_dir.mkdir(parents=True, exist_ok=True)
    backup = args.backup_dir / f"catalog-before-realimg-{datetime.now():%Y%m%d-%H%M%S}.db"
    with sqlite3.connect(args.db) as source, sqlite3.connect(backup) as target:
        source.backup(target)

    now = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    connection = sqlite3.connect(args.db)
    try:
        connection.execute("BEGIN IMMEDIATE")
        for code, images in manifest.items():
            connection.execute(
                "UPDATE products SET real_images_json = ?, updated_at = ? WHERE code = ?",
                (json.dumps(images, ensure_ascii=False, separators=(",", ":")), now, code),
            )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()

    print(
        json.dumps(
            {
                "updatedProducts": len(manifest),
                "imageReferences": sum(len(images) for images in manifest.values()),
                "uniqueFiles": len(expected_files),
                "backup": str(backup),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
