import asyncio
from pathlib import Path

import httpx

from app.main import create_app


async def request(app, path: str) -> httpx.Response:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as client:
        return await client.get(path)


def write_frontend_dist(path: Path) -> None:
    assets = path / "assets"
    assets.mkdir(parents=True)
    (path / "index.html").write_text(
        "<!doctype html><title>AI Gantt Planner</title><div id=\"root\"></div>",
        encoding="utf-8",
    )
    (assets / "app.js").write_text("console.log('production');", encoding="utf-8")
    (assets / "app.css").write_text("body { color: #123456; }", encoding="utf-8")


def test_production_runtime_serves_spa_assets_and_api(tmp_path: Path) -> None:
    frontend_dist = tmp_path / "dist"
    write_frontend_dist(frontend_dist)
    app = create_app(frontend_dist=frontend_dist)

    root = asyncio.run(request(app, "/"))
    script = asyncio.run(request(app, "/assets/app.js"))
    stylesheet = asyncio.run(request(app, "/assets/app.css"))
    health = asyncio.run(request(app, "/api/health"))
    seed = asyncio.run(request(app, "/api/seed"))

    assert root.status_code == 200
    assert "AI Gantt Planner" in root.text
    assert script.status_code == 200
    assert script.headers["content-type"].startswith("text/javascript")
    assert stylesheet.status_code == 200
    assert stylesheet.headers["content-type"].startswith("text/css")
    assert health.json() == {"status": "ok"}
    assert len(seed.json()["tasks"]) == 7


def test_production_runtime_uses_spa_fallback_but_not_for_api(tmp_path: Path) -> None:
    frontend_dist = tmp_path / "dist"
    write_frontend_dist(frontend_dist)
    app = create_app(frontend_dist=frontend_dist)

    client_route = asyncio.run(request(app, "/workspace/tasks/TASK-001"))
    unknown_api = asyncio.run(request(app, "/api/does-not-exist"))

    assert client_route.status_code == 200
    assert "AI Gantt Planner" in client_route.text
    assert unknown_api.status_code == 404
    assert unknown_api.headers["content-type"].startswith("application/json")
    assert "AI Gantt Planner" not in unknown_api.text


def test_backend_starts_without_frontend_build(tmp_path: Path) -> None:
    app = create_app(frontend_dist=tmp_path / "missing-dist")

    assert asyncio.run(request(app, "/api/health")).json() == {"status": "ok"}
    assert asyncio.run(request(app, "/api/seed")).status_code == 200
    assert asyncio.run(request(app, "/")).status_code == 404
