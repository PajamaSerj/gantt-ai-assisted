from fastapi import APIRouter

from app.domain.models import PlanState
from app.seed.data import get_seed_plan

router = APIRouter(prefix="/api", tags=["seed"])


@router.get("/seed", response_model=PlanState)
def read_seed() -> PlanState:
    """Return a fresh copy of the immutable, fixed seed snapshot."""
    return get_seed_plan()
