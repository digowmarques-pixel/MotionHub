# MEGALUME Motion Hub

Biblioteca interna de títulos, MOGRTs, transições, overlays e SFX integrada ao Premiere Pro,
conforme `MEGALUME_MOTION_HUB_Especificacao_Tecnica_v1.pdf`.

## O que existe hoje

| Componente | Pasta | Estado |
|---|---|---|
| Contratos compartilhados (manifest, RBAC, busca, SHA-256, estados) | `packages/shared` | ✅ testado |
| API + fila de previews + pacotes assinados | `apps/api` | ✅ testado com Postgres e ffmpeg reais |
| Plugin Premiere (UXP) | `apps/premiere-plugin` | ✅ núcleo testado; ⚠️ validar dentro do Premiere (ver `docs/fase0-matriz-api.md`) |
| Painel web de administração | `apps/admin` | ✅ testado ponta a ponta no navegador |
| Gerenciador desktop (M11) | — | ⏳ próxima etapa |
| Plugin After Effects (M04) | — | ⏳ Fase 3 |
| Legendas animadas (M08) | — | ⏳ Fase 5 |

Capturas de tela em `docs/screenshots/`.

## Arquitetura

```
 Premiere ──UXP── apps/premiere-plugin ──HTTPS──┐
                  (catálogo local offline,      │
                   download com SHA-256)        ▼
                                          apps/api (Fastify) ── PostgreSQL
 Navegador ────── apps/admin (React) ──────────▲      │
                                                      ├── storage (disco/NAS; S3 depois)
                                                      └── worker: ffmpeg (previews) e .mlpack (Ed25519)
```

Decisões tomadas (a spec permitia "ou equivalente"):
- **Fastify** em vez de NestJS: menos código e mais rápido de manter para o tamanho do time.
- **Fila no PostgreSQL** (`SKIP LOCKED`) em vez de Redis/BullMQ: uma peça a menos de infraestrutura. Trocável em `apps/api/src/jobs/queue.ts`.
- **Busca local em memória** (índice invertido em JS) em vez de SQLite FTS: o painel UXP não carrega módulos nativos. Mede ~5–30 ms em 10 mil itens (meta: 300 ms).
- **Storage local** (disco ou NAS) com interface pronta para S3.
- Plugin em **TypeScript puro, sem React**: o UXP não é um navegador comum (§8).

## Rodando localmente

Pré-requisitos: Node 20+, pnpm 10, PostgreSQL 14+, ffmpeg.

```bash
pnpm install
pnpm --filter @motionhub/shared build

# API
cd apps/api
cp .env.example .env               # ajuste DATABASE_URL e JWT_SECRET
pnpm keygen                        # chave Ed25519 para assinar pacotes
pnpm seed -- --admin-email voce@megalume.com.br --admin-password 'senha-forte-aqui'
pnpm seed-demo -- --email voce@megalume.com.br --password 'senha-forte-aqui'   # opcional: 12 assets de exemplo
pnpm dev                           # http://localhost:8080 (worker embutido)

# Painel admin
cd apps/admin && pnpm dev          # http://localhost:5173

# Plugin no navegador, com Premiere simulado
cd apps/premiere-plugin && pnpm dev   # http://localhost:5174

# Plugin real para o Premiere
MOTIONHUB_API_URL=https://seu-servidor pnpm --filter @motionhub/premiere-plugin build
# → carregar apps/premiere-plugin/dist/manifest.json no UXP Developer Tool
```

## Testes

```bash
pnpm test     # shared (31) + api (14, precisa do Postgres em motionhub_test) + plugin (12)
```

Cobrem os casos BDD da spec (§14): CT-001 a CT-004, além de: path traversal, extensão enganosa,
hash divergente, RBAC, rotação e reuso de refresh token, versões imutáveis, rollback, kill-switch
de pacote, mascaramento de caminhos pessoais e busca em 10 mil itens.

## Fluxo editorial

1. **Motion Designer** cria o asset no painel (manifest + arquivos). O hash e o formato real de cada arquivo são verificados.
2. **Enviar para revisão**: a versão fica imutável e o worker gera um preview padronizado (MP4 H.264 ≤10 s e poster WebP).
3. **Curador** publica (bloqueado até o preview existir) ou devolve com motivo.
4. Os editores veem o asset no painel do Premiere no próximo sync. Uma nova versão não altera projetos antigos, e o rollback volta a versão corrente.

## Pendências e decisões abertas (§19)

- Distribuição só interna, ou venda futura a terceiros?
- Catálogo em nuvem ou NAS? O código suporta os dois; falta escolher a hospedagem.
- Versões do Premiere em uso nas estações (o manifest exige 25.6+).
- Os 20–30 presets do pacote piloto, e se há MOGRTs existentes da empresa para importar.
- MFA para admins (§9) e driver S3 ainda não implementados.
