import re
from collections.abc import Iterable

TASK_ID_PATTERN = re.compile(r"^TASK-(\d{3,})$")


def format_public_id(number: int) -> str:
    if number < 1:
        raise ValueError("TASK-ID number must be positive")
    return f"TASK-{number:03d}"


def public_ids_for_replace(task_count: int) -> list[str]:
    """Generate TASK-IDs in valid input row order for a Replace import."""
    if task_count < 0:
        raise ValueError("Task count cannot be negative")
    return [format_public_id(number) for number in range(1, task_count + 1)]


def next_public_id(existing_public_ids: Iterable[str]) -> str:
    """Generate max(existing TASK number) + 1 without filling gaps."""
    maximum = 0
    for public_id in existing_public_ids:
        match = TASK_ID_PATTERN.fullmatch(public_id)
        if match is None:
            raise ValueError(f"Invalid TASK-ID: {public_id}")
        number = int(match.group(1))
        if number < 1:
            raise ValueError(f"Invalid TASK-ID: {public_id}")
        maximum = max(maximum, number)
    return format_public_id(maximum + 1)
