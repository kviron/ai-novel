"""Deterministic local Ollama stand-in for the browser acceptance test."""

import json

from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()
requests_log: list[dict] = []


class ChatRequest(BaseModel):
    model: str
    messages: list[dict[str, str]]


@app.get("/api/tags")
def tags() -> dict:
    return {"models": [{"name": "qwen3:14b-q4_K_M"}, {"name": "gemma4-local:32k"}]}


@app.post("/api/show")
def show(request: dict[str, str]) -> dict:
    context_length = 32768 if request.get("model") == "gemma4-local:32k" else 40960
    return {"model_info": {"fake.context_length": context_length}}


@app.post("/test/reset")
def reset() -> dict:
    requests_log.clear()
    return {"ok": True}


@app.get("/test/requests")
def requests() -> list[dict]:
    return requests_log


@app.post("/api/chat")
def chat(request: ChatRequest) -> dict:
    content = request.messages[-1]["content"]
    draft = json.JSONDecoder().raw_decode(content)[0]
    if "field" in draft:
        previous = draft["existing_text_to_preserve_and_expand"]
        text = f"{previous} — подробная черта героя для сцен." if previous else "Подробная черта героя для сцен."
        return {
            "message": {"role": "assistant", "content": json.dumps({"text": text}, ensure_ascii=False)},
            "done": True,
        }
    action = draft["action"]
    characters = draft.get("characters", [])
    speaker = characters[0] if characters else {"id": "akane", "source_type": "legacy"}
    speaker_id = speaker["id"]
    legacy = speaker_id == "akane" or speaker.get("source_type") == "legacy"
    hybrid = draft.get("story", {}).get("mode") == "hybrid"
    repaired = "Исправь ответ по схеме." in content
    early_ending = action == "Попытка раннего финала"
    hard_facts = draft.get("hard_facts", [])
    available_beats = draft.get("available_beats", [])
    proposal = {
        "segments": [
            {"kind": "narration", "text": "Аканэ раскрыла веер и взглянула на неон за окном."},
            {
                "kind": "dialogue",
                "character_id": speaker_id,
                "text": (
                    "Исправленный ответ после проверки канона." if repaired else f"Я ждала этого вопроса. {action}"
                ),
            },
        ],
        "visual_directive": {
            "mode": "sprite_scene",
            "emotion": "fan",
            "pose": "fan_open" if legacy else "default",
            "outfit": "red_dress" if legacy else ("dark_coat" if speaker_id == "mark" else "none"),
            "present_character_ids": [speaker_id],
            "protagonist_emotion": "neutral",
        },
        "suggested_choices": ["Уточнить подробности", "Посмотреть на улицу", "Продолжить разговор"],
        "proposed_effects": [],
        "canon_assessments": [
            {"fact_id": fact["id"], "status": "upheld", "evidence": "Сцена сохраняет факт."} for fact in hard_facts
        ]
        if hybrid
        else [],
        "completed_beat_ids": [beat["id"] for beat in available_beats] if early_ending and repaired else [],
        "requests_ending": early_ending,
    }
    requests_log.append(
        {
            "model": request.model,
            "prompt": content,
            "repaired": repaired,
            "proposal": proposal,
        }
    )
    return {"message": {"role": "assistant", "content": json.dumps(proposal, ensure_ascii=False)}, "done": True}
