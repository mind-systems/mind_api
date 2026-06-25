.PHONY: help build up down restart logs ps health db-reset

# Конфигурация по умолчанию
COMPOSE_STAGING = docker-compose.staging.yml
COMPOSE_PROD = docker-compose.prod.yml

help:
	@echo "Доступные команды:"
	@echo "  make build          - Собрать docker-образы для staging"
	@echo "  make up             - Запустить приложение в staging-режиме (в фоне)"
	@echo "  make down           - Остановить и удалить контейнеры"
	@echo "  make restart        - Перезапустить приложение"
	@echo "  make logs           - Показать логи приложения"
	@echo "  make ps             - Статус контейнеров"
	@echo "  make health         - Проверить работоспособность (healthcheck)"
	@echo "  make build-prod     - Собрать образы для продакшена"
	@echo "  make up-prod        - Запустить в продакшене"

build:
	docker compose --env-file .env.staging -f $(COMPOSE_STAGING) build

up:
	docker compose --env-file .env.staging -f $(COMPOSE_STAGING) up -d

down:
	docker compose --env-file .env.staging -f $(COMPOSE_STAGING) down

restart:
	docker compose --env-file .env.staging -f $(COMPOSE_STAGING) restart

logs:
	docker compose --env-file .env.staging -f $(COMPOSE_STAGING) logs -f mind_api_staging

ps:
	docker compose --env-file .env.staging -f $(COMPOSE_STAGING) ps

health:
	curl http://localhost:3002/health

db-reset:
	docker exec -it mind_api_database_staging_host psql -U mind_database_dev_user -d postgres -c "DROP DATABASE IF EXISTS mind_database_dev;" -c "CREATE DATABASE mind_database_dev;"
	docker compose --env-file .env.staging -f $(COMPOSE_STAGING) restart mind_api_staging

build-prod:
	docker compose --env-file .env.prod -f $(COMPOSE_PROD) build

up-prod:
	docker compose --env-file .env.prod -f $(COMPOSE_PROD) up -d
