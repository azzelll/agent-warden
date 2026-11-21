"""Fine-tune a small multilingual encoder as a prompt-injection classifier.

    uv run python train.py            # writes model/ (git-ignored)

distilbert-base-multilingual-cased (Apache-2.0) is chosen for size and because
the agent reads Indonesian as well as English text.
"""

from __future__ import annotations

import json
import random
import time
from pathlib import Path

import numpy as np
import torch
from torch.utils.data import DataLoader
from transformers import (
    AutoModelForSequenceClassification,
    AutoTokenizer,
    get_linear_schedule_with_warmup,
)

HERE = Path(__file__).resolve().parent
BASE = "distilbert/distilbert-base-multilingual-cased"
MAX_LEN = 192
EPOCHS = 3
LR = 3e-5
BATCH = 16
SEED = 13


def load(name: str) -> list[dict]:
    return [
        json.loads(line)
        for line in (HERE / "data" / f"{name}.jsonl").read_text().split("\n")
        if line
    ]


def main() -> None:
    random.seed(SEED)
    np.random.seed(SEED)
    torch.manual_seed(SEED)
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    tok = AutoTokenizer.from_pretrained(BASE)
    model = AutoModelForSequenceClassification.from_pretrained(BASE, num_labels=2).to(
        device
    )
    # The multilingual vocabulary embedding is ~92M of the 135M parameters. Freezing it
    # keeps Adam's state small enough for a 16 GB laptop and barely matters with ~4k examples.
    model.distilbert.embeddings.word_embeddings.weight.requires_grad_(False)
    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    print(f"trainable parameters: {trainable / 1e6:.1f}M", flush=True)

    rows = load("train")
    random.shuffle(rows)
    n_val = len(rows) // 10
    val, train = rows[:n_val], rows[n_val:]

    def collate(batch):
        enc = tok(
            [r["text"] for r in batch],
            truncation=True,
            max_length=MAX_LEN,
            padding=True,
            return_tensors="pt",
        )
        enc["labels"] = torch.tensor([r["label"] for r in batch])
        return enc

    train_dl = DataLoader(train, batch_size=BATCH, shuffle=True, collate_fn=collate)
    val_dl = DataLoader(val, batch_size=64, collate_fn=collate)
    opt = torch.optim.AdamW(
        [p for p in model.parameters() if p.requires_grad], lr=LR, weight_decay=0.01
    )
    steps = EPOCHS * len(train_dl)
    sched = get_linear_schedule_with_warmup(opt, int(0.06 * steps), steps)

    best, t0 = -1.0, time.time()
    for epoch in range(EPOCHS):
        model.train()
        for i, batch in enumerate(train_dl):
            batch = {k: v.to(device) for k, v in batch.items()}
            loss = model(**batch).loss
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            sched.step()
            opt.zero_grad()
            if i % 50 == 0:
                print(
                    f"epoch {epoch + 1} step {i}/{len(train_dl)} loss {loss.item():.4f} ({time.time() - t0:.0f}s)",
                    flush=True,
                )
                if device == "mps":
                    torch.mps.empty_cache()
        model.eval()
        correct = total = 0
        with torch.no_grad():
            for batch in val_dl:
                labels = batch.pop("labels").to(device)
                pred = model(
                    **{k: v.to(device) for k, v in batch.items()}
                ).logits.argmax(-1)
                correct += (pred == labels).sum().item()
                total += len(labels)
        acc = correct / total
        print(
            f"epoch {epoch + 1}: val accuracy {acc:.4f} ({time.time() - t0:.0f}s)",
            flush=True,
        )
        if acc > best:
            best = acc
            model.save_pretrained(HERE / "model")
            tok.save_pretrained(HERE / "model")
    (HERE / "model" / "training.json").write_text(
        json.dumps(
            {
                "base": BASE,
                "frozen": "word embeddings",
                "epochs": EPOCHS,
                "lr": LR,
                "batch": BATCH,
                "max_len": MAX_LEN,
                "seed": SEED,
                "train_rows": len(train),
                "val_rows": len(val),
                "best_val_accuracy": best,
                "seconds": round(time.time() - t0),
                "device": device,
            },
            indent=2,
        )
    )
    print(f"saved model/ (best val accuracy {best:.4f})")


if __name__ == "__main__":
    main()
