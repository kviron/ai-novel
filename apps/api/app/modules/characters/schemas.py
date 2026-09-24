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
    role: str = ""


class AttachCharacterRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    character_id: str
    revision_id: str
    role: str = "cast"


class PinRevisionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    revision_id: str


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
    role: str
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


class StoryCharacterProfile(BaseModel):
    story_id: str
    character_id: str
    revision_id: str
    role: str
