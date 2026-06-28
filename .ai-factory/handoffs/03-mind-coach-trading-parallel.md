# Mind Coach & Trading System — Shared Architecture Pattern

**Date:** 2026-06-28
**Source:** conversation context (digital_ocean project, architecture discussion)

## Key Findings

- Mind Coach and the trading system share an identical structural pattern — discovered organically during architecture discussion, not imposed.
- The shared abstraction is: **background context → event with instructions → reaction**. Both systems know what they told the agent (user / market) and can evaluate decision quality vs. outcome.
- The `timeline/` layer in `mind_coach/` should be kept domain-neutral from day one — it is the natural extraction point for a shared library if/when the trading system is built.
- Trading system is explicitly **deferred** — build mind_coach first, extract shared layer later.

## Details

### The Universal Pattern

```
[background context] → [event with system instructions] → [reaction]
```

| Dimension | Mind (breathing) | Trading |
|---|---|---|
| Background context | bio signals before exercise | market state before entry |
| Event | exercise + instructions given to user | trade + strategy conditions at entry |
| Reaction | bio signals during/after | P&L dynamics during trade |
| System snapshot | bio state at exercise start | full market snapshot at entry |
| fit_score | did exercise match user's bio state? | did entry match strategy's regime conditions? |

### Why This Matters

Both systems have a property that is rare in ML pipelines: **the system knows its own intent**. `instructions_given` in mind, `strategy_conditions` in trading. This makes it possible to evaluate the *quality of the decision*, not just the outcome — a lucky bad trade and a correct trade that lost money are fundamentally different, and the LLM can be taught to distinguish them.

This is the same function in both domains:

```
score(context, action, outcome) → fit_score + quality_label
```

### Logical Connection to Trading System

The trading system (tradeoxy) would follow the same pipeline:

- **Signals:** OHLCV + volume instead of HR/EEG
- **Feature extraction:** volatility, trend strength, regime detection (HMM or k-means) instead of HRV/EEG bands
- **Regime** is the trading analog of bio state — strategy performance is a function of regime, just as exercise effectiveness is a function of bio state at entry
- **Timeline JSON:** same pre/event/post structure, different field names
- **RAG:** same Chroma + embedder setup, trades stored as sessions
- **LLM:** same Qwen2.5 14B, different LoRA fine-tune (trading analyst persona vs. breathing coach)

### What to Keep Generic in mind_coach Now

Only one thing needs to be domain-neutral from the start:

- `timeline/schema.py` — pydantic models with `domain: str` field
- `timeline/builder.py` — takes domain-specific inputs, emits unified Session JSON
- `timeline/fit_score.py` — abstract interface, mind implementation provided

Everything else (signals, features, LLM persona, fine-tune data) is domain-specific and should not be abstracted prematurely.

### Extraction Path (Future)

When trading system is started:
1. Extract `timeline/` into a shared package (e.g., `ai_coach_core/`)
2. Implement `TradingFitScore(FitScoreBase)`
3. Reuse RAG retriever and LLM inference layer as-is
4. Only build new: signal collection, feature extraction, LoRA fine-tune data for trading domain

## Open Questions

- Does tradeoxy already emit a full market snapshot per trade? The architecture assumes it does (`conditions_at_entry`). Worth confirming the data model before designing the shared schema.
- Regime detection for trading (HMM vs clustering) — not decided yet. This affects what goes into `conditions_at_entry` and how fit_score is computed.
