from fastapi import FastAPI

from app.api.seed import router as seed_router

app = FastAPI(title="AI Gantt Planner API", version="0.1.0")
app.include_router(seed_router)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
