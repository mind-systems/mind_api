# Mind Coach AI — Architecture Handoff

**Date:** 2026-06-28
**Source:** conversation context (digital_ocean project, server + AI architecture discussion)

## Key Findings

- The AI coaching assistant should be a **separate service** (`mind_coach/`) alongside `mind_api`, not embedded in it.
- Core abstraction is a **domain-neutral Timeline**: `pre → event → post` — bio context before exercise, the exercise itself with instructions given, bio context after. This is the unit of analysis.
- `fit_score` — a measure of how well the exercise matched the user's bio state at entry — is the key derived metric the LLM reasons about (not raw averages).
- **No fine-tuning first** — build RAG pipeline with base model, accumulate real sessions (50+), observe where model fails, then fine-tune.
- LLM: **Qwen2.5 14B Instruct Q4_K_M** via Ollama — fits fully in 24 GB VRAM (RTX 3090), leaves headroom for KV cache. Chroma + embeddings run on CPU in ~13 GB free RAM.

## Details

### Server Hardware
- GPU: NVIDIA RTX 3090, 24 GB VRAM (141 MB currently used by Xorg)
- RAM: 15 GB total, ~13 GB free
- CPU: Intel i5-4460 (4 cores, 2014) — weak, avoid CPU offload for inference

### Why Not 70B
70B Q4_K_M = ~40 GB. Doesn't fit in VRAM, offload to CPU on i5-4460 = unusable speed. Qwen2.5 14B is the quality/hardware sweet spot for this server.

### Timeline Schema (domain-neutral, define once)

```python
class TimelineEvent(BaseModel):
    domain: str                    # "mind"
    event_type: str                # "breathing_exercise"
    instructions_given: list[str]  # what the system told the user
    conditions_at_entry: dict      # bio snapshot at exercise start

class Session(BaseModel):
    pre: ContextWindow             # bio signals before exercise
    event: TimelineEvent
    post: ContextWindow            # bio signals after exercise
    fit_score: float | None
    outcome: dict                  # domain-specific result
```

### Proposed Project Structure

```
mind_coach/
  signals/
    collector.py        # subscribe to HR/EEG stream from mind_api
    preprocessor.py     # filter, artifact removal
  features/
    hrv.py              # RMSSD, SDNN, RSA
    eeg.py              # alpha/beta/theta band powers
    segmenter.py        # windowing, event detection (inflection points)
  timeline/             # domain-neutral layer
    builder.py          # pre/event/post → unified JSON
    fit_score.py        # interface + mind implementation
    schema.py           # pydantic models
  sessions/
    store.py            # persist session to postgres
    indexer.py          # embed + push to Chroma
    retriever.py        # RAG: fetch relevant sessions by query
  llm/
    inference.py        # Qwen2.5 via Ollama API (localhost:11434)
    prompt_builder.py   # system prompt + retrieved context + question
    coach.py            # entry point: question → answer
  training/             # run separately, not at inference time
    dataset.py          # generate (question+metrics → coach answer) pairs
    finetune.py         # unsloth QLoRA, r=16, batch=2, grad_accum=8
  api/
    main.py             # FastAPI
    routes/chat.py      # POST /chat
    routes/sessions.py  # GET /sessions/{user_id}
```

### What "Temporal Analysis" Means Here

Not averaged metrics per session. Each session is segmented into 2–3 min windows with per-window HRV/EEG + deltas + detected events (stress transitions, inflection points). Stored in Chroma as structured JSON so the LLM sees dynamics, not summaries.

```json
{
  "segments": [
    {"t": "0-2min", "hrv_rmssd": 24.1, "stress": 0.81, "alpha_power": 0.22},
    {"t": "2-4min", "hrv_rmssd": 28.6, "stress": 0.71, "delta_hrv": "+4.5"},
    {"t": "4-6min", "hrv_rmssd": 35.2, "stress": 0.52, "note": "transition point"}
  ],
  "key_events": [
    {"at": "4min", "event": "stress_drop", "magnitude": "sharp"}
  ]
}
```

### RAG Stack

- **Chroma** persistent client at `/srv/mind/chroma_db`
- **Embedder:** `all-MiniLM-L6-v2` (90 MB, runs on CPU)
- At chat time: embed user question → retrieve top-5 relevant sessions → inject into prompt

### Fine-Tune (Later, Not Now)

- Tool: **unsloth** (optimized QLoRA for RTX 3090)
- Base: Qwen2.5-14B-Instruct, load_in_4bit=True
- LoRA: r=16, lora_alpha=16, target q/k/v/o projections
- Training pairs format: `{question + session metrics → coach answer}`
- ~500–1000 pairs, ~1–2 hours training time on RTX 3090
- Training pairs must teach the model to evaluate **decision quality**, not just outcome (a lucky bad trade / wrong exercise can have positive outcome)

### Build Order

1. `signals/` + `features/` — need real data first
2. `timeline/builder.py` — define schema, everything else builds on it
3. `sessions/store + indexer` — accumulate history
4. `llm/coach.py` with base model (no fine-tune) — working prototype fast
5. `training/` — only after 50+ real sessions, when it's clear where base model fails

## Open Questions

- Does `mind_api` currently stream HR/EEG in real time, or only store post-session? Need to know the data contract before building `signals/collector.py`.
- Where does XGBoost fit — is it a separate service or part of `mind_coach/features/`? The plan assumes it outputs `{stress_level, relaxation_quality, hrv_trend}` that get merged into the timeline JSON.
- What's the exact exercise instruction format in `mind_api`? Need it to populate `instructions_given` in the timeline event.
