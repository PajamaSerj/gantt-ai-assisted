import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.staticfiles import StaticFiles

from app.api.chat import router as chat_router
from app.api.planning import router as planning_router
from app.api.seed import router as seed_router

class SPAStaticFiles(StaticFiles):
    """Serve index.html for non-API client routes in a production build."""

    async def get_response(self, path: str, scope: dict):
        try:
            response = await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code != 404 or scope["method"] not in {"GET", "HEAD"}:
                raise
            return await super().get_response("index.html", scope)

        if response.status_code == 404 and scope["method"] in {"GET", "HEAD"}:
            return await super().get_response("index.html", scope)
        return response


def _default_frontend_dist() -> Path:
    configured = os.getenv("FRONTEND_DIST_DIR")
    if configured:
        return Path(configured)
    return Path(__file__).resolve().parents[2] / "frontend" / "dist"


def create_app(*, frontend_dist: Path | None = None) -> FastAPI:
    application = FastAPI(title="AI Gantt Planner API", version="0.3.0")
    application.include_router(seed_router)
    application.include_router(planning_router)
    application.include_router(chat_router)

    @application.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @application.api_route(
        "/api/{api_path:path}",
        methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
        include_in_schema=False,
    )
    def unknown_api(api_path: str) -> None:
        del api_path
        raise HTTPException(status_code=404, detail="Not Found")

    resolved_frontend_dist = frontend_dist or _default_frontend_dist()
    if resolved_frontend_dist.is_dir() and (
        resolved_frontend_dist / "index.html"
    ).is_file():
        application.mount(
            "/",
            SPAStaticFiles(directory=resolved_frontend_dist, html=True),
            name="frontend",
        )

    return application


app = create_app()
