# `tools/ocr-gate/`

The OCR acceptance gate. Offline research tooling — nothing in `src/` imports it.
Result: `docs/superpowers/decisions/2026-08-02-ocr-acceptance-gate.md`.

The client and grounding parser are **not** here: they live in
`src/server/ocr/client.ts` and `src/domain/ocr/grounding.ts`, because that is
what `OcrService` needs in Phase 2. This directory is only the scoring and the
run.

## Running it

Needs an OpenAI-compatible server with a DeepSeek-OCR model loaded. Both vars are
required and have no defaults — unset means the gate skips rather than silently
hitting the wrong host.

```bash
OCR_ENDPOINT=http://<host>:<port> OCR_MODEL=<model-id> pnpm vitest run tools/ocr-gate
```

`score.test.ts` runs without either var, and does not touch the network.

## Regenerating the synthetic cards

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python render_cards.py
```

Python is used for this one script and nowhere else in the repo — PIL was the
shortest path to rendering cards at exact physical sizes. Regenerating
invalidates comparison against previously recorded results, so only do it when
the renderer itself changes.

## Two traps, both already paid for

- **Do not put `<image>` in the prompt text.** The server inserts one image token
  per attachment; a second makes the counts disagree and it answers HTTP 400 with
  a message about image tokens, as if the image were at fault.
- **Grounded and plain OCR each miss things the other catches.** Grounded wins
  overall and is the only mode that returns boxes, but plain recovered a ZIP that
  grounded dropped. Neither is a superset.

## Scoring

Field-level exact match primary (one wrong character fails the field), CER
secondary, IoU ≥ 0.5 for boxes — the ICDAR/COCO convention.

Two rules exist because the naive version reported correct reads as failures:

- **A ground-truth value may be a list** when the card splits it across two lines
  (`["ANGELINA", "GABRIELA"]`) — those return as separate detections.
- **The box comes from the detection containing the value**, not the lowest edit
  distance. Cards merge label into value (`4dLIC#WDLJK00580GF`), which is a
  correct read with a large edit distance.

Known limitation: when a card prints the same value twice (the WA licence number
appears at `4d LIC#` and again at `5 DD`), the value alone cannot pick the right
one. Pass the label via `labels` in the specimen ground truth.
