import pytest

from app.domain.ids import format_public_id, next_public_id, public_ids_for_replace


def test_replace_ids_follow_valid_row_order() -> None:
    assert public_ids_for_replace(4) == [
        "TASK-001",
        "TASK-002",
        "TASK-003",
        "TASK-004",
    ]


def test_append_uses_maximum_existing_number_without_filling_gaps() -> None:
    assert next_public_id(["TASK-001", "TASK-003", "TASK-008"]) == "TASK-009"


def test_first_id_is_task_001() -> None:
    assert next_public_id([]) == "TASK-001"


def test_format_expands_beyond_three_digits_deterministically() -> None:
    assert format_public_id(1000) == "TASK-1000"


@pytest.mark.parametrize(
    ("operation", "argument"),
    [
        (public_ids_for_replace, -1),
        (format_public_id, 0),
        (next_public_id, ["task-001"]),
        (next_public_id, ["TASK-000"]),
    ],
)
def test_invalid_id_generation_input_is_rejected(operation, argument) -> None:
    with pytest.raises(ValueError):
        operation(argument)
