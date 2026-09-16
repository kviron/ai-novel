import httpx


def provider_health(name: str, url: str, timeout: float) -> dict:
    try:
        response = httpx.get(url, timeout=timeout)
        return {"available": response.is_success, "mode": "live", "detail": f"HTTP {response.status_code}"}
    except httpx.HTTPError:
        return {"available": False, "mode": "demo", "detail": f"{name} is offline; demo mode remains available"}
