from datetime import date
from enum import StrEnum
from io import BytesIO

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, ValidationError

from app.domain.changesets import ChangeSet, apply_changeset
from app.domain.errors import DomainValidationError
from app.domain.models import PlanState
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
