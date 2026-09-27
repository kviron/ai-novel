# Shared LLM Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Route every existing LLM call through one bounded, observable execution path without changing story-engine ownership of canon.

**Architecture:** A model catalog resolves per-model limits. Task policies supply immutable prompt layers and output validation. One executor measures the complete request, enforces the budget, invokes a provider, and returns a typed result plus diagnostics. Game-turn and character-draft policies are first clients.

**Tech Stack:** Python 3.11, FastAPI, Pydantic, SQLModel, HTTPX, Ollama, pytest.

**Spec:** `docs/superpowers/specs/2026-09-27-narrative-harness-design.md`

## Global Constraints

- Every existing LLM call uses the executor; no domain module calls a provider directly.
- Story engine alone accepts canonical turns; character generation returns drafts.
- Count system, user, schema and repair content before every call; preserve required layers.
- Cloud model selection is sufficient authorization when cloud adapters are added.
- Preserve existing `request_id`, `state_version`, rollback and provider test behavior.

---

### Task 1: Model capabilities and request budgets

**Files:**
- Create: `apps/api/app/modules/llm_harness/models.py`, `apps/api/app/modules/llm_harness/budget.py`
- Modify: `apps/api/app/modules/providers/contracts.py`, `apps/api/app/modules/providers/ollama.py`, `apps/api/app/core/config.py`
- Test: `apps/api/tests/llm_harness/test_budget.py`, `apps/api/tests/providers/test_ollama.py`

**Interfaces:**
- Produces: `ModelProfile(provider_id, model_id, context_window, output_limit, working_window, token_safety_margin)` and `fit_layers(profile, layers, output_reserve) -> PromptPackage`.
- `PromptLayer(key, text, required, priority)` is immutable; `PromptPackage` contains ordered layers, estimated tokens and omitted layer IDs.

- [x] **Step 1: Write failing tests** for a 4K model that retains required layers and drops optional layers, a 16K model that retains both, and an impossible required layer that raises `ContextBudgetError`.

```python
def test_small_model_keeps_required_content():
    package = fit_layers(profile(4096), [required_layer(), optional_layer(5000)], 512)
    assert package.layer_keys == ("required",)

def test_required_content_never_truncates():
    with pytest.raises(ContextBudgetError):
        fit_layers(profile(512), [required_layer(1000)], 128)
```

- [x] **Step 2: Run** `uv run --directory apps/api --extra test pytest tests/llm_harness/test_budget.py -q` and confirm failure from missing behavior.
- [x] **Step 3: Implement** frozen contracts, conservative UTF-8-based estimator with explicit safety margin, and selection in descending priority after mandatory layers. Send chosen `working_window` as Ollama `num_ctx`; retain provider identity in profile.
- [x] **Step 4: Run** targeted tests and `uv run --directory apps/api --extra test ruff check app tests`.
- [x] **Step 5: Commit** the task files.

### Task 2: One executor and task policies

**Files:**
- Create: `apps/api/app/modules/llm_harness/executor.py`, `apps/api/app/modules/llm_harness/policies.py`
- Modify: `apps/api/app/modules/story_engine/service.py`, `apps/api/app/modules/story_engine/prompt.py`, `apps/api/app/modules/characters/field_generation.py`, `apps/api/app/core/lifespan.py`, `apps/api/app/main.py`
- Test: `apps/api/tests/llm_harness/test_executor.py`, existing `story_engine/test_turns.py`, `characters/test_field_generation.py`, `characters/test_story_role.py`

**Interfaces:**
- `LLMHarness.run(task_kind, snapshot, provider_id, model_id, correlation_id) -> TaskResult` obtains policy, profile and adapter.
- `TaskPolicy.prepare(snapshot) -> list[PromptLayer]`; `TaskPolicy.validate(proposal, snapshot) -> typed result`.
- `GenerationTrace` records model, layer sizes, dropped IDs, attempts and provider usage.

- [x] **Step 1: Write failing tests** showing a character draft and a turn use the same executor, preserve their domain outcomes, and reject an oversized repair before the second provider call.

```python
def test_repair_is_bounded(harness, invalid_provider):
    with pytest.raises(ContextBudgetError):
        harness.run("game_turn", snapshot, "ollama", "small", "request-1")
    assert invalid_provider.calls == 1
```

- [x] **Step 2: Run** the new test to confirm the expected missing executor failure.
- [x] **Step 3: Implement** executor with one correction, bounded diagnostics and policy adapters. Route game and character calls through it while keeping database writes in their current services.
- [x] **Step 4: Run** targeted tests, API tests, Ruff and the full API suite.
- [x] **Step 5: Commit** the task files.

### Task 3: Diagnostics and compatibility

**Files:**
- Modify: `apps/api/app/modules/providers/ollama.py`, `apps/api/app/modules/providers/contracts.py`, `apps/api/app/modules/providers/router.py`
- Create: `apps/api/tests/llm_harness/test_trace.py`

**Interfaces:**
- Adapter returns provider response metadata including actual input/output token usage where available.
- `TaskResult.trace` has no raw user text or secrets; an inspection endpoint exposes layer sizes and source IDs to local developer UI.

- [x] **Step 1: Write failing tests** that simulate Ollama `prompt_eval_count` and `eval_count` and verify safe trace fields.

```python
def test_trace_records_actual_usage_without_prompt_text(client, fake_ollama):
    trace = client.get("/api/providers/traces/latest").json()
    assert trace["input_tokens_actual"] == 180
    assert "secret text" not in str(trace)
```

- [x] **Step 2: Run** the test to confirm the missing trace behavior.
- [x] **Step 3: Implement** usage propagation and bounded trace storage; keep the existing public turn response stable.
- [x] **Step 4: Run** all API tests and Ruff.
- [x] **Step 5: Commit** the task files.

## Exit gate

Run `uv run --directory apps/api --extra test pytest -q`, `uv run --directory apps/api --extra test ruff check app tests`, `npm --prefix apps/web test`, and `npm --prefix apps/web run build`. Confirm no LLM call remains outside the harness. Continue with a separate memory implementation plan from the same spec.
