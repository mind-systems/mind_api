# Realtime — Схема базы данных

Realtime-система использует четыре таблицы. `module_sessions` фиксирует жизненный цикл каждой сессии — как корневых, так и дочерних. `session_stream_samples` хранит батчи инструкционных сэмплов, привязанных к дочерним сессиям. `bio_session_samples` хранит батчи биометрических сэмплов, привязанных к корневым сессиям. `user_stats` содержит агрегированную статистику пользователя.

## module_sessions

Каждая запись соответствует одной сессии. Корневые сессии (`activityType = root`) образуют биотаймлайн пользователя; дочерние сессии (например `breath`, `meditation`) ссылаются на свой корень через `rootSessionId`.

| Колонка | Тип | Описание |
|---------|-----|----------|
| `id` | uuid PK | |
| `userId` | uuid FK → users | Проиндексирован. |
| `activityType` | enum | Тип активности: `root` (серверный, не экспонируется в proto), `breath`, `meditation`. |
| `rootSessionId` | uuid nullable FK → module_sessions | `null` для корневых сессий; для дочерних — id их корня. ON DELETE CASCADE. Проиндексирован. |
| `activityRefId` | uuid nullable | Идентификатор связанной сущности. FK-ограничение отсутствует намеренно — позволяет расширять набор типов без миграций. |
| `status` | enum | `active`, `disconnected`, `completed`, `abandoned`, `interrupted`, `resumed`. |
| `startedAt` | timestamp | Время начала сессии. |
| `disconnectedAt` | timestamptz nullable | Время разрыва стрима. Точка отсчёта grace-таймера. |
| `endedAt` | timestamp nullable | Время фактического завершения. Никогда не выставляется в момент разрыва стрима. |
| `lastActivityAt` | timestamp | Обновляется при создании; при каждом батче инструкций — для дочерних сессий; при каждом сбросе биометрического буфера — для корневой сессии. |
| `metadata` | jsonb nullable | Произвольные метаданные сессии. |
| `createdAt` | timestamp | |

Индексы: `IDX … (userId)` — для поиска сессий пользователя; `IDX … (status)` — для поиска resumable-сессий; `IDX … (rootSessionId)` — для выборки дочерних сессий по корню.

## session_stream_samples

Хранит батчи инструкционных сэмплов, переданные через `ModuleInstructionStreamService`. Привязаны к **дочерней** сессии — `moduleSessionId` здесь всегда id дочернего узла.

| Колонка | Тип | Описание |
|---------|-----|----------|
| `id` | uuid PK | |
| `moduleSessionId` | uuid FK → module_sessions | ON DELETE CASCADE. Проиндексирован. Id дочерней сессии. |
| `samples` | jsonb | Массив объектов сэмплов батча. |
| `flushedAt` | timestamp | Время сброса батча. |
| `createdAt` | timestamp | |

`StreamEngine` сбрасывает буфер в эту таблицу каждые 5 секунд или при завершении дочерней сессии.

## bio_session_samples

Хранит батчи биометрических сэмплов, переданные через `ModuleBiometricStreamService`. Привязаны к **корневой** сессии — `moduleSessionId` здесь всегда id корневого узла.

| Колонка | Тип | Описание |
|---------|-----|----------|
| `id` | uuid PK | |
| `moduleSessionId` | uuid FK → module_sessions | ON DELETE CASCADE. Проиндексирован. Id корневой сессии. |
| `samples` | jsonb | Массив объектов `{timestamp, sampleType, data}` батча. `sessionId` внутри не дублируется — он избыточен относительно `moduleSessionId` строки. |
| `flushedAt` | timestamp | Время сброса батча. |
| `createdAt` | timestamp | |

`BiometricStreamEngine` сбрасывает буфер по таймеру каждые `WS_BIO_STREAM_FLUSH_INTERVAL_MS`, когда корневая сессия переходит в `abandoned`, и при штатной остановке процесса.

Аналитика соединяет биометрику с практикой через временно́й join: выбирает строки `bio_session_samples` с `moduleSessionId = child.rootSessionId` и `ts ∈ [child.startedAt, child.endedAt]`, где `child` — конкретная дочерняя сессия. Это позволяет восстановить полную картину: что приложение говорило пользователю (`session_stream_samples`) и как организм реагировал (`bio_session_samples`), при том что два потока хранятся раздельно.

## user_stats

Одна строка на пользователя. Обновляется при каждом завершении квалифицирующей **дочерней** сессии — сессии с длительностью не менее `WS_MIN_SESSION_DURATION_S`. Корневые сессии в статистику не включаются никогда. Брошенные и слишком короткие дочерние сессии тоже пропускаются.

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
