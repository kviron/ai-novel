# Mnemosyne — local AI visual novel

An early working scaffold for a private AI-driven visual novel. The browser UI creates a story, renders a visual-novel scene, accepts choices or free-form actions, and shows image-generation jobs. FastAPI stores objective state in SQLite and keeps Ollama/ComfyUI behind local provider boundaries.

## Included in v0.1

- React + TypeScript visual-novel interface with responsive setup and play screens.
- FastAPI + SQLite stories, adult characters, versioned turns, idempotent requests, and generation jobs.
- Character-sheet → five cached sprite jobs (`neutral`, `happy`, `sad`, `angry`, `surprised`).
- Separate `cg` job type in the API contract for future full-scene generation.
- Independent Ollama and ComfyUI health status; the app remains usable in demo mode when they are offline.
- Design and implementation documents under `docs/superpowers`.

## First start on Windows

Prerequisites: Node.js 20+, npm, and [uv](https://docs.astral.sh/uv/). Ollama and ComfyUI are optional for demo mode.

```powershell
cd D:\develop\ai-visual-novel
npm run setup
Copy-Item .env.example .env
```

Open two terminals:

```powershell
npm run dev:api
```

```powershell
npm run dev:web
```

Then open [http://localhost:5173](http://localhost:5173). API documentation is available at [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs).

## Checks

```powershell
npm test
npm run build
```

## Live providers

Copy `.env.example` to `.env` and adjust the local URLs/model. Ollama is expected at port `11434`; ComfyUI is expected at port `8188` and is used through its API only. See `workflows/comfyui/README.md` for the workflow boundary.

The current narrative response and image worker are deterministic demo implementations. The database and HTTP contracts deliberately separate narrative proposals from canonical game state, so live adapters can be added without trusting model output as direct state mutation.
