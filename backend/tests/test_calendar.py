from datetime import date

import pytest

from app.domain.calendar import (
    add_working_days,
    end_date_for_duration,
    is_working_day,
    next_working_day,
    normalize_to_working_day,
    shift_working_days,
)


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (date(2026, 8, 21), True),
        (date(2026, 8, 22), False),
        (date(2026, 8, 23), False),
        (date(2026, 8, 24), True),
    ],
)
def test_is_working_day(value: date, expected: bool) -> None:
    assert is_working_day(value) is expected


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (date(2026, 8, 21), date(2026, 8, 21)),
        (date(2026, 8, 22), date(2026, 8, 24)),
        (date(2026, 8, 23), date(2026, 8, 24)),
    ],
)
def test_weekend_normalization(value: date, expected: date) -> None:
    assert normalize_to_working_day(value) == expected


def test_next_working_day_skips_weekend() -> None:
    assert next_working_day(date(2026, 8, 21)) == date(2026, 8, 24)


def test_add_working_days_skips_weekend() -> None:
    assert add_working_days(date(2026, 8, 20), 3) == date(2026, 8, 25)


def test_shift_working_days_supports_signed_offsets() -> None:
    assert shift_working_days(date(2026, 8, 24), -1) == date(2026, 8, 21)
    assert shift_working_days(date(2026, 8, 24), 2) == date(2026, 8, 26)


def test_duration_is_inclusive_of_start_date() -> None:
    assert end_date_for_duration(date(2026, 8, 17), 3) == date(2026, 8, 19)


def test_duration_crosses_weekend() -> None:
    assert end_date_for_duration(date(2026, 8, 20), 3) == date(2026, 8, 24)


def test_weekend_start_is_normalized_before_duration_calculation() -> None:
    assert end_date_for_duration(date(2026, 8, 22), 2) == date(2026, 8, 25)


@pytest.mark.parametrize(
    ("function", "arguments"),
    [
        (add_working_days, (date(2026, 8, 17), -1)),
        (end_date_for_duration, (date(2026, 8, 17), 0)),
    ],
)
def test_invalid_workday_counts_are_rejected(function, arguments) -> None:
    with pytest.raises(ValueError):
        function(*arguments)
