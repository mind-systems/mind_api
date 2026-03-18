.PHONY: help build up down restart logs ps health db-reset

# Конфигурация по умолчанию
COMPOSE_DEV = docker-compose.dev.yml
COMPOSE_PROD = docker-compose.prod.yml

help:
	@echo "Доступные команды:"
	@echo "  make build          - Собрать docker-образы для разработки"
	@echo "  make up             - Запустить приложение в dev-режиме (в фоне)"
	@echo "  make down           - Остановить и удалить контейнеры"
	@echo "  make restart        - Перезапустить приложение"
	@echo "  make logs           - Показать логи приложения"
	@echo "  make ps             - Статус контейнеров"
	@echo "  make health         - Проверить работоспособность (healthcheck)"
	@echo "  make build-prod     - Собрать образы для продакшена"
	@echo "  make up-prod        - Запустить в продакшене"

build:
	docker compose --env-file .env.dev -f $(COMPOSE_DEV) build

up:
	docker compose --env-file .env.dev -f $(COMPOSE_DEV) up -d

down:
	docker compose --env-file .env.dev -f $(COMPOSE_DEV) down

restart:
	docker compose --env-file .env.dev -f $(COMPOSE_DEV) restart

logs:
	docker compose --env-file .env.dev -f $(COMPOSE_DEV) logs -f mind_api_dev

ps:
	docker compose --env-file .env.dev -f $(COMPOSE_DEV) ps

health:
	curl http://localhost:3002/health

db-reset:
	docker exec -it mind_api_database_dev_host psql -U mind_database_dev_user -d postgres -c "DROP DATABASE IF EXISTS mind_database_dev;" -c "CREATE DATABASE mind_database_dev;"
	docker compose --env-file .env.dev -f $(COMPOSE_DEV) restart mind_api_dev

build-prod:
	docker compose --env-file .env.prod -f $(COMPOSE_PROD) build

up-prod:
	docker compose --env-file .env.prod -f $(COMPOSE_PROD) up -d
