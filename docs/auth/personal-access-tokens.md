# Personal Access Tokens

Personal Access Tokens (PAT) — альтернативный способ аутентификации, не привязанный к JWT-сессии. Токен выпускается один раз и действует до явного отзыва. Основное применение — интеграции, скрипты и MCP-серверы, которым неудобно проходить OTP-поток.

---

## gRPC-методы

Все три метода входят в `AuthService`. Аутентификация обязательна: JWT передаётся в metadata gRPC-вызова.

### `rpc CreateToken(CreateTokenRequest) returns (CreateTokenResponse)`

Создаёт новый токен.

**Поля запроса `CreateTokenRequest`:**

| Поле | Тип | Обязательно | Описание |
|------|-----|-------------|----------|
| `name` | string | да | Произвольное название для идентификации токена |

**Ответ `CreateTokenResponse`:**

```
token      — "pat_a1b2c3d4e5f6..."
id         — uuid
name       — "MCP integration"
created_at — ISO-8601
```

> **Важно:** поле `token` возвращается **только при создании**. Сырой токен не хранится в базе — сохраняется только SHA-256 хеш. Если пользователь потерял токен, единственный путь — отозвать старый и создать новый.

### `rpc ListTokens(ListTokensRequest) returns (ListTokensResponse)`

Список всех токенов текущего пользователя. `ListTokensRequest` пустое — пользователь определяется по metadata. Сырой токен не возвращается.

**Ответ `ListTokensResponse`:**

```
tokens: [
  {
    id           — uuid
    name         — "MCP integration"
    created_at   — ISO-8601
    last_used_at — ISO-8601 или отсутствует
  }
]
```

### `rpc DeleteToken(DeleteTokenRequest) returns (DeleteTokenResponse)`

Отзывает токен. Если токен не принадлежит текущему пользователю или не существует — возвращает `NOT_FOUND`.

**Поля запроса `DeleteTokenRequest`:**

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | string | UUID токена |

---

## Формат токена

Сырой токен имеет формат `pat_<64 hex символа>` (32 случайных байта через `crypto.randomBytes`). Префикс `pat_` позволяет отличать его от JWT и облегчает поиск утечек в логах и системах мониторинга.

---

## Безопасность

| Аспект | Реализация |
|--------|-----------|
| Хранение | SHA-256 хеш в колонке `tokenHash` таблицы `personal_access_tokens` |
| Генерация | `crypto.randomBytes(32)` — криптографически стойкий RNG |
| Однократный показ | Сырой токен возвращается только в ответе `CreateToken`, не хранится |
| Валидация | Хеширование предъявленного токена → поиск по `tokenHash` |
| Отслеживание | `lastUsedAt` обновляется при каждой успешной валидации |
| Привязка к пользователю | `userId` индексирован; `DeleteToken` проверяет принадлежность |

---

## База данных

Таблица `personal_access_tokens`:

| Колонка | Тип | Описание |
|---------|-----|----------|
| `id` | UUID (PK) | Идентификатор |
| `userId` | UUID (indexed) | Владелец |
| `tokenHash` | varchar (unique, indexed) | SHA-256 хеш токена |
| `name` | varchar | Название |
| `lastUsedAt` | timestamp, nullable | Время последнего использования |
| `createdAt` | timestamp | Время создания |
