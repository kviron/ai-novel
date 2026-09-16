# AI Visual Novel v0.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a locally runnable AI visual-novel scaffold with a tested API, playable React UI, persistent SQLite state, and provider boundaries for Ollama and ComfyUI.

**Architecture:** A Vite React client consumes a FastAPI JSON API. FastAPI owns SQLite state and provides deterministic demo narrative/image jobs while keeping live providers behind adapters.

**Tech Stack:** React 19, TypeScript, Vite, FastAPI, Pydantic, SQLAlchemy, SQLite, pytest, Vitest

**Spec:** `docs/superpowers/specs/2026-09-16-ai-visual-novel-v01-design.md`

## Global Constraints

- Local single-user application.
- Every character age is at least 18.
- ComfyUI is headless and is not embedded in the game UI.
- SQLite is authoritative; narrative output never directly mutates canon.
- Demo mode must work without Ollama or ComfyUI.

---

### Task 1: Backend story slice

**Files:** `apps/api/app/**`, `apps/api/tests/**`, `apps/api/pyproject.toml`

**Interfaces:** Produces `POST /api/stories`, `GET /api/stories/{id}`, `POST /api/stories/{id}/turns`, `GET /api/stories/{id}/jobs`, and health endpoints.

- [ ] Write API tests for validation, persistence, job dependencies, version conflicts, and idempotency.
- [ ] Run tests and confirm they fail because the API does not exist.
- [ ] Implement the SQLite models, schemas, services, routes, and demo turn generator.
- [ ] Run the backend suite and keep it green.

### Task 2: Playable web client

**Files:** `apps/web/src/**`, `apps/web/package.json`, `apps/web/vite.config.ts`

**Interfaces:** Consumes the Task 1 JSON API through a typed client and renders setup, stage, dialogue, actions, provider health, and image jobs.

- [ ] Write component tests for setup and play-state rendering.
- [ ] Run tests and confirm they fail because components do not exist.
- [ ] Implement the client, screens, styling, and demo-friendly error handling.
- [ ] Run tests and a production build.

### Task 3: Local developer experience

**Files:** `README.md`, `.env.example`, `.gitignore`, `package.json`, `scripts/**`, `workflows/comfyui/**`

**Interfaces:** Produces documented install/start commands and live-provider configuration contracts.

- [ ] Add configuration examples and a safe ComfyUI API-workflow template description.
- [ ] Add root commands for installation, development, tests, and build.
- [ ] Run the complete verification gate and an API smoke check.
- [ ] Inspect Git state for secrets/generated data and create the initial commit.
