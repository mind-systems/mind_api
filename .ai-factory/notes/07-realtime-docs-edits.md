# Realtime Docs Edits — Phase 19

**Date:** 2026-05-23
**Status:** ready
**Parent doc:** `.ai-factory/notes/03-biometric-stream-service.md` (§9 — list of docs to update)

All edits in Russian, behavior-only, no file trees, no method tables. Match the style of existing files under `docs/realtime/`. Per `~/.claude/CLAUDE.md` and `mind_api/CLAUDE.md`.

Each entry below is one roadmap task — one file, one focused change.

## Edit 1 — `docs/realtime/instruction-model.md`

The «Биометрическая шкала» subsection currently labelled "(будущее)" (line ~71-83). Remove the "(будущее)" caveat from the heading. Replace the placeholder text that says biometric streams will go through a separate service in the future with a present-tense one-paragraph description: biometric samples now flow through `ModuleBiometricStreamService`, attach to the same `ModuleSession` by `moduleSessionId`, time-join with instructions by `(moduleSessionId, timestamp)`. End with a one-line "См. [Биометрический поток](biometric-stream.md)" pointer.

## Edit 2 — `docs/realtime/database.md`

Add a new H2 section `bio_session_samples` after the existing `session_stream_samples` section, mirroring that section's structure (one-paragraph intro + columns table). Describe: each row holds a flushed batch of biometric samples for one `ModuleSession`; `samples` is jsonb array of `{timestamp, sampleType, data}` objects; flushed every `WS_BIO_STREAM_FLUSH_INTERVAL_MS` or on session lifecycle events. Column table mirrors the one for `session_stream_samples` (`id`, `moduleSessionId`, `samples`, `flushedAt`, `createdAt`).

## Edit 3 — `docs/realtime/configuration.md`

Add four new rows to the existing config table, immediately after the `WS_BACKPRESSURE_SAMPLES_PER_SEC` row (keep `WS_BIO_*` grouped together near their non-bio peers):

| `WS_BIO_STREAM_MAX_BUFFER_BYTES` | `1048576` | Per-сессия буфер биосэмплов в байтах (1 МБ). Больше инструкционного — поток плотнее. |
| `WS_BIO_STREAM_MAX_SESSIONS` | `1000` | Максимум одновременных биосессий с активным буфером. |
| `WS_BIO_BACKPRESSURE_SAMPLES_PER_SEC` | `50` | Подсказка обратного давления для биопотока. Клиент должен сам соблюдать лимит. |
| `WS_BIO_STREAM_FLUSH_INTERVAL_MS` | `5000` | Интервал периодического сброса биобуфера в `bio_session_samples`. |

(Russian wording — adjust to match the file's tone.)

## Edit 4 — `docs/realtime/overview.md`

In the «Слои системы» section, the **Transport Layer** paragraph currently mentions only `ModuleStateGrpcController` and `ModuleInstructionStreamGrpcController`. Add `ModuleBiometricStreamGrpcController` to the same enumeration. One-line addition.

In the «Instruction Layer» paragraph that describes `StreamEngine` buffering: add a parallel sentence noting that `BiometricStreamEngine` mirrors this pattern for biometric samples, with separate config keys (`WS_BIO_*`) and a separate table (`bio_session_samples`).

## Edit 5 — `docs/realtime/biometric-stream.md` (new file)

Create a new top-level doc, similar in length and shape to `instruction-model.md`. Sections (all in Russian):

- **Назначение** — что такое биометрический поток, как привязывается к сессии, зачем нужен (time-join с инструкциями).
- **Когда разрешён** — только при активной непаузной `ModuleSession`. Отдельная подписка от инструкций, но один gRPC-канал на пользователя.
- **Форма сэмпла** — `{sessionId, timestamp, sampleType, data}`. `sampleType` свободная строка (примеры: `cardio`, `nfb`, `emotions`). `data` — opaque jsonb; схема контролируется клиентом, сервер не валидирует поля.
- **Семантика паузы** — батч во время паузы отвергается целиком с кодом `SESSION_PAUSED`. Это **строже**, чем фильтрация инструкций по типу: там `session_event` пропускается, тут — нет. Все биометрические `sampleType` сейчас — пользовательские данные без служебной семантики; если когда-то появится тип, который должен проходить во время паузы, он будет включён явно.
- **Правила батча** — все сэмплы в одном батче должны нести один и тот же `sessionId` и непустой `sampleType`. Нарушение → `INVALID_ARGUMENT`.
- **Связь с `ModuleSession`** — `(moduleSessionId, timestamp)` — ключ time-join с инструкциями. Если сессии нет — `NO_SESSION`. Если `sessionId` в батче не совпадает с активной — `SESSION_MISMATCH`.

No file trees, no method tables, no proto excerpts.

## Edit 6 — `mind_api/CLAUDE.md`

Add one row to the Documentation table after the existing realtime rows:

```
| Biometric Stream | `docs/realtime/biometric-stream.md` | Биометрический поток — sample envelope, ограничения по паузе, time-join с инструкциями |
```
