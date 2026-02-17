from __future__ import annotations

import asyncio
from typing import Any

import aiohttp
from yarl import URL

from .exceptions import PadSpanApiConnectionError, PadSpanApiError


class PadSpanApiClient:
    """Optional cloud/hub API client."""

    def __init__(
        self,
        session: aiohttp.ClientSession,
        hub_url: str | None,
        api_key: str | None,
        enabled: bool,
    ) -> None:
        self._session = session
        self._enabled = enabled
        self._hub_url = (hub_url or "").strip().rstrip("/")
        self._api_key = (api_key or "").strip()

    @property
    def enabled(self) -> bool:
        return self._enabled and bool(self._hub_url)

    @property
    def hub_url(self) -> str:
        return self._hub_url or ""

    async def ping(self) -> dict[str, Any]:
        if not self.enabled:
            return {"ok": False, "reason": "cloud_disabled"}
        return await self._request_json("GET", "/health")

    async def fetch_devices(self) -> list[dict[str, Any]]:
        if not self.enabled:
            return []
        payload = await self._request_json("GET", "/api/devices")
        if isinstance(payload, list):
            return payload
        if isinstance(payload, dict):
            devices = payload.get("devices")
            if isinstance(devices, list):
                return devices
        return []

    async def _request_json(self, method: str, path: str) -> Any:
        if not self._hub_url:
            raise PadSpanApiConnectionError("Hub URL is not configured")

        url = str(URL(self._hub_url) / path.lstrip("/"))
        headers = {}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"

        try:
            timeout = aiohttp.ClientTimeout(total=8)
            async with self._session.request(method, url, timeout=timeout, headers=headers) as resp:
                text = await resp.text()
                if resp.status >= 400:
                    raise PadSpanApiError(f"HTTP {resp.status}: {text[:300]}")
                try:
                    return await resp.json(content_type=None)
                except Exception:
                    return {"raw": text}
        except (aiohttp.ClientError, asyncio.TimeoutError) as err:
            raise PadSpanApiConnectionError(str(err)) from err
