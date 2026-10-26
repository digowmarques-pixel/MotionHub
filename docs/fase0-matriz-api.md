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

## Mesclagem de overlays (plugin 0.3.4)

Overlays sem alpha (.mp4: light leak, bokeh, poeira, grão) recebem `blend`/`opacity` do item.json
(ou da regra `inferLook` para itens antigos) e o plugin ajusta o efeito **Opacidade** (`AE.ADBE Opacity`).

| Ponto | Situação |
|---|---|
| Valor do "Modo de mesclagem" = índice em ordem alfabética (Normal 18, Tela 22, Sobrepor 19) | Mapeado por terceiros no Premiere 25.2 (Osiris-Premiere-MCP, MIT). **Validar no 26.x.** |
| Trava de segurança | Antes de aplicar, o plugin lê o modo do clipe novo; se não for 18 (Normal), não altera e mostra aviso para aplicar à mão. |
| Opacidade em 0–100 | Validar no Premiere real. |

## Presets de movimento (plugin 0.4.0)

A aba **Movimento** anima o próprio clipe selecionado: adiciona efeitos nativos e grava keyframes
calculados pelo plugin (um por quadro, depois simplificados), com curvas expo/back/elastic/bounce.

| Efeito | matchName | Parâmetros usados (nome PT/EN, índice de reserva) |
|---|---|---|
| Transformar | `AE.ADBE Geometry2` | Posição (1), Escala uniforme (2), Escala (3), Rotação (7), Opacidade (8), Usar ângulo do obturador da composição (9), Ângulo do obturador (10) |
| Desfoque gaussiano | `AE.ADBE Gaussian Blur 2` | Intensidade (0), Repetir pixels de borda (2) |
| Desfoque direcional | `AE.ADBE Motion Blur` | Direção (0), Comprimento (1) |
| 3D básico | `AE.ADBE Basic 3D` | Girar (0), Inclinar (1) |
| Deslocamento | `AE.ADBE Offset` | Deslocar centro para (0) |

**Validar no Premiere real** (o painel mostra um resumo técnico abaixo do status):
- Tempo dos keyframes = ponto de entrada do clipe (`getInPoint`) + deslocamento. Se aparecerem fora do lugar, a base de tempo é outra.
- Posição em pixels ou 0–1: detectado lendo o valor inicial; aparece como "posição em px" ou "posição em 0–1".
- Cada aplicação usa 2 etapas de Desfazer por clipe (adicionar efeitos; keyframes).
