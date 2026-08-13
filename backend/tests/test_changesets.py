from datetime import date

import pytest
from pydantic import ValidationError

from app.domain.changesets import (
    ChangeSetStatus,
    MoveTaskChange,
    RenameTaskChange,
    SetDurationChange,
    SetPredecessorsChange,
    apply_changeset,
    prepare_changeset,
)
from app.domain.errors import InvalidChangeSetError
from app.domain.models import PlanState
from app.domain.scheduling import schedule_finish_to_start


def scheduled_plan(task_factory, *tasks) -> PlanState:
    return schedule_finish_to_start(
        PlanState(tasks=tasks), date(2026, 8, 17)
    )


def test_batch_is_validated_as_one_final_state(task_factory) -> None:
    first = task_factory(1, name="Alpha")
    second = task_factory(2, name="Beta")
    source = scheduled_plan(task_factory, first, second)

    changeset = prepare_changeset(
        source,
        (
            RenameTaskChange(task_id=first.internal_id, name="Beta"),
            RenameTaskChange(task_id=second.internal_id, name="Alpha"),
        ),
    )

    assert changeset.status is ChangeSetStatus.AUTO_APPLICABLE
    assert [task.name for task in changeset.proposed_plan.tasks] == ["Beta", "Alpha"]
    assert [task.name for task in source.tasks] == ["Alpha", "Beta"]


def test_auto_applicable_changeset_applies_without_confirmation(task_factory) -> None:
    task = task_factory(1, name="A")
    source = scheduled_plan(task_factory, task)
    changeset = prepare_changeset(
        source, (RenameTaskChange(task_id=task.internal_id, name="Renamed"),)
    )

    applied = apply_changeset(source, changeset, confirmed=False)

    assert applied.tasks[0].name == "Renamed"
    assert source.tasks[0].name == "A"


def test_rename_rejects_reserved_excel_separator(task_factory) -> None:
    task = task_factory(1, name="A")

    with pytest.raises(
        ValidationError, match="reserved as the Excel predecessor separator"
    ):
        RenameTaskChange(task_id=task.internal_id, name="A; B")


def test_batch_moves_use_proposed_final_dates_not_intermediate_state(
    task_factory,
) -> None:
    first = task_factory(1, name="Backend", duration=2)
    second = task_factory(2, name="Testing", duration=2, predecessors=(1,))
    source = scheduled_plan(task_factory, first, second)

    changeset = prepare_changeset(
        source,
        (
            MoveTaskChange(task_id=first.internal_id, start_date=date(2026, 8, 20)),
            MoveTaskChange(task_id=second.internal_id, start_date=date(2026, 8, 24)),
        ),
    )

    assert changeset.status is ChangeSetStatus.AUTO_APPLICABLE
    assert changeset.proposed_impacts == ()


def test_conflicting_batch_is_fully_unapplied(task_factory) -> None:
    first = task_factory(1, name="A")
    second = task_factory(2, name="B", predecessors=(1,))
    source = scheduled_plan(task_factory, first, second)

    changeset = prepare_changeset(
        source,
        (
            RenameTaskChange(task_id=first.internal_id, name="Renamed A"),
            SetPredecessorsChange(
                task_id=first.internal_id,
                predecessor_ids=(second.internal_id,),
            ),
        ),
    )

    assert changeset.status is ChangeSetStatus.INVALID
    assert changeset.proposed_plan is None
    assert len(changeset.conflicts) == 1
    assert source.tasks[0].name == "A"


def test_transitive_downstream_impacts_are_consolidated(task_factory) -> None:
    tasks = (
        task_factory(1, name="A"),
        task_factory(2, name="B", predecessors=(1,)),
        task_factory(3, name="C", predecessors=(2,)),
        task_factory(4, name="D", predecessors=(3,)),
    )
    source = scheduled_plan(task_factory, *tasks)

    changeset = prepare_changeset(
        source,
        (
            MoveTaskChange(
                task_id=tasks[0].internal_id,
                start_date=date(2026, 8, 21),
            ),
        ),
    )

    assert changeset.status is ChangeSetStatus.CONFIRMATION_REQUIRED
    assert [impact.public_id for impact in changeset.proposed_impacts] == [
        "TASK-002",
        "TASK-003",
        "TASK-004",
    ]
    assert [impact.dependency_public_id for impact in changeset.proposed_impacts] == [
        "TASK-001",
        "TASK-002",
        "TASK-003",
    ]
    assert changeset.proposed_impacts[0].current_start_date == source.tasks[1].start_date
    assert source.tasks[1].start_date == date(2026, 8, 18)


def test_confirmation_required_changeset_remains_unapplied_until_confirmed(
    task_factory,
) -> None:
    first = task_factory(1, name="A")
    second = task_factory(2, name="B", predecessors=(1,))
    source = scheduled_plan(task_factory, first, second)
    changeset = prepare_changeset(
        source,
        (MoveTaskChange(task_id=first.internal_id, start_date=date(2026, 8, 21)),),
    )

    with pytest.raises(InvalidChangeSetError, match="confirmation"):
        apply_changeset(source, changeset, confirmed=False)

    applied = apply_changeset(source, changeset, confirmed=True)
    assert applied == changeset.proposed_plan
    assert source.tasks[0].start_date == date(2026, 8, 17)


def test_apply_revalidates_against_current_plan(task_factory) -> None:
    task = task_factory(1, name="A")
    source = scheduled_plan(task_factory, task)
    changeset = prepare_changeset(
        source, (RenameTaskChange(task_id=task.internal_id, name="Renamed"),)
    )
    changed_current = PlanState(
        tasks=(source.tasks[0].model_copy(update={"assignee": "Someone"}),)
    )

    with pytest.raises(InvalidChangeSetError, match="differs"):
        apply_changeset(changed_current, changeset, confirmed=True)


def test_apply_rejects_tampered_proposed_plan(task_factory) -> None:
    task = task_factory(1, name="A")
    source = scheduled_plan(task_factory, task)
    changeset = prepare_changeset(
        source, (RenameTaskChange(task_id=task.internal_id, name="Renamed"),)
    )
    tampered_plan = PlanState(
        tasks=(changeset.proposed_plan.tasks[0].model_copy(update={"name": "Tampered"}),)
    )
    tampered = changeset.model_copy(update={"proposed_plan": tampered_plan})

    with pytest.raises(InvalidChangeSetError, match="deterministic"):
        apply_changeset(source, tampered, confirmed=True)


def test_shortening_predecessor_does_not_pull_successor_forward(task_factory) -> None:
    first = task_factory(1, name="A", duration=3)
    second = task_factory(2, name="B", predecessors=(1,))
    source = scheduled_plan(task_factory, first, second)
    original_successor_start = source.tasks[1].start_date

    changeset = prepare_changeset(
        source,
        (SetDurationChange(task_id=first.internal_id, duration_workdays=1),),
    )

    assert changeset.status is ChangeSetStatus.AUTO_APPLICABLE
    assert changeset.proposed_plan.tasks[1].start_date == original_successor_start


def test_removing_dependency_does_not_pull_successor_forward(task_factory) -> None:
    first = task_factory(1, name="A", duration=3)
    second = task_factory(2, name="B", predecessors=(1,))
    source = scheduled_plan(task_factory, first, second)
    original_successor_start = source.tasks[1].start_date

    changeset = prepare_changeset(
        source,
        (SetPredecessorsChange(task_id=second.internal_id, predecessor_ids=()),),
    )

    assert changeset.status is ChangeSetStatus.AUTO_APPLICABLE
    assert changeset.proposed_plan.tasks[1].start_date == original_successor_start


def test_weekend_move_is_normalized_and_requires_confirmation(task_factory) -> None:
    task = task_factory(1, name="A")
    source = scheduled_plan(task_factory, task)

    changeset = prepare_changeset(
        source,
        (MoveTaskChange(task_id=task.internal_id, start_date=date(2026, 8, 22)),),
    )

    assert changeset.status is ChangeSetStatus.CONFIRMATION_REQUIRED
    assert changeset.date_normalizations[0].normalized_date == date(2026, 8, 24)
    assert changeset.proposed_plan.tasks[0].start_date == date(2026, 8, 24)
