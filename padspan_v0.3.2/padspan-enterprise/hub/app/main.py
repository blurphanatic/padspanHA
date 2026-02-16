from __future__ import annotations
from fastapi import FastAPI
from pydantic import BaseModel, Field
from typing import List, Dict
from datetime import datetime, timezone

app = FastAPI(title="PadSpan Enterprise Hub", version="0.3.2")

class Observation(BaseModel):
    receiver_id: str = Field(..., examples=["rx-01"])
    mac: str = Field(..., examples=["AA:BB:CC:DD:EE:FF"])
    rssi: int = Field(..., ge=-127, le=20)
    tx_power: int | None = None
    ts_utc: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class MapAnchor(BaseModel):
    anchor_id: str
    x: float
    y: float
    room: str | None = None

state: Dict[str, list] = {
    "observations": [],
    "anchors": [],
}

@app.get("/health")
def health():
    return {"ok": True, "service": "padspan-enterprise-hub", "version": "0.3.2"}

@app.post("/api/v1/observations")
def post_observations(items: List[Observation]):
    state["observations"].extend([i.model_dump() for i in items][-5000:])
    return {"accepted": len(items)}

@app.get("/api/v1/observations/latest")
def get_latest(limit: int = 50):
    return {"items": state["observations"][-max(1, min(limit, 500)):]}

@app.post("/api/v1/map/anchors")
def upsert_anchors(items: List[MapAnchor]):
    incoming = {a.anchor_id: a.model_dump() for a in items}
    existing = {a["anchor_id"]: a for a in state["anchors"]}
    existing.update(incoming)
    state["anchors"] = list(existing.values())
    return {"count": len(state["anchors"])}

@app.get("/api/v1/map/anchors")
def get_anchors():
    return {"items": state["anchors"]}

@app.get("/api/v1/calibration/export")
def export_project():
    return {
        "version": "0.3.2",
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "anchors": state["anchors"],
        "notes": "starter export format"
    }
