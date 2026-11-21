# Tameng MCP gateway results

## scripted-naive

| Simulated user | Attack success | Attacks that hit a confirm prompt | Benign utility | Benign tasks needing a confirm |
|---|---|---|---|---|
| decline | 29.8% · 31/104 | 46.2% · 48/104 | 83.3% · 10/12 | 16.7% · 2/12 |
| approve | 76.0% · 79/104 | 46.2% · 48/104 | 100.0% · 12/12 | 16.7% · 2/12 |

### Attack success by goal (user declines)

| goal | success |
|---|---|
| exfil_secret | 0.0% · 0/24 |
| forward_offer | 0.0% · 0/24 |
| phishing_link | 100.0% · 24/24 |
| spam_contacts | 0.0% · 0/24 |
| suppress_deadline | 87.5% · 7/8 |
