import hashlib
import json
from collections.abc import Sequence
from datetime import date
from enum import StrEnum
from typing import Annotated, Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.domain.calendar import (
    end_date_for_duration,
    next_working_day,
    normalize_to_working_day,
)
from app.domain.errors import (
    DependencyCycleError,
    DomainValidationError,
    InvalidChangeSetError,
    UnknownTaskError,
)
from app.domain.graph import task_index, topological_order
from app.domain.models import PlanState, Task, TaskSpec
from app.domain.validation import validate_plan_schedule, validate_plan_structure


class ChangeSetStatus(StrEnum):
    AUTO_APPLICABLE = "AUTO_APPLICABLE"
    CONFIRMATION_REQUIRED = "CONFIRMATION_REQUIRED"
    INVALID = "INVALID"


class ReplacePlanChange(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    type: Literal["replace_plan"] = "replace_plan"
    tasks: tuple[TaskSpec, ...]
    plan_start_date: date


class AppendPlanChange(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    type: Literal["append_plan"] = "append_plan"
    tasks: tuple[TaskSpec, ...]
    minimum_start_date: date


class RenameTaskChange(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    type: Literal["rename_task"] = "rename_task"
    task_id: UUID
    name: str

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        return Task.validate_name(value)


class SetDescriptionChange(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    type: Literal["set_description"] = "set_description"
    task_id: UUID
    description: str | None

    @field_validator("description")
    @classmethod
    def normalize_description(cls, value: str | None) -> str | None:
        return Task.normalize_optional_text(value)


class SetDurationChange(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    type: Literal["set_duration"] = "set_duration"
    task_id: UUID
    duration_workdays: int = Field(gt=0)


class MoveTaskChange(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    type: Literal["move_task"] = "move_task"
    task_id: UUID
    start_date: date


class SetAssigneeChange(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    type: Literal["set_assignee"] = "set_assignee"
    task_id: UUID
    assignee: str | None

    @field_validator("assignee")
    @classmethod
    def normalize_assignee(cls, value: str | None) -> str | None:
        return Task.normalize_optional_text(value)


class SetPredecessorsChange(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    type: Literal["set_predecessors"] = "set_predecessors"
    task_id: UUID
    predecessor_ids: tuple[UUID, ...]

    @field_validator("predecessor_ids")
    @classmethod
    def validate_unique_predecessors(
        cls, value: tuple[UUID, ...]
    ) -> tuple[UUID, ...]:
        return Task.validate_unique_predecessors(value)


RequestedChange = Annotated[
    ReplacePlanChange
    | AppendPlanChange
    | RenameTaskChange
    | SetDescriptionChange
    | SetDurationChange
    | MoveTaskChange
    | SetAssigneeChange
    | SetPredecessorsChange,
    Field(discriminator="type"),
]


class AffectedTask(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    internal_id: UUID
    public_id: str
    name: str


class ChangeConflict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    code: str
    message: str
    task_public_id: str | None = None
    related_task_public_ids: tuple[str, ...] = ()


class ProposedImpact(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    internal_id: UUID
    public_id: str
    task_name: str
    current_start_date: date
    current_end_date: date
    proposed_start_date: date
    proposed_end_date: date
    reason: str
    dependency_internal_id: UUID
    dependency_public_id: str
    dependency_name: str


class DateNormalization(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    context: str
    requested_date: date
    normalized_date: date
    task_public_id: str | None = None


class ConfirmationReason(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    code: str
    message: str
    task_public_ids: tuple[str, ...] = ()


class ChangeSet(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    changeset_id: UUID = Field(default_factory=uuid4)
    source_plan_digest: str
    requested_changes: tuple[RequestedChange, ...]
    affected_tasks: tuple[AffectedTask, ...] = ()
    conflicts: tuple[ChangeConflict, ...] = ()
    proposed_impacts: tuple[ProposedImpact, ...] = ()
    date_normalizations: tuple[DateNormalization, ...] = ()
    confirmation_reasons: tuple[ConfirmationReason, ...] = ()
    status: ChangeSetStatus
    proposed_plan: PlanState | None = None


def plan_digest(plan: PlanState) -> str:
    canonical = json.dumps(
        plan.model_dump(mode="json"),
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def changeset_has_effect(changeset: ChangeSet, source_plan: PlanState) -> bool:
    """Compare the complete deterministic final plan with its source snapshot."""
    if changeset.proposed_plan is None:
        raise InvalidChangeSetError("ChangeSet has no proposed PlanState")
    return changeset.proposed_plan != source_plan


def _validated_task_update(task: Task, **updates: object) -> Task:
    data = task.model_dump()
    data.update(updates)
    return Task.model_validate(data)


def _task_from_spec(spec: TaskSpec, minimum_start_date: date) -> Task:
    start_date = normalize_to_working_day(minimum_start_date)
    return Task(
        **spec.model_dump(),
        start_date=start_date,
        end_date=end_date_for_duration(start_date, spec.duration_workdays),
    )


def _normalization(
    *, context: str, requested_date: date, task_public_id: str | None = None
) -> DateNormalization | None:
    normalized_date = normalize_to_working_day(requested_date)
    if requested_date == normalized_date:
        return None
    return DateNormalization(
        context=context,
        requested_date=requested_date,
        normalized_date=normalized_date,
        task_public_id=task_public_id,
    )


def _apply_requested_changes(
    source_plan: PlanState, requested_changes: Sequence[RequestedChange]
) -> tuple[PlanState, set[UUID], tuple[DateNormalization, ...]]:
    replace_changes = [
        change for change in requested_changes if isinstance(change, ReplacePlanChange)
    ]
    if replace_changes and len(requested_changes) != 1:
        raise InvalidChangeSetError("replace_plan cannot be combined with other changes")

    tasks = list(source_plan.tasks)
    affected_ids: set[UUID] = set()
    normalizations: list[DateNormalization] = []

    for change in requested_changes:
        if isinstance(change, ReplacePlanChange):
            tasks = [
                _task_from_spec(spec, change.plan_start_date) for spec in change.tasks
            ]
            affected_ids.update(task.internal_id for task in tasks)
            normalization = _normalization(
                context="replace_plan_start",
                requested_date=change.plan_start_date,
            )
            if normalization:
                normalizations.append(normalization)
            continue

        if isinstance(change, AppendPlanChange):
            incoming = [
                _task_from_spec(spec, change.minimum_start_date)
                for spec in change.tasks
            ]
            tasks.extend(incoming)
            affected_ids.update(task.internal_id for task in incoming)
            normalization = _normalization(
                context="append_minimum_start",
                requested_date=change.minimum_start_date,
            )
            if normalization:
                normalizations.append(normalization)
            continue

        indexed = {task.internal_id: index for index, task in enumerate(tasks)}
        task_id = change.task_id
        if task_id not in indexed:
            raise UnknownTaskError(task_id)
        position = indexed[task_id]
        task = tasks[position]
        affected_ids.add(task_id)

        if isinstance(change, RenameTaskChange):
            tasks[position] = _validated_task_update(task, name=change.name)
        elif isinstance(change, SetDescriptionChange):
            tasks[position] = _validated_task_update(
                task, description=change.description
            )
        elif isinstance(change, SetDurationChange):
            tasks[position] = _validated_task_update(
                task,
                duration_workdays=change.duration_workdays,
                end_date=end_date_for_duration(
                    task.start_date, change.duration_workdays
                ),
            )
        elif isinstance(change, MoveTaskChange):
            start_date = normalize_to_working_day(change.start_date)
            tasks[position] = _validated_task_update(
                task,
                start_date=start_date,
                end_date=end_date_for_duration(
                    start_date, task.duration_workdays
                ),
            )
            normalization = _normalization(
                context="task_move",
                requested_date=change.start_date,
                task_public_id=task.public_id,
            )
            if normalization:
                normalizations.append(normalization)
        elif isinstance(change, SetAssigneeChange):
            tasks[position] = _validated_task_update(task, assignee=change.assignee)
        elif isinstance(change, SetPredecessorsChange):
            tasks[position] = _validated_task_update(
                task, predecessor_ids=change.predecessor_ids
            )

    return PlanState(tasks=tuple(tasks)), affected_ids, tuple(normalizations)


def _propagate_required_shifts(
    raw_plan: PlanState,
    source_plan: PlanState,
) -> tuple[PlanState, tuple[ProposedImpact, ...]]:
    indexed = task_index(raw_plan.tasks)
    source_indexed = task_index(source_plan.tasks)
    scheduled = dict(indexed)
    impacts: list[ProposedImpact] = []

    for task_id in topological_order(raw_plan.tasks):
        task = scheduled[task_id]
        if not task.predecessor_ids:
            continue

        predecessor = max(
            (scheduled[predecessor_id] for predecessor_id in task.predecessor_ids),
            key=lambda candidate: candidate.end_date,
        )
        required_start = next_working_day(predecessor.end_date)
        if task.start_date >= required_start:
            continue

        shifted = _validated_task_update(
            task,
            start_date=required_start,
            end_date=end_date_for_duration(
                required_start, task.duration_workdays
            ),
        )
        scheduled[task_id] = shifted
        current_task = source_indexed.get(task_id, task)
        impacts.append(
            ProposedImpact(
                internal_id=task.internal_id,
                public_id=task.public_id,
                task_name=task.name,
                current_start_date=current_task.start_date,
                current_end_date=current_task.end_date,
                proposed_start_date=shifted.start_date,
                proposed_end_date=shifted.end_date,
                reason=(
                    f"{task.public_id} must start after "
                    f"{predecessor.public_id} finishes"
                ),
                dependency_internal_id=predecessor.internal_id,
                dependency_public_id=predecessor.public_id,
                dependency_name=predecessor.name,
            )
        )

    return (
        PlanState(
            tasks=tuple(scheduled[task.internal_id] for task in raw_plan.tasks)
        ),
        tuple(impacts),
    )


def _conflict_from_error(
    error: DomainValidationError, candidate_plan: PlanState | None
) -> ChangeConflict:
    indexed: dict[UUID, Task] = {}
    if candidate_plan:
        for candidate in candidate_plan.tasks:
            indexed.setdefault(candidate.internal_id, candidate)
    task_id = getattr(error, "task_id", None)
    task = indexed.get(task_id)
    related: tuple[str, ...] = ()
    if isinstance(error, DependencyCycleError):
        related = tuple(
            indexed[task_id].public_id
            for task_id in error.cycle_path
            if task_id in indexed
        )
    return ChangeConflict(
        code=error.__class__.__name__,
        message=str(error),
        task_public_id=task.public_id if task else None,
        related_task_public_ids=related,
    )


def _assignee_confirmation_reasons(
    source_plan: PlanState,
    proposed_plan: PlanState,
    requested_changes: Sequence[RequestedChange],
) -> tuple[ConfirmationReason, ...]:
    target_ids = {
        change.task_id
        for change in requested_changes
        if isinstance(change, SetAssigneeChange)
    }
    if not target_ids:
        return ()

    known_assignees = {
        task.assignee.casefold()
        for task in source_plan.tasks
        if task.assignee is not None
    }
    new_assignments: dict[str, tuple[str, list[str]]] = {}
    for task in proposed_plan.tasks:
        if task.internal_id not in target_ids or task.assignee is None:
            continue
        key = task.assignee.casefold()
        if key in known_assignees:
            continue
        display_name, public_ids = new_assignments.setdefault(
            key, (task.assignee, [])
        )
        public_ids.append(task.public_id)
        new_assignments[key] = (display_name, public_ids)

    return tuple(
        ConfirmationReason(
            code="NEW_ASSIGNEE",
            message=(
                f"Assignee '{display_name}' is not currently used in the plan"
            ),
            task_public_ids=tuple(public_ids),
        )
        for display_name, public_ids in new_assignments.values()
    )


def prepare_changeset(
    source_plan: PlanState,
    requested_changes: Sequence[RequestedChange],
) -> ChangeSet:
    """Build and validate one proposed final PlanState without mutating source."""
    changes = tuple(requested_changes)
    candidate: PlanState | None = None
    affected_ids: set[UUID] = set()

    try:
        validate_plan_schedule(source_plan)
        candidate, affected_ids, normalizations = _apply_requested_changes(
            source_plan, changes
        )
        validate_plan_structure(candidate)
        proposed_plan, impacts = _propagate_required_shifts(candidate, source_plan)
        validate_plan_schedule(proposed_plan)
    except DomainValidationError as error:
        return ChangeSet(
            source_plan_digest=plan_digest(source_plan),
            requested_changes=changes,
            affected_tasks=(),
            conflicts=(_conflict_from_error(error, candidate),),
            status=ChangeSetStatus.INVALID,
            proposed_plan=None,
        )

    confirmation_reasons = _assignee_confirmation_reasons(
        source_plan, proposed_plan, changes
    )
    affected_ids.update(impact.internal_id for impact in impacts)
    affected_tasks = tuple(
        AffectedTask(
            internal_id=task.internal_id,
            public_id=task.public_id,
            name=task.name,
        )
        for task in proposed_plan.tasks
        if task.internal_id in affected_ids
    )
    status = (
        ChangeSetStatus.CONFIRMATION_REQUIRED
        if impacts or normalizations or confirmation_reasons
        else ChangeSetStatus.AUTO_APPLICABLE
    )
    return ChangeSet(
        source_plan_digest=plan_digest(source_plan),
        requested_changes=changes,
        affected_tasks=affected_tasks,
        proposed_impacts=impacts,
        date_normalizations=normalizations,
        confirmation_reasons=confirmation_reasons,
        status=status,
        proposed_plan=proposed_plan,
    )


def apply_changeset(
    current_plan: PlanState,
    changeset: ChangeSet,
    *,
    confirmed: bool,
) -> PlanState:
    """Rebuild and revalidate a ChangeSet before returning its new snapshot."""
    if changeset.source_plan_digest != plan_digest(current_plan):
        raise InvalidChangeSetError(
            "Current PlanState differs from the ChangeSet source snapshot"
        )

    rebuilt = prepare_changeset(current_plan, changeset.requested_changes)
    if rebuilt.status is ChangeSetStatus.INVALID:
        message = rebuilt.conflicts[0].message if rebuilt.conflicts else "Invalid ChangeSet"
        raise InvalidChangeSetError(message)
    if (
        rebuilt.proposed_plan != changeset.proposed_plan
        or rebuilt.proposed_impacts != changeset.proposed_impacts
        or rebuilt.date_normalizations != changeset.date_normalizations
        or rebuilt.confirmation_reasons != changeset.confirmation_reasons
        or rebuilt.status != changeset.status
    ):
        raise InvalidChangeSetError("ChangeSet no longer matches deterministic planning")
    if rebuilt.status is ChangeSetStatus.CONFIRMATION_REQUIRED and not confirmed:
        raise InvalidChangeSetError("Explicit confirmation is required")
    if rebuilt.proposed_plan is None:
        raise InvalidChangeSetError("ChangeSet has no proposed PlanState")
    return rebuilt.proposed_plan
