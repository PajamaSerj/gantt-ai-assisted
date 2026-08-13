from collections.abc import Sequence
from uuid import UUID


class DomainValidationError(ValueError):
    """Base class for deterministic plan validation errors."""


class DuplicateTaskNameError(DomainValidationError):
    def __init__(self, duplicate_names: Sequence[str]) -> None:
        self.duplicate_names = tuple(duplicate_names)
        super().__init__(
            "Task names must be unique: " + ", ".join(self.duplicate_names)
        )


class UnknownPredecessorError(DomainValidationError):
    def __init__(self, task_id: UUID, predecessor_id: UUID) -> None:
        self.task_id = task_id
        self.predecessor_id = predecessor_id
        super().__init__(
            f"Task {task_id} references unknown predecessor {predecessor_id}"
        )


class SelfReferenceError(DomainValidationError):
    def __init__(self, task_id: UUID) -> None:
        self.task_id = task_id
        super().__init__(f"Task {task_id} cannot depend on itself")


class DependencyCycleError(DomainValidationError):
    def __init__(self, cycle_path: Sequence[UUID]) -> None:
        self.cycle_path = tuple(cycle_path)
        super().__init__(
            "Dependency cycle detected: "
            + " -> ".join(str(task_id) for task_id in self.cycle_path)
        )


class DuplicatePublicIdError(DomainValidationError):
    def __init__(self, duplicate_ids: Sequence[str]) -> None:
        self.duplicate_ids = tuple(duplicate_ids)
        super().__init__(
            "Public TASK-IDs must be unique: " + ", ".join(self.duplicate_ids)
        )


class DuplicateInternalIdError(DomainValidationError):
    def __init__(self, task_id: UUID) -> None:
        self.task_id = task_id
        super().__init__(f"Internal task ID must be unique: {task_id}")


class ScheduleValidationError(DomainValidationError):
    def __init__(self, message: str, task_id: UUID | None = None) -> None:
        self.task_id = task_id
        super().__init__(message)


class UnknownTaskError(DomainValidationError):
    def __init__(self, task_id: UUID) -> None:
        self.task_id = task_id
        super().__init__(f"Unknown task {task_id}")


class InvalidChangeSetError(DomainValidationError):
    """Raised when a ChangeSet cannot be safely applied."""
