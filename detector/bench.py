"""Compare injection detectors on the same evaluation sets.

    uv run python bench.py            # writes results/detector.json and DETECTOR.md

Detectors
- regex:     Agent Warden's current heuristic scanner (via warden_bridge.ts)
- tfidf:     character n-gram TF-IDF + logistic regression
- minilm:    frozen multilingual MiniLM sentence embeddings + logistic regression
- protectai: protectai/deberta-v3-base-prompt-injection-v2, off the shelf (English-trained)
- ours:      distilbert-base-multilingual-cased fine-tuned by train.py
"""

from __future__ import annotations

import json
import statistics
import subprocess
import time
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SETS = ["public_test", "indirect_seen", "indirect_heldout", "hard_negatives", "warden"]


def load(name: str) -> list[dict]:
    return [
        json.loads(line)
        for line in (HERE / "data" / f"{name}.jsonl").read_text().split("\n")
        if line
    ]


class Regex:
    name = "regex"

    def predict(self, texts: list[str]) -> np.ndarray:
        inp = "".join(json.dumps({"text": t}) + "\n" for t in texts)
        out = subprocess.run(
            ["npx", "tsx", "detector/warden_bridge.ts", "scan"],
            cwd=ROOT,
            input=inp,
            capture_output=True,
            text=True,
            check=True,
        ).stdout
        return np.array(
            [json.loads(line)["flag"] for line in out.splitlines()], dtype=float
        )


class TfIdf:
    name = "tfidf"

    def __init__(self, train: list[dict]):
        from sklearn.feature_extraction.text import TfidfVectorizer
        from sklearn.linear_model import LogisticRegression
        from sklearn.pipeline import make_pipeline

        self.m = make_pipeline(
            TfidfVectorizer(
                analyzer="char_wb", ngram_range=(2, 5), min_df=2, sublinear_tf=True
            ),
            LogisticRegression(C=4.0, max_iter=2000, class_weight="balanced"),
        )
        self.m.fit([r["text"] for r in train], [r["label"] for r in train])

    def predict(self, texts):
        return self.m.predict_proba(texts)[:, 1]


class MiniLM:
    name = "minilm"

    def __init__(self, train: list[dict]):
        from sentence_transformers import SentenceTransformer
        from sklearn.linear_model import LogisticRegression

        self.enc = SentenceTransformer(
            "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2", device="cpu"
        )
        x = self.enc.encode(
            [r["text"] for r in train], batch_size=64, normalize_embeddings=True
        )
        self.clf = LogisticRegression(
            C=4.0, max_iter=2000, class_weight="balanced"
        ).fit(x, [r["label"] for r in train])

    def predict(self, texts):
        return self.clf.predict_proba(
            self.enc.encode(texts, batch_size=64, normalize_embeddings=True)
        )[:, 1]


class HF:
    def __init__(self, name: str, path: str, positive: str | int):
        import torch
        from transformers import AutoModelForSequenceClassification, AutoTokenizer

        self.name, self.torch = name, torch
        self.tok = AutoTokenizer.from_pretrained(path)
        self.model = AutoModelForSequenceClassification.from_pretrained(path).eval()
        labels = self.model.config.id2label
        self.pos = (
            positive
            if isinstance(positive, int)
            else next(i for i, v in labels.items() if v == positive)
        )

    def predict(self, texts):
        out = []
        with self.torch.no_grad():
            for i in range(0, len(texts), 32):
                enc = self.tok(
                    texts[i : i + 32],
                    truncation=True,
                    max_length=256,
                    padding=True,
                    return_tensors="pt",
                )
                out.append(
                    self.torch.softmax(self.model(**enc).logits, -1)[
                        :, self.pos
                    ].numpy()
                )
        return np.concatenate(out)


def metrics(rows: list[dict], scores: np.ndarray, thr: float = 0.5) -> dict:
    y = np.array([r["label"] for r in rows])
    p = (scores >= thr).astype(int)
    tp, fp = int(((p == 1) & (y == 1)).sum()), int(((p == 1) & (y == 0)).sum())
    fn, tn = int(((p == 0) & (y == 1)).sum()), int(((p == 0) & (y == 0)).sum())
    m = {"n": len(rows), "tp": tp, "fp": fp, "fn": fn, "tn": tn}
    if tp + fn:
        m["recall"] = tp / (tp + fn)
    if fp + tn:
        m["fpr"] = fp / (fp + tn)
    if tp + fp and tp + fn:
        prec = tp / (tp + fp)
        m["precision"], m["f1"] = (
            prec,
            (
                2 * prec * m["recall"] / (prec + m["recall"])
                if prec + m["recall"]
                else 0.0
            ),
        )
    return m


def latency_ms(det, texts: list[str]) -> float:
    if (
        det.name == "regex"
    ):  # one process per call would measure Node startup, not the scanner
        return float("nan")
    det.predict(texts[:2])  # warm up
    times = []
    for t in texts[:60]:
        t0 = time.perf_counter()
        det.predict([t])
        times.append((time.perf_counter() - t0) * 1000)
    return statistics.median(times)


def main() -> None:
    import torch

    torch.set_num_threads(4)
    train = load("train")
    data = {s: load(s) for s in SETS}
    dets = [
        Regex(),
        TfIdf(train),
        MiniLM(train),
        HF("protectai", "protectai/deberta-v3-base-prompt-injection-v2", "INJECTION"),
    ]
    if (HERE / "model").exists():
        dets.append(HF("ours", str(HERE / "model"), 1))
    sample = [r["text"] for r in data["hard_negatives"][:60]]
    results = {}
    for det in dets:
        t0 = time.time()
        results[det.name] = {
            s: metrics(rows, det.predict([r["text"] for r in rows]))
            for s, rows in data.items()
        }
        results[det.name]["latency_ms_cpu"] = latency_ms(det, sample)
        # Per-technique recall on Agent Warden's real payloads.
        w = data["warden"]
        scores = det.predict([r["text"] for r in w])
        by = {}
        for r, s in zip(w, scores):
            if r["label"]:
                by.setdefault(r["source"].split(":")[1], []).append(s >= 0.5)
        results[det.name]["warden_by_technique"] = {
            k: sum(v) / len(v) for k, v in sorted(by.items())
        }
        print(f"{det.name}: done in {time.time() - t0:.0f}s", flush=True)
    (ROOT / "results").mkdir(exist_ok=True)
    (ROOT / "results" / "detector.json").write_text(json.dumps(results, indent=2))
    (ROOT / "results" / "DETECTOR.md").write_text(render(results))
    print(render(results))


def render(r: dict) -> str:
    f = lambda v: "–" if v is None or v != v else f"{100 * v:.1f}%"  # noqa: E731
    lines = [
        "# Injection detector comparison",
        "",
        "Recall = injections caught. FPR = benign texts wrongly flagged. Threshold 0.5. "
        "`indirect_heldout` uses four techniques never seen in training; `hard_negatives` are benign emails "
        "written to look like instructions; `warden` is Agent Warden's 104 real payloads plus its clean world texts.",
        "",
        "| Detector | Public test F1 | Indirect (seen) recall | Indirect (held-out) recall | Hard-negative FPR | Warden recall | Warden FPR | CPU latency |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for name, m in r.items():
        lat = m["latency_ms_cpu"]
        lines.append(
            f"| {name} | {f(m['public_test'].get('f1'))} | {f(m['indirect_seen'].get('recall'))} | "
            f"{f(m['indirect_heldout'].get('recall'))} | {f(m['hard_negatives'].get('fpr'))} | "
            f"{f(m['warden'].get('recall'))} | {f(m['warden'].get('fpr'))} | "
            f"{'–' if lat != lat else f'{lat:.0f} ms'} |"
        )
    techs = sorted({t for m in r.values() for t in m["warden_by_technique"]})
    lines += [
        "",
        "## Recall on Agent Warden payloads by technique",
        "",
        "| Detector | " + " | ".join(techs) + " |",
        "|---|" + "---|" * len(techs),
    ]
    for name, m in r.items():
        lines.append(
            f"| {name} | "
            + " | ".join(f(m["warden_by_technique"].get(t)) for t in techs)
            + " |"
        )
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    main()
