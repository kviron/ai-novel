from typing import Literal

from pydantic import BaseModel, Field


class CharacterCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    age: int = Field(ge=18, le=150)
    personality: str = Field(min_length=1, max_length=1000)
    appearance: str = Field(min_length=1, max_length=2000)


class StoryCreate(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    premise: str = Field(min_length=1, max_length=5000)
    theme_labels: list[str] = Field(default_factory=list, max_length=20)
    characters: list[CharacterCreate] = Field(min_length=1, max_length=12)


class TurnCreate(BaseModel):
    request_id: str = Field(min_length=1, max_length=100)
    expected_state_version: int = Field(ge=1)
    action: str = Field(min_length=1, max_length=4000)


JobKind = Literal["character_sheet", "sprite", "cg"]
