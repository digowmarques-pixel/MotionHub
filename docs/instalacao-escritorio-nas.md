# Instalação no escritório: Motion Hub com biblioteca no NAS

**Cenário:** 8 editores, todos no escritório, um NAS compartilhado. **Não precisa de servidor.**
**Tempo total:** cerca de 1 hora na primeira vez (30 min de preparação + 3 a 5 min por máquina).

```
 NAS  \\NAS\MotionHub\  ← biblioteca: uma pasta por efeito
        ├── light-leak-quente\   (item.json, vídeo, preview, miniatura)
        ├── sfx-whoosh-classico\
        └── ...
          ▲  leitura (e escrita para quem adiciona efeitos)
          │
 8 máquinas: Premiere Pro 25.6+  +  plugin Motion Hub
```

---

## Parte 1: preparar o NAS (uma vez, 10 min)

1. No NAS, crie uma pasta compartilhada chamada **`MotionHub`**.
2. Permissões:
   - **Todos os editores:** leitura.
   - **Quem vai adicionar efeitos** (por exemplo, você e mais uma pessoa): leitura e escrita. Se quiser que todos possam usar o botão **+** do painel, dê escrita a todos.
3. Descompacte `pacote-inicial-megalume-v1.1.0.zip` e **copie as 33 pastas de dentro dele** (`light-leak-quente`, `sfx-pop`…) para `MotionHub`.
   - Pode organizar em subpastas, por exemplo `MotionHub\Sons\sfx-pop\`, `MotionHub\Transicoes\...`. O painel procura até 3 níveis.
4. Inclua a pasta `MotionHub` no **backup** do NAS.

> **Importante para projetos compartilhados:** todas as máquinas devem acessar o NAS **pelo mesmo caminho**. Use sempre o mesmo caminho de rede (ex.: `\\NAS\MotionHub`) ou a mesma letra de unidade em todas (ex.: `M:`). Se cada máquina usar um caminho diferente, um projeto aberto em outra máquina mostra "mídia offline". Se houver **Macs e PCs** misturados, os caminhos sempre serão diferentes; nesse caso, use o "Vincular mídia" do Premiere apontando para a mesma pasta.

## Parte 2: gerar o instalador do plugin (uma vez, 15 min, em qualquer máquina)

A Adobe recomenda gerar o instalador `.ccx` com a ferramenta oficial gratuita:

1. Abra o app **Creative Cloud** → aba **Todos os aplicativos** → procure **UXP Developer Tool** → **Instalar**.
   (Se não aparecer: Creative Cloud → Preferências → ative a exibição de ferramentas de desenvolvedor.)
2. Descompacte `plugin-motion-hub-0.2.0.zip` numa pasta qualquer.
3. Abra a **UXP Developer Tool** → **Add Plugin** → escolha o arquivo `manifest.json` dentro de `MotionHub-Plugin`.
4. No plugin que apareceu na lista, clique em **•••** → **Package** e escolha onde salvar.
   O resultado é um arquivo terminado em **`.ccx`**.
5. Copie o `.ccx` para o NAS, por exemplo `\\NAS\MotionHub-Instaladores\`.

## Parte 3: instalar em cada máquina (3 a 5 min cada)

1. Feche o Premiere.
2. Dê **dois cliques** no arquivo `.ccx` (no NAS).
3. O Creative Cloud abre e mostra um aviso de que o plugin **não vem do Marketplace da Adobe**. Isso é esperado, porque o plugin é interno. Clique em **Instalar**. Se pedir senha de administrador, informe.
4. Abra o Premiere → **Janela → Plugins UXP → Motion Hub**. Encaixe o painel onde preferir (por exemplo, ao lado do Projeto).
5. No painel, clique em **Escolher pasta da biblioteca** e selecione `\\NAS\MotionHub`.
   - Windows: no seletor, vá em **Rede** → NAS → `MotionHub`, ou use a letra de unidade mapeada.
   - Mac: conecte o compartilhamento antes (Finder → Ir → Conectar ao Servidor), depois escolha `/Volumes/MotionHub`.
6. Pronto: os efeitos aparecem. A escolha da pasta fica salva.

## Uso diário

- **Buscar:** digite (sem precisar de acento), filtre por categoria e passe o mouse para ver a miniatura.
- **Inserir:** abra o efeito → escolha posição (agulha ou início) e faixa → **Inserir na sequência**. Desfaça com Ctrl+Z / Cmd+Z.
- **Favoritos e Recentes:** ficam salvos em cada máquina.
- **Adicionar efeito novo:** botão **+** → escolha o arquivo (.mogrt, .mov, .mp4, .wav…), nome, tipo, tags e, se quiser, uma miniatura e um preview → **Adicionar à biblioteca**. Ele aparece para os outros editores quando clicarem em **⟳**.
- **Tirar um efeito da busca sem quebrar projetos antigos:** edite o `item.json` dele e acrescente `"state": "deprecated"`. Para apagar de vez, remova a pasta, mas só se nenhum projeto usar aquele arquivo.
- **NAS desligado:** o painel avisa "Pasta da biblioteca indisponível" e mostra a última lista conhecida. A inserção volta a funcionar quando o NAS voltar.

## Formato de um efeito (para quem prefere copiar pastas)

Cada efeito é uma pasta com o arquivo e um `item.json`:

```json
{
  "name": "Lower Third Clean",
  "type": "title",
  "main": "lower-third-clean.mogrt",
  "thumb": "thumb.jpg",
  "preview": "preview.mp4",
  "tags": ["lower third", "entrevista", "nome"],
  "synonyms": ["tarja", "gc"],
  "summary": "Tarja de nome e cargo, entrada pela esquerda."
}
```

Tipos válidos: `title`, `text`, `transition`, `shape`, `overlay`, `sfx`, `caption`, `timer`, `media`.
Se algum `item.json` tiver erro, o painel mostra **"⚠ N com problema"** ao lado da contagem. Passe o mouse para ver qual pasta é.

## O que conferir no primeiro teste (por favor, anote o resultado)

| Teste | Resultado esperado |
|---|---|
| Inserir um **som** (ex.: Whoosh Clássico) | Entra na faixa de áudio na posição da agulha |
| Inserir um **overlay** com modo **Tela** | Luz sobre o vídeo, sem fundo preto |
| Inserir uma **transição** (.mov com transparência) | O vídeo de baixo aparece através dela |
| Abrir um projeto salvo em **outra máquina** | Sem "mídia offline" (se o caminho do NAS for o mesmo) |
| **Ctrl+Z** depois de inserir | Remove o que foi inserido |
| Botão **+** com um .mogrt feito no Premiere | Aparece na busca após ⟳ |
| Preview em vídeo ao abrir um item | Toca no painel (se não tocar, mostra a miniatura) |

Os pontos que dependem do comportamento do Premiere estão em `fase0-matriz-api.md`.
