from __future__ import annotations

import asyncio
from typing import Any, Dict, Optional

import aiohttp
from yarl import URL

from .exceptions import PadSpanApiConnectionError, PadSpanApiError


class PadSpanApiClient:
    """Optional cloud/hub API client."""

    def __init__(
        self,
        session: aiohttp.ClientSession,
        hub_url: Optional[str],
        api_key: Optional[str],
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

    async def ping(self) -> Dict[str, Any]:
        if not self.enabled:
            return {"ok": False, "reason": "cloud_disabled"}
        return await self._request_json("GET", "/health")

    async def fetch_devices(self) -> Dict[str, Any]:
        if not self.enabled:
            return {"devices": []}
        return await self._request_json("GET", "/api/devices")

    async def _request_json(self, method: str, path: str) -> Dict[str, Any]:
        if not self._hub_url:
            raise PadSpanApiConnectionError("Hub URL is missing.")

        url = str(URL(self._hub_url).with_path(path))
        headers = {"Accept": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"

        try:
            timeout = aiohttp.ClientTimeout(total=8)
            async with asyncio.timeout(10):
                async with self._session.request(method, url, headers=headers, timeout=timeout) as resp:
                    if resp.status >= 400:
                        text = await resp.text()
                        raise PadSpanApiError(f"HTTP {resp.status}: {text[:250]}")
                    payload = await resp.json(content_type=None)
                    if isinstance(payload, dict):
                        return payload
                    raise PadSpanApiError("Unexpected JSON payload type.")
        except (TimeoutError, asyncio.TimeoutError, aiohttp.ClientError) as err:
            raise PadSpanApiConnectionError(str(err)) from err
