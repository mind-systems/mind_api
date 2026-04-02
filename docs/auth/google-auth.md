# Google Authentication

Вход через Google Sign-In поддерживает два flow — оба передают `server_auth_code` на бэкенд, где Google-токены обрабатываются исключительно на сервере.

## Как устроен вход

Клиент делает gRPC-вызов `GoogleAuth` с сообщением `GoogleAuthRequest`, содержащим `server_auth_code`. Сервер через `google-auth-library` обменивает код на токены Google (`OAuth2Client.getToken`), затем верифицирует `id_token` (подпись, `aud`, `iss`, `exp`) и извлекает профиль: `googleId`, `email`, `name`. Google-токены после этого отбрасываются.

Дальше — тот же путь, что при email-входе: поиск пользователя по `email`, автоматическая регистрация если нового нет (имя берётся из Google-профиля), генерация app JWT. Сервер возвращает `AuthResponse` с полями `user` и `access_token`; для последующих gRPC-вызовов токен передаётся через metadata.

Если пользователь ранее зарегистрировался через email OTP с тем же адресом — он войдёт в тот же аккаунт. Идентификация идёт по `email`, не по `googleId`.

### Мобильный flow (SDK)

Мобильный клиент получает `server_auth_code` напрямую от Google Sign-In SDK. Поле `redirect_uri` не передаётся — `OAuth2Client.getToken` вызывается только с кодом.

### Браузерный flow

Браузерный клиент инициирует стандартный OAuth redirect. Google перенаправляет на `GET /auth/google/callback` — сервер принимает `code` из query-параметра и переадресует его обратно в приложение через `APP_BASE_URL`. Клиент затем делает gRPC-вызов `GoogleAuth`, передавая полученный код в поле `server_auth_code` и `redirect_uri` в `GoogleAuthRequest` — он нужен Google для верификации при обмене кода на токены.

## Конфигурация

| Переменная | Описание |
|------------|----------|
| `GOOGLE_CLIENT_ID` | OAuth 2.0 Client ID из Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | Client Secret |
| `APP_BASE_URL` | Базовый URL приложения — используется в callback relay для формирования redirect-адреса |

Все три переменные обязательны — при старте приложения `ConfigService.getOrThrow` бросит ошибку, если они не заданы.

## Эндпоинты

```
rpc GoogleAuth(GoogleAuthRequest) returns (AuthResponse)
  server_auth_code — обязательно
  language         — опционально
  redirect_uri     — опционально; передаётся только в браузерном flow —
                     Google отклоняет невалидные URI при обмене кода на токены

AuthResponse:
  user         — UserDto
  access_token — JWT для последующих gRPC-вызовов (передаётся через metadata)

UNAUTHENTICATED — невалидный или просроченный server_auth_code
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
| `proto/auth.proto` → `GoogleAuthRequest` | gRPC-сообщение запроса (`server_auth_code`, `language`, `redirect_uri`) |
| `src/users/service/auth.service.ts` | Метод `signInWithGoogle` |
| `src/users/auth.grpc.controller.ts` | gRPC-метод `googleAuth` (замена `POST /auth/google`) |
| `src/users/controller/google-callback.controller.ts` | `GET /auth/google/callback` — HTTP relay для браузерного OAuth flow |
