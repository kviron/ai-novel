from pathlib import Path

from app.core.config import Settings


def test_default_env_file_is_anchored_at_repository_root():
    repository_root = Path(__file__).resolve().parents[3]

    assert Path(Settings.model_config["env_file"]) == repository_root / ".env"


def test_controlled_env_file_is_cwd_independent_and_init_values_win(tmp_path, monkeypatch):
    repository_root = tmp_path / "repository"
    api_directory = repository_root / "apps" / "api"
    api_directory.mkdir(parents=True)
    root_env = repository_root / ".env"
    root_env.write_text(
        "OLLAMA_MODEL=env:model\nOLLAMA_CONTEXT_TOKENS=4096\n",
        encoding="utf-8",
    )
    (api_directory / ".env").write_text("OLLAMA_MODEL=wrong-cwd:model\n", encoding="utf-8")
    monkeypatch.chdir(api_directory)

    from_dotenv = Settings(_env_file=root_env)
    monkeypatch.setenv("OLLAMA_MODEL", "process:model")
    from_process_env = Settings(_env_file=root_env)
    explicit = Settings(_env_file=root_env, ollama_model="explicit:model")

    assert from_dotenv.ollama_model == "env:model"
    assert from_dotenv.ollama_context_tokens == 4096
    assert from_process_env.ollama_model == "process:model"
    assert explicit.ollama_model == "explicit:model"
