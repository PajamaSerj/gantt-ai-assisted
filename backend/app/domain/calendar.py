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


def shift_working_days(value: date, offset: int) -> date:
    """Shift a date by a signed number of Monday-Friday working days."""
    if offset >= 0:
        return add_working_days(value, offset)

    result = normalize_to_working_day(value)
    remaining = -offset
    while remaining:
        result -= ONE_DAY
        if is_working_day(result):
            remaining -= 1
    return result


def end_date_for_duration(start_date: date, duration_workdays: int) -> date:
    if duration_workdays < 1:
        raise ValueError("duration_workdays must be positive")
    normalized_start = normalize_to_working_day(start_date)
    return add_working_days(normalized_start, duration_workdays - 1)


def working_days_inclusive(start_date: date, end_date: date) -> int:
    """Count Monday-Friday dates in an inclusive visual date range."""
    if end_date < start_date:
        raise ValueError("end_date must not be before start_date")
    cursor = start_date
    count = 0
    while cursor <= end_date:
        if is_working_day(cursor):
            count += 1
        cursor += ONE_DAY
    return count
