from fastapi import FastAPI

from app.api.planning import router as planning_router
from app.api.seed import router as seed_router

app = FastAPI(title="AI Gantt Planner API", version="0.2.0")
app.include_router(seed_router)
app.include_router(planning_router)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
