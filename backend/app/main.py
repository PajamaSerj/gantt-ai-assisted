from fastapi import FastAPI

from app.api.chat import router as chat_router
from app.api.planning import router as planning_router
from app.api.seed import router as seed_router

app = FastAPI(title="AI Gantt Planner API", version="0.3.0")
app.include_router(seed_router)
app.include_router(planning_router)
app.include_router(chat_router)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
