import json

from app.db.models import MemorySegment
from app.modules.story_engine.memory import select_cached_prefix


def test_summary_from_abandoned_branch_is_not_reused():
    common = MemorySegment(session_id="session", end_turn_id="a", source_turn_ids=json.dumps(["a"]), summary="A")
    abandoned = MemorySegment(
        session_id="session", end_turn_id="x", source_turn_ids=json.dumps(["a", "x"]), summary="Wrong branch"
    )

    segment, count = select_cached_prefix([common, abandoned], ["a", "b"])

    assert segment is common
    assert count == 1
