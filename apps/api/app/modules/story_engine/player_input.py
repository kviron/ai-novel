"""Parse the player's text without changing the text they chose to send.

Unmarked text describes an action or state. Quotes mark audible speech,
parentheses private thoughts, and asterisks explicit actions. Unclosed
delimiters stay ordinary text so a typo never silently drops content.
"""

import unicodedata
from typing import Literal

from pydantic import BaseModel


class PlayerPart(BaseModel):
    kind: Literal["action", "explicit_action", "speech", "thought"]
    text: str


_OPENERS = {"*": ("*", "explicit_action"), "(": (")", "thought"), "«": ("»", "speech"), '"': ('"', "speech")}


def _has_content(value: str) -> bool:
    return any(not char.isspace() and not unicodedata.category(char).startswith("P") for char in value)


def parse_player_input(value: str) -> list[PlayerPart]:
    """Return ordered semantic parts; keep malformed markup as action text."""
    parts: list[PlayerPart] = []
    plain_start = 0
    index = 0
    while index < len(value):
        opener = value[index]
        match = _OPENERS.get(opener)
        if match is None:
            index += 1
            continue
        closer, kind = match
        end = value.find(closer, index + 1)
        if end < 0 or not value[index + 1 : end].strip():
            index += 1
            continue
        plain = value[plain_start:index].strip()
        if _has_content(plain):
            parts.append(PlayerPart(kind="action", text=plain))
        parts.append(PlayerPart(kind=kind, text=value[index + 1 : end].strip()))
        index = end + 1
        plain_start = index
    tail = value[plain_start:].strip()
    if _has_content(tail):
        parts.append(PlayerPart(kind="action", text=tail))
    return parts
