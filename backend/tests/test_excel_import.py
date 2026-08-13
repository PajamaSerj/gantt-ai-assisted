from datetime import date
from io import BytesIO

import pytest
from openpyxl import Workbook

from app.domain.changesets import ChangeSetStatus, apply_changeset
from app.domain.errors import InvalidChangeSetError
from app.domain.models import PlanState
from app.seed.data import get_seed_plan
from app.services.excel_import import REQUIRED_COLUMNS, parse_xlsx
from app.services.import_planning import ImportMode, prepare_import


def workbook_bytes(
    rows: list[tuple],
    *,
    headers: tuple[str, ...] = REQUIRED_COLUMNS,
    active_second_sheet: bool = False,
) -> bytes:
    workbook = Workbook()
    worksheet = workbook.active
    if active_second_sheet:
        worksheet.append(("not", "the", "required", "structure"))
        worksheet = workbook.create_sheet("Active Plan")
        workbook.active = 1
    worksheet.append(headers)
    for row in rows:
        worksheet.append(row)
    output = BytesIO()
    workbook.save(output)
    workbook.close()
    return output.getvalue()


def prepare_replace(rows: list[tuple], start: date = date(2026, 8, 17)):
    return prepare_import(
        file_name="tasks.xlsx",
        content=workbook_bytes(rows),
        mode=ImportMode.REPLACE,
        date_constraint=start,
        current_plan=PlanState(),
    )


def test_valid_xlsx_normalizes_headers_and_ignores_extra_columns() -> None:
    content = workbook_bytes(
        [("Discovery", "Scope", "Anna", 2, None, "ignored")],
        headers=(
            " ЗАДАЧА ",
            "Описание",
            "ИСПОЛНИТЕЛЬ",
            " длительность ",
            "Предшественники",
            "Extra",
        ),
    )

    parsed = parse_xlsx("TASKS.XLSX", content)

    assert parsed.issues == ()
    assert parsed.rows[0].name == "Discovery"
    assert parsed.rows[0].duration_workdays == 2


def test_only_active_worksheet_is_processed() -> None:
    content = workbook_bytes(
        [("Discovery", None, None, 1, None)], active_second_sheet=True
    )

    parsed = parse_xlsx("tasks.xlsx", content)

    assert parsed.issues == ()
    assert [row.name for row in parsed.rows] == ["Discovery"]


def test_non_xlsx_file_is_rejected() -> None:
    parsed = parse_xlsx("tasks.xls", b"not a workbook")

    assert [issue.code for issue in parsed.issues] == ["INVALID_EXTENSION"]


def test_unreadable_xlsx_is_rejected() -> None:
    parsed = parse_xlsx("tasks.xlsx", b"not a zip archive")

    assert [issue.code for issue in parsed.issues] == ["UNREADABLE_WORKBOOK"]


def test_missing_columns_are_reported_together() -> None:
    content = workbook_bytes([], headers=("задача", "длительность"))

    parsed = parse_xlsx("tasks.xlsx", content)

    assert {issue.column for issue in parsed.issues} == {
        "описание",
        "исполнитель",
        "предшественники",
    }


def test_invalid_durations_are_collected_with_row_numbers() -> None:
    content = workbook_bytes(
        [
            ("A", None, None, 0, None),
            ("B", None, None, 1.5, None),
            ("C", None, None, "two", None),
        ]
    )

    parsed = parse_xlsx("tasks.xlsx", content)

    assert [(issue.code, issue.row) for issue in parsed.issues] == [
        ("INVALID_DURATION", 2),
        ("INVALID_DURATION", 3),
        ("INVALID_DURATION", 4),
    ]


def test_duplicate_task_names_are_rejected_case_insensitively() -> None:
    preparation = prepare_replace(
        [
            ("Backend", None, None, 1, None),
            ("backend", None, None, 1, None),
        ]
    )

    assert preparation.status == "VALIDATION_FAILED"
    assert preparation.issues[0].code == "DUPLICATE_TASK_NAME"


def test_task_name_with_reserved_separator_is_rejected_atomically() -> None:
    current = get_seed_plan()
    preparation = prepare_import(
        file_name="append.xlsx",
        content=workbook_bytes(
            [
                ("Valid task", None, None, 1, None),
                ("Invalid; task", None, None, 1, None),
            ]
        ),
        mode=ImportMode.APPEND,
        date_constraint=date(2026, 3, 3),
        current_plan=current,
    )

    assert preparation.status == "VALIDATION_FAILED"
    assert preparation.changeset is None
    assert preparation.unchanged_plan == current
    assert [(issue.code, issue.row, issue.column) for issue in preparation.issues] == [
        ("INVALID_TASK_NAME", 3, "задача")
    ]
    assert "reserved as the Excel predecessor separator" in preparation.issues[0].message


def test_unknown_predecessor_is_rejected_atomically() -> None:
    current = get_seed_plan()
    preparation = prepare_import(
        file_name="tasks.xlsx",
        content=workbook_bytes(
            [("Review", None, None, 1, "Missing task")]
        ),
        mode=ImportMode.APPEND,
        date_constraint=date(2026, 3, 3),
        current_plan=current,
    )

    assert preparation.status == "VALIDATION_FAILED"
    assert preparation.changeset is None
    assert preparation.unchanged_plan == current
    assert preparation.issues[0].code == "UNKNOWN_PREDECESSOR"


def test_self_reference_is_rejected() -> None:
    preparation = prepare_replace(
        [("Backend", None, None, 1, "Backend")]
    )

    assert preparation.issues[0].code == "SELF_REFERENCE"


def test_dependency_cycle_is_rejected() -> None:
    preparation = prepare_replace(
        [
            ("A", None, None, 1, "C"),
            ("B", None, None, 1, "A"),
            ("C", None, None, 1, "B"),
        ]
    )

    assert preparation.status == "VALIDATION_FAILED"
    assert preparation.issues[0].code == "DEPENDENCY_CYCLE"
    assert "TASK-001" in preparation.issues[0].message


def test_replace_generates_ids_and_consolidated_dependency_impacts() -> None:
    preparation = prepare_replace(
        [
            ("A", None, "Anna", 2, None),
            ("B", None, "Boris", 1, "A"),
            ("C", None, "Clara", 1, "B"),
        ]
    )

    assert preparation.status == ChangeSetStatus.CONFIRMATION_REQUIRED.value
    changeset = preparation.changeset
    assert [task.public_id for task in changeset.proposed_plan.tasks] == [
        "TASK-001",
        "TASK-002",
        "TASK-003",
    ]
    assert [impact.public_id for impact in changeset.proposed_impacts] == [
        "TASK-002",
        "TASK-003",
    ]


def test_blank_rows_do_not_create_task_id_gaps() -> None:
    preparation = prepare_import(
        file_name="tasks.xlsx",
        content=workbook_bytes(
            [
                ("A", None, None, 1, None),
                (None, None, None, None, None),
                ("B", None, None, 1, None),
            ]
        ),
        mode=ImportMode.REPLACE,
        date_constraint=date(2026, 8, 17),
        current_plan=PlanState(),
    )

    assert preparation.status == ChangeSetStatus.AUTO_APPLICABLE.value
    assert [task.public_id for task in preparation.changeset.proposed_plan.tasks] == [
        "TASK-001",
        "TASK-002",
    ]


def test_append_resolves_existing_task_and_continues_public_ids() -> None:
    current = get_seed_plan()
    preparation = prepare_import(
        file_name="append.xlsx",
        content=workbook_bytes(
            [("Retrospective", None, "Anna", 1, "Demo readiness")]
        ),
        mode=ImportMode.APPEND,
        date_constraint=date(2026, 3, 2),
        current_plan=current,
    )

    assert preparation.status == ChangeSetStatus.CONFIRMATION_REQUIRED.value
    appended = preparation.changeset.proposed_plan.tasks[-1]
    assert appended.public_id == "TASK-008"
    assert appended.predecessor_ids == (current.tasks[-1].internal_id,)
    assert appended.start_date == date(2026, 3, 3)


def test_append_resolves_dependencies_between_incoming_tasks() -> None:
    current = get_seed_plan()
    preparation = prepare_import(
        file_name="append.xlsx",
        content=workbook_bytes(
            [
                ("Release notes", None, "Anna", 1, None),
                ("Publish notes", None, "Anna", 1, "Release notes"),
            ]
        ),
        mode=ImportMode.APPEND,
        date_constraint=date(2026, 3, 3),
        current_plan=current,
    )

    new_tasks = preparation.changeset.proposed_plan.tasks[-2:]
    assert [task.public_id for task in new_tasks] == ["TASK-008", "TASK-009"]
    assert new_tasks[1].predecessor_ids == (new_tasks[0].internal_id,)
    assert [task.public_id for task in current.tasks] == [
        f"TASK-{number:03d}" for number in range(1, 8)
    ]


def test_append_duplicate_across_current_and_incoming_is_atomic() -> None:
    current = get_seed_plan()
    preparation = prepare_import(
        file_name="append.xlsx",
        content=workbook_bytes(
            [(current.tasks[0].name, None, None, 1, None)]
        ),
        mode=ImportMode.APPEND,
        date_constraint=date(2026, 3, 3),
        current_plan=current,
    )

    assert preparation.status == "VALIDATION_FAILED"
    assert preparation.changeset is None
    assert preparation.unchanged_plan == current
    assert preparation.issues[0].code == "DUPLICATE_TASK_NAME"


def test_weekend_import_date_is_normalized_with_preview() -> None:
    preparation = prepare_replace(
        [("A", None, None, 1, None)], start=date(2026, 8, 22)
    )

    assert preparation.status == ChangeSetStatus.CONFIRMATION_REQUIRED.value
    normalization = preparation.changeset.date_normalizations[0]
    assert normalization.requested_date == date(2026, 8, 22)
    assert normalization.normalized_date == date(2026, 8, 24)
    assert preparation.changeset.proposed_plan.tasks[0].start_date == date(
        2026, 8, 24
    )


def test_replace_changeset_rejects_changed_current_snapshot() -> None:
    current = get_seed_plan()
    preparation = prepare_import(
        file_name="tasks.xlsx",
        content=workbook_bytes([("A", None, None, 1, None)]),
        mode=ImportMode.REPLACE,
        date_constraint=date(2026, 8, 17),
        current_plan=current,
    )
    changed = PlanState(
        tasks=(
            current.tasks[0].model_copy(update={"assignee": "Changed"}),
            *current.tasks[1:],
        )
    )

    with pytest.raises(InvalidChangeSetError, match="differs"):
        apply_changeset(changed, preparation.changeset, confirmed=True)
