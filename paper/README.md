# Paper draft

`tameng.tex` is a ~5-page workshop paper draft (pdfLaTeX, no external .bib file).
Compile it on Overleaf, or locally with `latexmk -pdf tameng.tex`.

Numbers in red `[TBD: ...]` are still pending:

- qwen3:8b per-defense rows: finish `npm run eval -- --model ollama:qwen3:8b`, then `npm run report -- results/ollama_qwen3_8b.jsonl`.
- gateway on a real model: `npm run eval:gateway -- --model ollama:qwen3:8b`.

Venue candidates are AI-security workshops co-located with ML or security conferences. Check each call for page limits and anonymity rules before submitting (anonymous submissions need the author name and GitHub link removed).
