from datetime import date
from enum import StrEnum
from io import BytesIO
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.domain.changesets import ChangeSet, ChangeSetStatus, apply_changeset
from app.domain.errors import DomainValidationError, ScheduleValidationError
from app.domain.models import PlanState
from app.services.direct_edit import (
    dependency_bound_move_message,
    prepare_direct_move,
    prepare_direct_resize,
)
from app.services.excel_export import export_plan_xlsx
from app.services.excel_import import ImportIssue
from app.services.import_planning import ImportMode, prepare_import

router = APIRouter(prefix="/api", tags=["planning"])


class ImportResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    status: str
    unchanged_plan: PlanState
    changeset: ChangeSet | None = None
    errors: tuple[ImportIssue, ...] = ()


class ApplyChoice(StrEnum):
    APPLY_ALL = "apply_all"
    CANCEL = "cancel"


class ApplyChangeSetRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    current_plan: PlanState
    changeset: ChangeSet
    choice: ApplyChoice


class ApplyChangeSetResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    status: str
    plan: PlanState


class DirectMoveEdit(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    type: Literal["move"]
    task_id: UUID
    intended_start_date: date


class DirectResizeEdit(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    type: Literal["resize"]
    task_id: UUID
    intended_end_date: date


DirectEdit = Annotated[
    DirectMoveEdit | DirectResizeEdit,
    Field(discriminator="type"),
]


class PrepareDirectEditRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    current_plan: PlanState
    edit: DirectEdit


class DirectEditStatus(StrEnum):
    APPLIED = "APPLIED"
    CONFIRMATION_REQUIRED = "CONFIRMATION_REQUIRED"
    INVALID = "INVALID"


class PrepareDirectEditResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    status: DirectEditStatus
    plan: PlanState
    changeset: ChangeSet | None = None
    message: str


def _parse_current_plan(raw_plan: str | None) -> PlanState:
    if raw_plan is None:
        return PlanState()
    try:
        return PlanState.model_validate_json(raw_plan)
    except ValidationError as error:
        raise HTTPException(
            status_code=422,
            detail=f"current_plan is invalid: {error}",
        ) from error


@router.post("/import", response_model=ImportResponse)
async def import_plan(
    file: UploadFile = File(...),
    mode: ImportMode = Form(...),
    date_constraint: date = Form(...),
    current_plan: str | None = Form(None),
) -> ImportResponse:
    plan = _parse_current_plan(current_plan)
    preparation = prepare_import(
        file_name=file.filename or "",
        content=await file.read(),
        mode=mode,
        date_constraint=date_constraint,
        current_plan=plan,
    )
    return ImportResponse(
        status=preparation.status,
        unchanged_plan=preparation.unchanged_plan,
        changeset=preparation.changeset,
        errors=preparation.issues,
    )


@router.post("/changesets/apply", response_model=ApplyChangeSetResponse)
def apply_prepared_changeset(
    request: ApplyChangeSetRequest,
) -> ApplyChangeSetResponse:
    if request.choice is ApplyChoice.CANCEL:
        return ApplyChangeSetResponse(status="cancelled", plan=request.current_plan)
    try:
        plan = apply_changeset(
            request.current_plan,
            request.changeset,
            confirmed=True,
        )
    except DomainValidationError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    return ApplyChangeSetResponse(status="applied", plan=plan)


@router.post("/direct-edits/prepare", response_model=PrepareDirectEditResponse)
def prepare_direct_edit(
    request: PrepareDirectEditRequest,
) -> PrepareDirectEditResponse:
    try:
        if isinstance(request.edit, DirectMoveEdit):
            changeset = prepare_direct_move(
                request.current_plan,
                request.edit.task_id,
                request.edit.intended_start_date,
            )
        else:
            changeset = prepare_direct_resize(
                request.current_plan,
                request.edit.task_id,
                request.edit.intended_end_date,
            )
    except DomainValidationError as error:
        detail = (
            str(error)
            if isinstance(error, ScheduleValidationError)
            else "Не удалось подготовить изменение для выбранной задачи."
        )
        raise HTTPException(status_code=422, detail=detail) from error

    if changeset.status is ChangeSetStatus.INVALID:
        return PrepareDirectEditResponse(
            status=DirectEditStatus.INVALID,
            plan=request.current_plan,
            message="Изменение нельзя применить к текущему плану.",
        )
    if (
        isinstance(request.edit, DirectMoveEdit)
        and changeset.proposed_plan == request.current_plan
    ):
        dependency_message = dependency_bound_move_message(
            request.current_plan,
            request.edit.task_id,
            request.edit.intended_start_date,
        )
        if dependency_message:
            return PrepareDirectEditResponse(
                status=DirectEditStatus.INVALID,
                plan=request.current_plan,
                message=dependency_message,
            )
    if changeset.status is ChangeSetStatus.CONFIRMATION_REQUIRED:
        return PrepareDirectEditResponse(
            status=DirectEditStatus.CONFIRMATION_REQUIRED,
            plan=request.current_plan,
            changeset=changeset,
            message="Проверьте последствия изменения перед применением.",
        )

    try:
        applied_plan = apply_changeset(
            request.current_plan,
            changeset,
            confirmed=False,
        )
    except DomainValidationError as error:
        raise HTTPException(
            status_code=409,
            detail="План изменился. Повторите действие для актуального плана.",
        ) from error
    return PrepareDirectEditResponse(
        status=DirectEditStatus.APPLIED,
        plan=applied_plan,
        message="Изменение применено к плану.",
    )


@router.post("/export")
def export_plan(plan: PlanState) -> StreamingResponse:
    try:
        content = export_plan_xlsx(plan)
    except DomainValidationError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return StreamingResponse(
        BytesIO(content),
        media_type=(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        ),
        headers={
            "Content-Disposition": 'attachment; filename="ai-gantt-plan.xlsx"'
        },
    )
