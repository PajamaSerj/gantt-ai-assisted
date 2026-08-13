from datetime import date
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.domain.ids import TASK_ID_PATTERN

TASK_NAME_RESERVED_CHARACTER = ";"
TASK_NAME_RESERVED_CHARACTER_ERROR = (
    "Task name cannot contain ';': this character is reserved as the Excel "
    "predecessor separator"
)


def normalize_task_name(value: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise ValueError("name must not be empty")
    if TASK_NAME_RESERVED_CHARACTER in normalized:
        raise ValueError(TASK_NAME_RESERVED_CHARACTER_ERROR)
    return normalized


class CreatedSource(StrEnum):
    SEED = "seed"
    EXCEL = "excel"
    AI = "ai"


class Task(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    internal_id: UUID
    public_id: str
    name: str
    description: str | None = None
    assignee: str | None = None
    duration_workdays: int = Field(gt=0)
    predecessor_ids: tuple[UUID, ...] = ()
    start_date: date
    end_date: date
    created_source: CreatedSource

    @field_validator("public_id")
    @classmethod
    def validate_public_id(cls, value: str) -> str:
        match = TASK_ID_PATTERN.fullmatch(value)
        if match is None or int(match.group(1)) < 1:
            raise ValueError("public_id must use TASK-NNN format")
        return value

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        return normalize_task_name(value)

    @field_validator("description", "assignee")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @field_validator("predecessor_ids")
    @classmethod
    def validate_unique_predecessors(
        cls, value: tuple[UUID, ...]
    ) -> tuple[UUID, ...]:
        if len(value) != len(set(value)):
            raise ValueError("predecessor_ids must not contain duplicates")
        return value


class PlanState(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    tasks: tuple[Task, ...] = ()


class TaskSpec(BaseModel):
    """A task definition before deterministic scheduling assigns dates."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    internal_id: UUID
    public_id: str
    name: str
    description: str | None = None
    assignee: str | None = None
    duration_workdays: int = Field(gt=0)
    predecessor_ids: tuple[UUID, ...] = ()
    created_source: CreatedSource

    @field_validator("public_id")
    @classmethod
    def validate_public_id(cls, value: str) -> str:
        return Task.validate_public_id(value)

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        return Task.validate_name(value)

    @field_validator("description", "assignee")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        return Task.normalize_optional_text(value)

    @field_validator("predecessor_ids")
    @classmethod
    def validate_unique_predecessors(
        cls, value: tuple[UUID, ...]
    ) -> tuple[UUID, ...]:
        return Task.validate_unique_predecessors(value)
