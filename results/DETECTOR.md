# Injection detector comparison

Recall = injections caught. FPR = benign texts wrongly flagged. Threshold 0.5. `indirect_heldout` uses four techniques never seen in training; `hard_negatives` are benign emails written to look like instructions; `warden` is Agent Warden's 104 real payloads plus its clean world texts.

| Detector | Public test F1 | Indirect (seen) recall | Indirect (held-out) recall | Hard-negative FPR | Warden recall | Warden FPR | CPU latency |
|---|---|---|---|---|---|---|---|
| regex | 50.7% | 87.3% | 77.7% | 34.8% | 94.2% | 0.0% | – |
| tfidf | 92.8% | 97.3% | 58.7% | 8.0% | 76.9% | 0.0% | 0 ms |
| minilm | 85.4% | 91.0% | 69.3% | 22.2% | 82.7% | 33.3% | 6 ms |
| protectai | 81.1% | 44.7% | 44.0% | 23.2% | 72.1% | 0.0% | 78 ms |
| ours | 95.3% | 100.0% | 81.0% | 15.0% | 94.2% | 16.7% | 18 ms |

## Recall on Agent Warden payloads by technique

| Detector | authority | base64 | fake_system | fake_turn | ignore_previous | impersonation | indonesian | naive |
|---|---|---|---|---|---|---|---|---|
| regex | 100.0% | 76.9% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 76.9% |
| tfidf | 84.6% | 0.0% | 92.3% | 92.3% | 100.0% | 61.5% | 100.0% | 84.6% |
| minilm | 100.0% | 23.1% | 100.0% | 100.0% | 100.0% | 53.8% | 100.0% | 84.6% |
| protectai | 7.7% | 100.0% | 84.6% | 69.2% | 84.6% | 92.3% | 61.5% | 76.9% |
| ours | 100.0% | 53.8% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |

## Operating points of the fine-tuned detector

| Threshold | Held-out recall | Hard-negative FPR | Warden recall | Warden FPR | Public recall | Public FPR |
|---|---|---|---|---|---|---|
| 0.5 | 81.0% | 15.0% | 94.2% | 16.7% | 92.0% | 1.1% |
| 0.8 | 80.7% | 14.0% | 94.2% | 16.7% | 91.0% | 0.6% |
| 0.9 | 80.0% | 13.2% | 94.2% | 16.7% | 91.0% | 0.6% |
| 0.95 | 79.7% | 13.0% | 94.2% | 16.7% | 89.4% | 0.6% |
| 0.99 | 79.7% | 12.0% | 90.4% | 16.7% | 87.9% | 0.6% |
| 0.999 | 79.0% | 9.0% | 87.5% | 0.0% | 81.4% | 0.6% |
