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
    draft = json.loads(request.messages[-1]["content"])
    if "field" in draft:
        previous = draft["existing_text_to_preserve_and_expand"]
        text = f"{previous} — подробная черта героя для сцен." if previous else "Подробная черта героя для сцен."
        return {
            "message": {"role": "assistant", "content": json.dumps({"text": text}, ensure_ascii=False)},
            "done": True,
        }
    action = draft["action"]
    proposal = {
        "segments": [
            {"kind": "narration", "text": "Аканэ раскрыла веер и взглянула на неон за окном."},
            {"kind": "dialogue", "character_id": "akane", "text": f"Я ждала этого вопроса. {action}"},
        ],
        "visual_directive": {"mode": "sprite_scene", "emotion": "fan", "pose": "fan_open", "outfit": "red_dress"},
        "suggested_choices": ["Уточнить подробности", "Посмотреть на улицу", "Продолжить разговор"],
        "proposed_effects": [],
    }
    return {"message": {"role": "assistant", "content": json.dumps(proposal, ensure_ascii=False)}, "done": True}
