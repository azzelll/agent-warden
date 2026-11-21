"""Local HTTP service for the fine-tuned injection detector.

    uv run uvicorn serve:app --port 8765          # from detector/
    WARDEN_DETECTOR_URL=http://127.0.0.1:8765 npm run eval -- --defenses ml,full_ml

POST /classify {"texts": [...]} -> {"scores": [p_injection, ...]}
Binds to localhost only; untrusted text never leaves the machine.
"""

from __future__ import annotations

import os
from pathlib import Path

import torch
from fastapi import FastAPI
from pydantic import BaseModel, Field
from transformers import AutoModelForSequenceClassification, AutoTokenizer

MODEL = Path(
    os.environ.get("WARDEN_DETECTOR_MODEL", Path(__file__).resolve().parent / "model")
)
torch.set_num_threads(int(os.environ.get("WARDEN_DETECTOR_THREADS", "4")))
tok = AutoTokenizer.from_pretrained(MODEL)
model = AutoModelForSequenceClassification.from_pretrained(MODEL).eval()

app = FastAPI(title="warden-detector")


class Req(BaseModel):
    texts: list[str] = Field(max_length=512)


@app.get("/health")
def health() -> dict:
    return {"ok": True, "model": str(MODEL.name)}


@app.post("/classify")
def classify(req: Req) -> dict:
    scores: list[float] = []
    with torch.no_grad():
        for i in range(0, len(req.texts), 32):
            enc = tok(
                req.texts[i : i + 32],
                truncation=True,
                max_length=192,
                padding=True,
                return_tensors="pt",
            )
            scores += torch.softmax(model(**enc).logits, -1)[:, 1].tolist()
    return {"scores": scores}
