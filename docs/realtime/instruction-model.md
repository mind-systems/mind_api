# Realtime — Модель инструкций

Поток инструкций — это лог того, что приложение говорило пользователю делать в каждый момент времени. Без этих меток биометрические данные датчиков теряют смысл: числа есть, но неизвестно, что в этот момент происходило.

## Сессия как контейнер

`ModuleSession` — контейнер с двумя временны́ми метками: когда пользователь нажал Play и когда закончил. Внутри — поток сэмплов инструкций.

```
ModuleSession
├── startedAt   ← activity:start (пользователь нажал Play)
├── endedAt     ← activity:end или activity:stop
│
└── InstructionSamples[]
    ├── { instruction_type: "breath_phase", data: { phase: "inhale",  durationMs: 4000 }, timestamp: T+0     }
    ├── { instruction_type: "breath_phase", data: { phase: "hold",    durationMs: 2000 }, timestamp: T+4000  }
    ├── { instruction_type: "breath_phase", data: { phase: "exhale",  durationMs: 6000 }, timestamp: T+6000  }
    └── { instruction_type: "breath_phase", data: { phase: "rest",    durationMs: 1000 }, timestamp: T+12000 }
```

Сервер, получив такую запись, знает: в момент `T+0` пользователю была дана команда вдыхать 4 секунды. Когда придут биометрические данные датчика — они будут сопоставлены с этой инструкцией по `moduleSessionId + timestamp`.

## Момент activity:start

`activity:start` должен отправляться **когда пользователь нажал Play**, а не при открытии экрана. `startedAt` должен совпадать с реальным началом упражнения — от точности этой метки зависит корректность time-join с биометрическими данными.

## Форма сэмпла

Каждый сэмпл использует единый конверт независимо от модуля и типа инструкции:

| Поле | Описание |
|------|----------|
| `session_id` | Ссылка на `ModuleSession` |
| `module_id` | Идентификатор модуля, например `breath` |
| `instruction_type` | Дискриминатор: `breath_phase`, `session_event`, ... |
| `data` | Свободная структура (Struct/JSONB), форма зависит от `instruction_type` |
| `timestamp` | Клиентское unix-время в мс — момент выдачи инструкции |

### `breath_phase` (пишет клиент)

```json
{ "phase": "exhale", "durationMs": 6000 }
```

Отправляется при каждой смене фазы пока движок активен.

### `session_event` (пишет сервер)

```json
{ "event": "session_started" }
{ "event": "paused" }
{ "event": "resumed" }
{ "event": "session_ended" }
{ "event": "session_abandoned" }
{ "event": "session_interrupted" }
```

`session_abandoned` записывается, когда истекает grace period без переподключения клиента. `session_interrupted` — при явном `activity:stop`.

Пишется `ActivityEngine` при каждом lifecycle-переходе сессии: `activity:start/pause/resume/end/stop` и по истечении grace period. Сервер — авторитетный источник lifecycle-событий.

## Две независимые временны́е шкалы

```
Шкала инструкций
──────────────────────────────────────────────────────
session_started → breath_phase → … → paused → resumed → … → session_ended
                                                                          ├── session_abandoned  (grace period истёк)
                                                                          └── session_interrupted (activity:stop)

Биометрическая шкала (будущее)
────────────────────────────────
HR sample → HR sample → SpO2 → respiration → …
```

Аналитика выполняет time-join по `moduleSessionId + timestamp`. Поток инструкций должен быть полным — содержать все lifecycle-переходы, чтобы любой биометрический пробел объяснялся без обращения к отдельной таблице.

```
T+6000ms: инструкция — exhale 6s
T+6000–T+12000ms: биосигнал дыхания → совпадает ли реальный паттерн?
```

Биометрические потоки (дыхательный пояс, ЭЭГ) пойдут через отдельный gRPC-сервис и отдельную таблицу, но будут привязываться к той же `ModuleSession` по `moduleSessionId`.

## Пауза и инструкции

Когда сессия поставлена на паузу, `ModuleInstructionStreamGrpcController` блокирует входящие сэмплы `breath_phase`. Lifecycle-события (`paused`, `resumed`) при этом пишутся сервером самостоятельно — они проходят всегда. В результате за маркером `paused` возникает чистый пробел в сэмплах фаз, а маркер `resumed` его закрывает.

## Backpressure

Сервер управляет частотой через поле `max_samples_per_second` в подтверждении:

```json
{
  "received_count": 10,
  "dropped_count": 0,
  "max_samples_per_second": 5
}
```

Клиент обязан соблюдать `max_samples_per_second`. Для фаз дыхания это некритично — фаза меняется раз в несколько секунд. Для будущих высокочастотных биометрических потоков (256 Hz ЭЭГ) этот механизм станет ключевым.

## See Also

- [Протокол](protocol.md) — описание `ModuleInstructionStreamService`
- [Жизненный цикл сессии](session-lifecycle.md) — состояния сессии, пауза, reconnect
- [База данных](database.md) — схема таблицы `session_stream_samples`
