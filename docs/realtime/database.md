# Realtime — Схема базы данных

Realtime-система использует три таблицы. ` ` фиксирует жизненный цикл каждой активности. `session_stream_samples` хранит инструкции, переданные через `ModuleInstructionService`. `user_stats` содержит агрегированную статистику пользователя.

## live_sessions

Каждая запись соответствует одному запуску активности — от `activity:start` до завершения любым из возможных путей.

| Колонка | Тип | Описание |
|---------|-----|----------|
| `id` | uuid PK | |
| `userId` | uuid FK → users | Проиндексирован. |
| `activityType` | varchar | Тип активности, например `breath`. |
| `activityRefId` | uuid nullable | Идентификатор связанной сущности. FK-ограничение отсутствует намеренно — позволяет расширять набор типов без миграций. |
| `status` | enum | `active`, `disconnected`, `completed`, `interrupted`, `abandoned`. |
| `startedAt` | timestamptz | Время начала активности. |
| `disconnectedAt` | timestamptz nullable | Время разрыва стрима. Точка отсчёта grace-таймера. |
| `endedAt` | timestamptz nullable | Время фактического завершения. Никогда не выставляется в момент разрыва стрима. |
| `lastActivityAt` | timestamptz | Обновляется при `activity:start` и каждом батче инструкций. |
| `createdAt` | timestamptz | |

Индексы: `(userId, status)` — для поиска resumable-сессии при переподключении; `(userId, createdAt DESC)` — для истории сессий.

## session_stream_samples

Хранит инструкции, переданные через `ModuleInstructionService`. `StreamEngine` сбрасывает буфер в эту таблицу каждые 5 секунд или при завершении сессии.

| Колонка | Тип | Описание |
|---------|-----|----------|
| `id` | uuid PK | |
| `liveSessionId` | uuid FK → live_sessions | Проиндексирован. |
| `moduleId` | varchar | Идентификатор модуля-отправителя, например `breath`. |
| `instructionType` | varchar | Тип инструкции, например `breath_phase`, `session_event`. |
| `recordedAt` | timestamptz | Клиентская метка времени сэмпла. |
| `data` | jsonb | Payload инструкции. Схема зависит от `instructionType`. |
| `createdAt` | timestamptz | Время записи на сервере. |

## user_stats

Одна строка на пользователя. Обновляется при каждом завершении квалифицирующей сессии — сессии с длительностью не менее `WS_MIN_SESSION_DURATION_S`. Брошенные и слишком короткие сессии в статистику не включаются.

| Колонка | Тип | Описание |
|---------|-----|----------|
| `id` | uuid PK | |
| `userId` | uuid FK → users | Unique. |
| `totalSessions` | int default 0 | Количество завершённых квалифицирующих сессий. |
| `totalDurationSeconds` | int default 0 | Суммарное время всех квалифицирующих сессий. |
| `currentStreak` | int default 0 | Текущая серия — последовательные дни с хотя бы одной квалифицирующей сессией. |
| `longestStreak` | int default 0 | Рекорд серии за всё время. |
| `lastSessionDate` | date nullable | Дата последней квалифицирующей сессии. Используется для определения разрыва серии. |
| `updatedAt` | timestamptz | |

Серия (`currentStreak`) обнуляется, если между `lastSessionDate` и датой новой сессии разрыв больше одного календарного дня. Все операции выполняются через upsert — строка создаётся при первой завершённой сессии.

## See Also

- [Жизненный цикл сессии](session-lifecycle.md) — состояния ModuleSession, reconnect
- [Модель инструкций](telemetry-model.md) — структура потока инструкций
- [Конфигурация](configuration.md) — переменные окружения
