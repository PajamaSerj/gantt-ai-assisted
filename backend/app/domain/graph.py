from collections.abc import Iterable, Mapping, Sequence
from uuid import UUID

from app.domain.errors import (
    DependencyCycleError,
    DuplicateInternalIdError,
    SelfReferenceError,
    UnknownPredecessorError,
)
from app.domain.models import Task


def task_index(tasks: Iterable[Task]) -> dict[UUID, Task]:
    indexed: dict[UUID, Task] = {}
    for task in tasks:
        if task.internal_id in indexed:
            raise DuplicateInternalIdError(task.internal_id)
        indexed[task.internal_id] = task
    return indexed


def topological_order(tasks: Sequence[Task]) -> list[UUID]:
    """Validate predecessor references and return stable dependency order."""
    indexed = task_index(tasks)

    for task in tasks:
        for predecessor_id in task.predecessor_ids:
            if predecessor_id == task.internal_id:
                raise SelfReferenceError(task.internal_id)
            if predecessor_id not in indexed:
                raise UnknownPredecessorError(task.internal_id, predecessor_id)

    visited: set[UUID] = set()
    visiting: set[UUID] = set()
    path: list[UUID] = []
    order: list[UUID] = []

    def visit(task_id: UUID) -> None:
        if task_id in visited:
            return
        if task_id in visiting:
            cycle_start = path.index(task_id)
            raise DependencyCycleError([*path[cycle_start:], task_id])

        visiting.add(task_id)
        path.append(task_id)
        for predecessor_id in indexed[task_id].predecessor_ids:
            visit(predecessor_id)
        path.pop()
        visiting.remove(task_id)
        visited.add(task_id)
        order.append(task_id)

    for task in tasks:
        visit(task.internal_id)

    return order


def successors_by_task(tasks: Sequence[Task]) -> Mapping[UUID, tuple[UUID, ...]]:
    indexed = task_index(tasks)
    successors: dict[UUID, list[UUID]] = {task_id: [] for task_id in indexed}
    for task in tasks:
        for predecessor_id in task.predecessor_ids:
            if predecessor_id not in indexed:
                raise UnknownPredecessorError(task.internal_id, predecessor_id)
            successors[predecessor_id].append(task.internal_id)
    return {task_id: tuple(task_ids) for task_id, task_ids in successors.items()}
