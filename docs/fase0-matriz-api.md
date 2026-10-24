# Fase 0: matriz de APIs Adobe (Premiere Pro UXP)

Fonte: tipos oficiais `@adobe/premierepro` **26.5.1** (estável) e 27.0.0-beta.57, conferidos em 24/10/2026.
O plugin é compilado (`tsc`) contra esses tipos. Portanto, toda chamada abaixo **existe na API oficial**.
O que ainda falta é rodar cada uma num Premiere real (coluna "Validar em Premiere").

Legenda: ✅ implementado com API oficial · ⚠️ implementado, comportamento a confirmar · ❌ sem API, com contorno · ⏳ fora do MVP

| # | Ação crítica | API usada | Situação | Validar em Premiere |
|---|---|---|---|---|
| 1 | Detectar projeto ativo | `Project.getActiveProject()` | ✅ | retorno quando não há projeto (null ou exceção) |
| 2 | Detectar sequência ativa | `project.getActiveSequence()` | ✅ | idem |
| 3 | Ler FPS da sequência | `getSettings().getVideoFrameRate().value` | ✅ | 23.976 / 29.97 / 59.94 |
| 4 | Ler resolução | `settings.getVideoFrameRect()` | ✅ | sequências verticais |
| 5 | Ler posição da agulha | `sequence.getPlayerPosition()` | ✅ | — |
| 6 | Contar faixas V/A | `getVideoTrackCount()` / `getAudioTrackCount()` | ✅ | — |
| 7 | Inserir MOGRT | `SequenceEditor.insertMogrtFromPath(path, time, v, a)` | ⚠️ | não é `Action`: confirmar se precisa de `lockedAccess` e se gera **uma** etapa de Desfazer |
| 8 | Definir texto do MOGRT | `ComponentParam.createKeyframe(string)` (26.x) / `MogrtText.setText` (27+) | ⚠️ | formato esperado do texto em 26.x |
| 9 | Definir cor | `createKeyframe(new Color(r,g,b,a))` | ⚠️ | faixa 0–1 confirmada nos tipos 27 |
| 10 | Definir número/booleano/posição | `createKeyframe(number / boolean / PointF)` | ⚠️ | posição normalizada × pixels |
| 11 | Encontrar controle do MOGRT pelo nome | `getComponentChain()` → `getParam(i).displayName` | ⚠️ | nomes do Essential Graphics aparecem como `displayName`? |
| 12 | Ajustar duração do item | `trackItem.createSetEndAction(TickTime)` | ✅ | — |
| 13 | Agrupar parâmetros num Desfazer | `project.executeTransaction(compound, "nome")` | ✅ | — |
| 14 | Importar mídia sem diálogo | `project.importFiles([path], suppressUI=true, bin)` | ✅ | caminhos com acentos no Windows |
| 15 | Criar pasta (bin) | `root.createBinAction(name)` | ✅ | — |
| 16 | Não duplicar importação | `ClipProjectItem.getMediaFilePath()` | ✅ | — |
| 17 | Sobrescrever na timeline | `createOverwriteItemAction(item, time, v, a)` | ✅ | — |
| 18 | Inserir empurrando clipes | `createInsertProjectItemAction(..., limitShift)` | ✅ | — |
| 19 | Criar nova faixa | índice ≥ número de faixas (documentado na API) | ⚠️ | confirmar para MOGRT |
| 20 | Detectar faixa bloqueada | **não há getter**; só o evento `EVENT_TRACK_LOCK_CHANGED` | ❌ | contorno: erro do host vira `track_locked`; avaliar ouvir o evento |
| 21 | Desfazer | Ctrl/Cmd+Z nativo (transações nomeadas) | ✅ | — |
| 22 | Ler legendas/transcrição | `CaptionTrack`, `Transcript` | ⏳ | Fase 5 |
| 23 | Transições | `createAddVideoTransitionAction`, `TransitionFactory` | ⏳ | Fase 4 (M07) |
| 24 | Keyframes | `ComponentParam.createAddKeyframeAction` | ⏳ | Fase 4 (M14) |
| 25 | After Effects | `@adobe/aftereffects` UXP | ⏳ | Fase 3: abrir matriz própria |

## Como validar (roteiro para quem tem Premiere)
1. Instale o **UXP Developer Tool** (Creative Cloud).
2. `pnpm --filter @motionhub/premiere-plugin build` (com `MOTIONHUB_API_URL` apontando ao servidor).
3. No UXP Developer Tool: *Add Plugin* → `apps/premiere-plugin/dist/manifest.json` → *Load*.
4. Premiere: *Janela → Extensões (UXP) → Motion Hub*.
5. Percorra os itens marcados ⚠️/❌ acima com um MOGRT real da Megalume e registre o resultado nesta tabela.
