from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class CharacterWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=120)
    gender: str = Field(min_length=1, max_length=40)
    age: int = Field(ge=18)
    personality: str = Field(min_length=1)
    appearance: str = Field(min_length=1)
    biography: str = ""
    speech: str = ""


CharacterTextField = Literal["personality", "appearance", "biography", "speech"]


class CharacterDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(default="", max_length=120)
    gender: str = Field(default="unspecified", max_length=40)
    age: int = Field(default=18, ge=18)
    personality: str = Field(default="", max_length=6000)
    appearance: str = Field(default="", max_length=6000)
    biography: str = Field(default="", max_length=6000)
    speech: str = Field(default="", max_length=6000)


class GenerateCharacterFieldRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field: CharacterTextField
    draft: CharacterDraft


class GenerateStoryRoleRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    character_id: str
    revision_id: str
    existing_text: str = Field(default="", max_length=2000)


class GeneratedCharacterField(BaseModel):
    text: str


class AttachCharacterRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    character_id: str
    revision_id: str
    role: str = "cast"


class PinRevisionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    revision_id: str
    role: str | None = Field(default=None, max_length=2000)


class RevisionProfile(BaseModel):
    id: str
    revision_number: int
    name: str
    gender: str
    age: int
    personality: str
    appearance: str
    biography: str
    speech: str
    created_at: str


class CharacterProfile(RevisionProfile):
    character_id: str
    current_revision_id: str
    source_type: str


class CharacterHistory(BaseModel):
    id: str
    current_revision_id: str
    source_type: str
    revisions: list[RevisionProfile]
    linked_stories: list["LinkedStory"]


class LinkedStory(BaseModel):
    story_id: str
    story_title: str
    story_slug: str
    revision_id: str
    revision_number: int
    role: str


class StoryCharacterProfile(BaseModel):
    story_id: str
    character_id: str
    revision_id: str
    role: str
