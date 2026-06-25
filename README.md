<p style="text-align: center;">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p style="text-align: center;">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p style="text-align: center;">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Описание

Mind Awake API — это бэкенд на базе NestJS для приложения осознанного дыхания. Проект реализует беспарольную аутентификацию (email OTP и Google Sign-In), управление сессиями дыхания и продвинутое логирование.

## Возможности

- **Auth:** Беспарольный вход через одноразовый email-код или Google Sign-In (server auth code flow).
- **Localization:** Транзакционные письма на языке пользователя; предпочтительная локаль хранится в профиле.
- **Security:** JWT с управлением сессиями (allow-list, SHA-256 хеш), строгие Guard'ы (Bearer), нормализация данных.
- **Breath Sessions:** CRUD для сессий дыхания с поддержкой публичного доступа (shared).
- **Logging:** Winston с ротацией логов (daily rotate) в папку `logs/`.
- **Infrastructure:** Полная поддержка Docker (multi-stage) и управление через Makefile.
- **Testing:** Покрытие ключевой бизнес-логики unit-тестами.

## Быстрый старт (Docker + Makefile)

Самый простой способ запустить проект — использовать `Makefile`. Он автоматически подтянет нужные `.env` файлы.

```bash
# Собрать и запустить dev-окружение
make up

# Проверить доступность (healthcheck)
make health

# Посмотреть логи приложения
make logs

# Остановить контейнеры
make down
```

## Локальная разработка (без Docker для API)

**1. Подготовка БД:**
```bash
# Запустить только Postgres через Docker
make up  # или docker compose --env-file .env.staging -f docker-compose.staging.yml up -d postgres
```
Или запустить базу через сервис и создать юзера бд

- Сбросить всю схему (таблицы, типы, индексы):
```bash
npm run db:drop
```

- Выполнить миграции
```bash
npm run migration:run
```

**2. Установка зависимостей:**
```bash
npm ci
```

**3. Запуск приложения:**
миграции выполняются автоматически
```bash
npm run start:dev
```

- Загрузить начальные данные (seed):
```bash
# БД запущена локально (использует .env по умолчанию)
userId=<uuid-пользователя> npx ts-node --project tsconfig.json src/scripts/seed-breath-sessions.ts

# БД в Docker (использует .env.seed.dev — host=localhost, port=5433)
userId=<uuid-пользователя> envFile=.env.seed.dev npx ts-node --project tsconfig.json src/scripts/seed-breath-sessions.ts
```
> Seed загружает breath sessions из `src/scripts/breath-sessions.json`. Пользователь должен уже существовать в БД — сначала выполни вход через API.

## Тестирование

```bash
# Запуск всех тестов
npm test

# Запуск конкретного теста (например, AuthService)
npm test src/users/service/auth.service.spec.ts
```

## Документация и логи

- **Логи:**
  - `logs/combined-YYYY-MM-DD.log` — все системные события.
  - `logs/error-YYYY-MM-DD.log` — только ошибки.

## Деплой (Production)

```bash
make up-prod
```
