# Google Authentication

Вход через Google Sign-In поддерживает два flow — оба передают `serverAuthCode` на бэкенд, где Google-токены обрабатываются исключительно на сервере.

## Как устроен вход

Клиент отправляет `POST /auth/google` с `serverAuthCode`. Сервер через `google-auth-library` обменивает код на токены Google (`OAuth2Client.getToken`), затем верифицирует `id_token` (подпись, `aud`, `iss`, `exp`) и извлекает профиль: `googleId`, `email`, `name`. Google-токены после этого отбрасываются.

Дальше — тот же путь, что при email-входе: поиск пользователя по `email`, автоматическая регистрация если нового нет (имя берётся из Google-профиля), генерация app JWT. Ответ аналогичен email-флоу: токен в заголовке `Authorization: Bearer <token>` и `UserResponseDto` в теле.

Если пользователь ранее зарегистрировался через email OTP с тем же адресом — он войдёт в тот же аккаунт. Идентификация идёт по `email`, не по `googleId`.

### Мобильный flow (SDK)

Мобильный клиент получает `serverAuthCode` напрямую от Google Sign-In SDK. Поле `redirectUri` не передаётся — `OAuth2Client.getToken` вызывается только с кодом.

### Браузерный flow

Браузерный клиент инициирует стандартный OAuth redirect. Google перенаправляет на `GET /auth/google/callback` — сервер принимает `code` из query-параметра и переадресует его обратно в приложение через `APP_BASE_URL`. Клиент затем вызывает `POST /auth/google` с полученным кодом и передаёт `redirectUri` — он нужен Google для верификации при обмене кода на токены.

## Конфигурация

| Переменная | Описание |
|------------|----------|
| `GOOGLE_CLIENT_ID` | OAuth 2.0 Client ID из Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | Client Secret |
| `APP_BASE_URL` | Базовый URL приложения — используется в callback relay для формирования redirect-адреса |

Все три переменные обязательны — при старте приложения `ConfigService.getOrThrow` бросит ошибку, если они не заданы.

## Эндпоинты

```
POST /auth/google
Body: { "serverAuthCode": "...", "redirectUri": "..." }
  serverAuthCode — обязательно
  redirectUri    — обязательно только для браузерного flow; должен быть валидным URI

200 OK
Authorization: Bearer <jwt>
Body: UserResponseDto

401 Unauthorized — невалидный или просроченный serverAuthCode
```

```
GET /auth/google/callback?code=...
GET /auth/google/callback?error=...

Relay-эндпоинт для браузерного OAuth flow. Принимает callback от Google и
перенаправляет обратно в приложение:
  → успех: {APP_BASE_URL}/auth/google/callback?googleCode=<code>
  → ошибка: {APP_BASE_URL}/auth/google/callback?googleError=<error>
```

## Реализация

| Файл | Роль |
|------|------|
| `src/users/service/google-token.service.ts` | Обмен кода и верификация `id_token`; поддерживает мобильный и браузерный flow |
| `src/users/interfaces/google-profile.interface.ts` | Тип `{ googleId, email, name }` |
| `src/users/dto/google-auth.dto.ts` | DTO запроса (`serverAuthCode`, `language`, `redirectUri`) |
| `src/users/service/auth.service.ts` | Метод `signInWithGoogle` |
| `src/users/auth.controller.ts` | `POST /auth/google`, `GET /auth/google/callback` |
