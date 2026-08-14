import re
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from uuid import UUID

from app.domain.changesets import (
    AppendPlanChange,
    ChangeSet,
    RequestedChange,
    SetPredecessorsChange,
    prepare_changeset,
)
from app.domain.models import PlanState, Task, TaskSpec


class PlanningContextError(ValueError):
    """Raised when an MCP tool is used outside its request scope."""


class TaskResolutionError(ValueError):
    """Raised when a public TASK-ID or name cannot resolve uniquely."""


_NUMERIC_TASK_REFERENCE = re.compile(
    r"^(?:(?:task|задача)\s*(?:[-#№:]\s*)?)?0*(\d+)$",
    re.IGNORECASE,
)


def normalize_task_reference(identifier: str) -> str:
    """Map human numeric references to public IDs, never list positions."""
    stripped = identifier.strip()
    numeric_match = _NUMERIC_TASK_REFERENCE.fullmatch(stripped)
    if numeric_match is None:
        return stripped.casefold()
    task_number = int(numeric_match.group(1))
    return f"TASK-{task_number:03d}".casefold()


@dataclass(frozen=True, slots=True)
class ResolvedTask:
    internal_id: UUID
    public_id: str
    name: str
    task: Task | None = None


@dataclass(slots=True)
class PlanningRequestContext:
    plan: PlanState
    requested_changes: list[RequestedChange] = field(default_factory=list)
    clarification_question: str | None = None
    apply_authorized: bool = False
    applied_plan: PlanState | None = None

    def add_change(self, change: RequestedChange) -> None:
        self.requested_changes.append(change)

    def require_clarification(self, question: str) -> None:
        if self.clarification_question is None:
            self.clarification_question = question

    def prepare(self) -> ChangeSet:
        return prepare_changeset(self.plan, self.requested_changes)

    def projected_plan(self) -> PlanState:
        if not self.requested_changes:
            return self.plan
        changeset = self.prepare()
        return changeset.proposed_plan or self.plan

    def created_specs(self) -> tuple[TaskSpec, ...]:
        return tuple(
            spec
            for change in self.requested_changes
            if isinstance(change, AppendPlanChange)
            for spec in change.tasks
        )

    def resolve(self, identifier: str, *, include_pending: bool = True) -> ResolvedTask:
        normalized = normalize_task_reference(identifier)
        matches: list[ResolvedTask] = []
        for task in self.projected_plan().tasks:
            if (
                task.public_id.casefold() == normalized
                or task.name.casefold() == normalized
            ):
                matches.append(
                    ResolvedTask(
                        internal_id=task.internal_id,
                        public_id=task.public_id,
                        name=task.name,
                        task=task,
                    )
                )

        if include_pending:
            known_ids = {match.internal_id for match in matches}
            for spec in self.created_specs():
                if spec.internal_id in known_ids:
                    continue
                if (
                    spec.public_id.casefold() == normalized
                    or spec.name.casefold() == normalized
                ):
                    matches.append(
                        ResolvedTask(
                            internal_id=spec.internal_id,
                            public_id=spec.public_id,
                            name=spec.name,
                        )
                    )

        unique = {match.internal_id: match for match in matches}
        if not unique:
            raise TaskResolutionError(f"Task '{identifier}' was not found")
        if len(unique) > 1:
            raise TaskResolutionError(f"Task reference '{identifier}' is ambiguous")
        return next(iter(unique.values()))

    def existing_task(self, identifier: str) -> Task:
        resolved = self.resolve(identifier, include_pending=False)
        if resolved.task is None:
            raise TaskResolutionError(f"Task '{identifier}' is not an existing task")
        return resolved.task

    def predecessor_ids(self, task_id: UUID) -> tuple[UUID, ...]:
        for change in reversed(self.requested_changes):
            if (
                isinstance(change, SetPredecessorsChange)
                and change.task_id == task_id
            ):
                return change.predecessor_ids
        for task in self.plan.tasks:
            if task.internal_id == task_id:
                return task.predecessor_ids
        raise TaskResolutionError(f"Unknown task {task_id}")


_PLANNING_CONTEXT: ContextVar[PlanningRequestContext | None] = ContextVar(
    "planning_mcp_context", default=None
)


def current_planning_context() -> PlanningRequestContext:
    context = _PLANNING_CONTEXT.get()
    if context is None:
        raise PlanningContextError("MCP planning context is not bound")
    return context


@contextmanager
def bind_planning_context(context: PlanningRequestContext) -> Iterator[None]:
    token = _PLANNING_CONTEXT.set(context)
    try:
        yield
    finally:
        _PLANNING_CONTEXT.reset(token)
