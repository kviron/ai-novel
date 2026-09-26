from app.modules.story_engine.player_input import parse_player_input


def test_mixed_player_input_keeps_order_and_privacy():
    parts = parse_player_input("Я смутился. *Отвёл взгляд* «Всё хорошо», (надеюсь, она не заметила).")
    assert [(part.kind, part.text) for part in parts] == [
        ("action", "Я смутился."),
        ("explicit_action", "Отвёл взгляд"),
        ("speech", "Всё хорошо"),
        ("thought", "надеюсь, она не заметила"),
    ]


def test_unclosed_delimiters_remain_visible_text():
    assert [(part.kind, part.text) for part in parse_player_input("Смотрю на *дверь и думаю (поздно")] == [
        ("action", "Смотрю на *дверь и думаю (поздно"),
    ]
