from app.modules.characters.sprite_generation import SpriteGenerationRequest, sprite_system_prompt


def test_sprite_generation_contract_is_machine_checkable():
    request = SpriteGenerationRequest(
        character_id="ashley", revision_id="revision-1", emotion="angry", identity_prompt="Silver-haired elf"
    )
    assert request.sprite_contract_version == 1
    prompt = sprite_system_prompt()
    for constraint in ("1024x1536", "RGBA PNG", "transparent", "x=512", "y=1456", "y=1504", "one complete adult"):
        assert constraint in prompt
