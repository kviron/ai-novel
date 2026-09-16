import json
import sqlite3
from pathlib import Path
from typing import Any


SCHEMA = """
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS stories (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, premise TEXT NOT NULL,
  theme_labels TEXT NOT NULL, state_version INTEGER NOT NULL,
  current_scene TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY, story_id TEXT NOT NULL REFERENCES stories(id),
  name TEXT NOT NULL, age INTEGER NOT NULL CHECK(age >= 18),
  personality TEXT NOT NULL, appearance TEXT NOT NULL, visual_profile_version INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS generation_jobs (
  id TEXT PRIMARY KEY, story_id TEXT NOT NULL REFERENCES stories(id),
  character_id TEXT REFERENCES characters(id), kind TEXT NOT NULL,
  expression TEXT, dependency_id TEXT REFERENCES generation_jobs(id),
  status TEXT NOT NULL, stage TEXT NOT NULL, progress REAL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY, story_id TEXT NOT NULL REFERENCES stories(id),
  request_id TEXT NOT NULL, state_version INTEGER NOT NULL,
  action TEXT NOT NULL, speaker TEXT NOT NULL, dialogue TEXT NOT NULL,
  narration TEXT NOT NULL, choices TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(story_id, request_id)
);
"""


class Database:
    def __init__(self, path: Path):
        self.path = path

    def connect(self) -> sqlite3.Connection:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        return connection

    def initialize(self) -> None:
        with self.connect() as connection:
            connection.executescript(SCHEMA)


def decode_row(row: sqlite3.Row) -> dict[str, Any]:
    return dict(row)


def decode_json(value: str):
    return json.loads(value)
