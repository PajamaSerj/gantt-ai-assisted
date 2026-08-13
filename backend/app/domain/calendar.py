from datetime import date, timedelta

ONE_DAY = timedelta(days=1)


def is_working_day(value: date) -> bool:
    return value.weekday() < 5


def normalize_to_working_day(value: date) -> date:
    """Move a weekend date to the nearest following Monday."""
    normalized = value
    while not is_working_day(normalized):
        normalized += ONE_DAY
    return normalized


def next_working_day(value: date) -> date:
    return normalize_to_working_day(value + ONE_DAY)


def add_working_days(value: date, workdays: int) -> date:
    """Shift by N working days; zero normalizes a weekend to Monday."""
    if workdays < 0:
        raise ValueError("workdays must be non-negative")
    result = normalize_to_working_day(value)
    remaining = workdays
    while remaining:
        result += ONE_DAY
        if is_working_day(result):
            remaining -= 1
    return result


def end_date_for_duration(start_date: date, duration_workdays: int) -> date:
    if duration_workdays < 1:
        raise ValueError("duration_workdays must be positive")
    normalized_start = normalize_to_working_day(start_date)
    return add_working_days(normalized_start, duration_workdays - 1)
