from uuid import UUID

import pytest

from app.domain.errors import (
    DependencyCycleError,
    SelfReferenceError,
    UnknownPredecessorError,
)
from app.domain.graph import successors_by_task, topological_order


def test_valid_dependency_order_is_stable(task_factory) -> None:
    tasks = (
        task_factory(3, predecessors=(1, 2)),
        task_factory(1),
        task_factory(2, predecessors=(1,)),
    )

    assert topological_order(tasks) == [
        tasks[1].internal_id,
        tasks[2].internal_id,
        tasks[0].internal_id,
    ]


def test_successors_are_derived_from_predecessors(task_factory) -> None:
    first = task_factory(1)
    second = task_factory(2, predecessors=(1,))
    third = task_factory(3, predecessors=(1, 2))

    successors = successors_by_task((first, second, third))

    assert successors[first.internal_id] == (second.internal_id, third.internal_id)
    assert successors[second.internal_id] == (third.internal_id,)
    assert successors[third.internal_id] == ()


def test_unknown_predecessor_is_rejected(task_factory) -> None:
    task = task_factory(1, predecessors=(99,))

    with pytest.raises(UnknownPredecessorError) as error:
        topological_order((task,))

    assert error.value.task_id == task.internal_id


def test_self_reference_is_rejected(task_factory) -> None:
    task = task_factory(1, predecessors=(1,))

    with pytest.raises(SelfReferenceError):
        topological_order((task,))


def test_cycle_is_rejected_with_closed_path(task_factory) -> None:
    tasks = (
        task_factory(1, predecessors=(3,)),
        task_factory(2, predecessors=(1,)),
        task_factory(3, predecessors=(2,)),
    )

    with pytest.raises(DependencyCycleError) as error:
        topological_order(tasks)

    assert error.value.cycle_path == (
        UUID("00000000-0000-4000-8000-000000000001"),
        UUID("00000000-0000-4000-8000-000000000003"),
        UUID("00000000-0000-4000-8000-000000000002"),
        UUID("00000000-0000-4000-8000-000000000001"),
    )
