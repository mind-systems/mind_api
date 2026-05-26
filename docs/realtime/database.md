# Realtime — Схема базы данных

Realtime-система использует четыре таблицы. `module_sessions` фиксирует жизненный цикл каждой активности. `session_stream_samples` хранит батчи сэмплов, переданные через `ModuleInstructionStreamService`. `bio_session_samples` хранит батчи биометрических сэмплов, переданные через `ModuleBiometricStreamService`. `user_stats` содержит агрегированную статистику пользователя.

## module_sessions

Каждая запись соответствует одному запуску активности — от `activity:start` до завершения любым из возможных путей.

| Колонка | Тип | Описание |
|---------|-----|----------|
| `id` | uuid PK | |
| `userId` | uuid FK → users | Проиндексирован. |
| `activityType` | enum | Тип активности. Единственное текущее значение: `breath`. |
| `activityRefId` | uuid nullable | Идентификатор связанной сущности. FK-ограничение отсутствует намеренно — позволяет расширять набор типов без миграций. |
| `status` | enum | `active`, `disconnected`, `completed`, `abandoned`, `interrupted`, `resumed`. |
| `startedAt` | timestamp | Время начала активности. |
| `disconnectedAt` | timestamptz nullable | Время разрыва стрима. Точка отсчёта grace-таймера. |
| `endedAt` | timestamp nullable | Время фактического завершения. Никогда не выставляется в момент разрыва стрима. |
| `lastActivityAt` | timestamp | Обновляется при `activity:start` и каждом батче инструкций. |
| `metadata` | jsonb nullable | Произвольные метаданные сессии. |
| `createdAt` | timestamp | |

Индексы: `IDX … (userId)` — для поиска сессий пользователя; `IDX … (status)` — для поиска resumable-сессий по статусу.

## session_stream_samples

Хранит батчи сэмплов, переданные через `ModuleInstructionStreamService`. `StreamEngine` сбрасывает буфер в эту таблицу каждые 5 секунд или при завершении сессии.

| Колонка | Тип | Описание |
|---------|-----|----------|
| `id` | uuid PK | |
| `moduleSessionId` | uuid FK → module_sessions | ON DELETE CASCADE. Проиндексирован. |
| `samples` | jsonb | Массив объектов сэмплов батча. |
| `flushedAt` | timestamp | Время сброса батча. |
| `createdAt` | timestamp | |

## bio_session_samples

Хранит батчи биометрических сэмплов, переданные через `ModuleBiometricStreamService`. `BiometricStreamEngine` сбрасывает буфер в эту таблицу каждые 5 секунд или при завершении сессии (`completed`, `abandoned`, `interrupted`) или при отзыве auth-сессии (`session.revoked`).

| Колонка | Тип | Описание |
|---------|-----|----------|
| `id` | uuid PK | |
| `moduleSessionId` | uuid FK → module_sessions | ON DELETE CASCADE. Проиндексирован. |
| `samples` | jsonb | Массив объектов `{timestamp, sampleType, data}` батча. `sessionId` внутри не дублируется — он избыточен относительно `moduleSessionId` строки. |
| `flushedAt` | timestamp | Время сброса батча. |
| `createdAt` | timestamp | |

Структура колонок зеркалит `session_stream_samples`. Биометрические сэмплы и инструкционные сэмплы соединяются аналитикой по `(moduleSessionId, timestamp)` — это позволяет восстановить полную картину сессии: что приложение сказало пользователю и как организм отреагировал.

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
| `maxCompletedComplexity` | float default 0 | Максимальная сложность завершённой сессии. |
| `lastSessionDate` | date nullable | Дата последней квалифицирующей сессии. Используется для определения разрыва серии. |
| `updatedAt` | timestamptz | |

Серия (`currentStreak`) обнуляется, если между `lastSessionDate` и датой новой сессии разрыв больше одного календарного дня. Все операции выполняются через upsert — строка создаётся при первой завершённой сессии.

