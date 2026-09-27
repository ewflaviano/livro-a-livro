.DEFAULT_GOAL := run

.PHONY: help install run dev local local-api local-reset preview test typecheck build check api-check clean

help: ## Lista os comandos locais disponíveis
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z_-]+:.*##/ {printf "  %-14s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Instala as dependências do aplicativo
	npm ci

run: ## Abre o aplicativo local em http://127.0.0.1:5173 (padrão de make)
	npm run dev

dev: run ## Alias de make run

local: ## App e simulador de Google/Drive, somente dados descartáveis
	npm run local

local-api: ## Inicia somente o simulador em 127.0.0.1:8788
	npm run local:api

local-reset: ## Remove somente arquivos descartáveis do simulador parado
	npm run local:reset

preview: build ## Serve o build de produção localmente
	npm run preview

test: ## Executa a suíte TypeScript
	npm test
	npm run test:local

typecheck: ## Confere os tipos TypeScript
	npm run typecheck

build: ## Gera o build estático de produção
	npm run build

check: test typecheck build api-check ## Executa todas as verificações locais

api-check: ## Formata, valida e testa o núcleo Rust da API
	cargo fmt --manifest-path api/Cargo.toml -- --check
	cargo clippy --manifest-path api/Cargo.toml --all-targets --all-features -- -D warnings
	cargo test --manifest-path api/Cargo.toml --all-features

clean: ## Remove somente artefatos de build regeneráveis
	rm -rf dist
