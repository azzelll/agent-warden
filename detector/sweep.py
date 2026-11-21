"""Threshold sweep for the fine-tuned detector: recall vs false-positive rate.

    uv run python sweep.py      # appends a table to ../results/DETECTOR.md

Reported as operating points, not tuned: picking a threshold on these test
sets would leak them into the model choice.
"""

from __future__ import annotations


import numpy as np

from bench import HF, HERE, load

ROOT = HERE.parent
det = HF("ours", str(HERE / "model"), 1)
sets = {
    s: load(s) for s in ["indirect_heldout", "hard_negatives", "warden", "public_test"]
}
scores = {s: det.predict([r["text"] for r in rows]) for s, rows in sets.items()}


def rate(s: str, label: int, t: float) -> float:
    y = np.array([r["label"] for r in sets[s]])
    m = y == label
    return float((scores[s][m] >= t).mean()) if m.any() else float("nan")


lines = [
    "",
    "## Operating points of the fine-tuned detector",
    "",
    "| Threshold | Held-out recall | Hard-negative FPR | Warden recall | Warden FPR | Public recall | Public FPR |",
    "|---|---|---|---|---|---|---|",
]
for t in [0.5, 0.8, 0.9, 0.95, 0.99, 0.999]:
    vals = [
        rate("indirect_heldout", 1, t),
        rate("hard_negatives", 0, t),
        rate("warden", 1, t),
        rate("warden", 0, t),
        rate("public_test", 1, t),
        rate("public_test", 0, t),
    ]
    lines.append(f"| {t} | " + " | ".join(f"{100 * v:.1f}%" for v in vals) + " |")
out = "\n".join(lines) + "\n"
p = ROOT / "results" / "DETECTOR.md"
p.write_text(p.read_text().split("\n## Operating points")[0].rstrip("\n") + "\n" + out)
print(out)
