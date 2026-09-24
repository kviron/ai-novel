"""Deterministic local Ollama stand-in for the browser acceptance test."""

import json

from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()


class ChatRequest(BaseModel):
    model: str
    messages: list[dict[str, str]]


@app.get("/api/tags")
def tags() -> dict:
    return {"models": [{"name": "qwen3:14b-q4_K_M"}, {"name": "gemma4-local:32k"}]}


@app.post("/api/chat")
def chat(request: ChatRequest) -> dict:
    action = json.loads(request.messages[-1]["content"])["action"]
    proposal = {
        "narration": "Аканэ раскрыла веер и взглянула на неон за окном.",
        "dialogue": {"character_id": "akane", "text": f"Я ждала этого вопроса. {action}"},
        "visual_directive": {"mode": "sprite_scene", "emotion": "fan", "pose": "fan_open", "outfit": "red_dress"},
        "suggested_choices": ["Уточнить подробности", "Посмотреть на улицу", "Продолжить разговор"],
        "proposed_effects": [],
    }
    return {"message": {"role": "assistant", "content": json.dumps(proposal, ensure_ascii=False)}, "done": True}
