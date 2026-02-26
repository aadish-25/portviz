import os
import json
from datetime import datetime
from dataclasses import asdict
from typing import List
from ..core.models import PortEntry

SNAPSHOT_DIR = ".portviz/snapshot"

def ensure_snapshot_directory():
    os.makedirs(SNAPSHOT_DIR, exist_ok=True)

def generate_snapshot_filename():
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    return f"snapshot_{timestamp}.json"

def save_snapshot(entries: List[PortEntry]) -> str:
    ensure_snapshot_directory()

    filename = generate_snapshot_filename()
    filepath = os.path.join(SNAPSHOT_DIR, filename)

    snapshot_data = {
        "created_at": datetime.now().isoformat(),
        "entries": [asdict(entry) for entry in entries]
    }

    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(snapshot_data, f, indent=4)
    return filepath

def list_snapshots():
    if not os.path.exists(SNAPSHOT_DIR):
        return []

    files = sorted(os.listdir(SNAPSHOT_DIR))

    snapshots = []

    for file in files:
        if not file.endswith(".json"):
            continue

        filepath = os.path.join(SNAPSHOT_DIR, file)

        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)

        snapshots.append({
            "filename": file,
            "created_at": data.get("created_at"),
            "entry_count": len(data.get("entries", []))
        })

    return snapshots