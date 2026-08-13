import asyncio

import httpx

from app.main import app


async def request(path: str) -> httpx.Response:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as client:
        return await client.get(path)


def test_health_endpoint() -> None:
    response = asyncio.run(request("/api/health"))

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_seed_endpoint_returns_fixed_plan_state() -> None:
    response = asyncio.run(request("/api/seed"))

    assert response.status_code == 200
    body = response.json()
    assert list(body) == ["tasks"]
    assert len(body["tasks"]) == 7
    assert body["tasks"][0]["public_id"] == "TASK-001"
    assert body["tasks"][0]["start_date"] == "2026-02-02"
