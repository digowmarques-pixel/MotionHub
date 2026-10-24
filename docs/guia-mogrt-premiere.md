# Guia: criar títulos da Megalume no Premiere (MOGRT)

**Para quem:** qualquer editor da Megalume. Não precisa de After Effects.
**Tempo:** cerca de 15 a 30 minutos por título.
**Resultado:** um arquivo `.mogrt` que aparece no painel Motion Hub de todos os editores, com texto e cor editáveis.

> Os menus abaixo seguem o Premiere Pro 25.x. Em algumas versões o menu se chama **Gráficos** e em outras **Gráficos e Títulos**. Se a interface estiver em português, procure os nomes equivalentes.

---

## Antes de começar: regras da casa

| Regra | Por quê |
|---|---|
| Use só **fontes do Adobe Fonts** ou fontes instaladas em todas as máquinas da empresa | Se a fonte faltar em outra máquina, o Premiere troca por outra |
| Use as **cores oficiais** da marca (anote o código #RRGGBB) | Padroniza a identidade visual (objetivo do projeto) |
| Mantenha o texto dentro da **área segura de título** (Programa → ⚙ → Margens seguras) | Evita corte em TVs e redes sociais |
| **Duração padrão: 5 s**, com entrada em até 0,5 s e saída em até 0,5 s | O editor ajusta a duração depois, no painel Motion Hub |
| **Dê nome a cada camada** (ex.: `Headline`, `Subtitle`) | O painel Motion Hub encontra os campos editáveis pelo nome |
| Uma ideia por template (um lower third, um título de abertura…) | Fica mais fácil buscar e reutilizar |

## Passo a passo

1. **Crie uma sequência** 1920×1080 no padrão da casa (ex.: 29,97 fps). Para redes, faça versões separadas em 1080×1920.
2. Abra o espaço de trabalho **Gráficos** (*Janela → Espaços de trabalho → Gráficos*).
3. Com a **ferramenta Texto** (T), clique no Monitor de Programa e digite um texto de exemplo, como `NOME DA PESSOA`. Isso cria um clipe gráfico na timeline.
4. No painel **Essential Graphics / Propriedades**:
   - escolha fonte, tamanho e cor da marca;
   - **renomeie a camada de texto** para `Headline`;
   - adicione outras camadas se precisar (`Subtitle`, uma forma de fundo `Faixa`…). Cada camada que o editor deve poder mudar precisa de um nome claro.
5. **Anime** com keyframes de Posição, Escala e Opacidade (painel *Controles de efeito*). Mantenha a entrada nos primeiros 0,5 s e a saída nos últimos 0,5 s.
6. **Teste:** mude o texto para algo longo (ex.: `Maria Aparecida dos Santos Oliveira`) e confira se não estoura a área segura.
7. **Exporte o template:** selecione o clipe gráfico na timeline → **Gráficos → Exportar como modelo de Motion Graphics**.
   - Nome: igual ao que vai aparecer no catálogo (ex.: `Lower Third Clean Azul`).
   - Destino: **Unidade local** (salve numa pasta sua).
   - Palavras-chave: `megalume, lower third, entrevista`.
8. **Gere o preview:** exporte a sequência como MP4 H.264 (até 10 s) e um quadro como PNG (*Exportar quadro*, ícone de câmera no Monitor de Programa).

## Enviar para o catálogo

1. Abra o **Painel admin** do Motion Hub → **Novo asset**.
2. Preencha nome, tipo **title**, tags e sinônimos. Pense em como alguém buscaria: "tarja", "gc", "nome".
3. Arquivo principal: o `.mogrt`. Preview: o MP4. Poster: o PNG.
4. Em **Parâmetros editáveis**, liste os campos usando como `label` **o mesmo nome das camadas**:

```json
[
  { "key": "headline", "label": "Headline", "type": "string", "default": "NOME DA PESSOA", "maxLength": 60 },
  { "key": "subtitle", "label": "Subtitle", "type": "string", "default": "Cargo ou empresa", "maxLength": 80 },
  { "key": "durationSec", "label": "Duração", "type": "duration", "default": 5, "min": 2, "max": 20 }
]
```

5. Deixe marcado **Enviar para revisão**. Um curador confere e publica.

## Checklist do curador (antes de publicar)

- [ ] Fonte disponível em todas as máquinas (Adobe Fonts ou instalada)
- [ ] Texto longo não estoura a área segura
- [ ] Entrada e saída suaves, sem "pulo" no primeiro ou no último quadro
- [ ] Os nomes dos parâmetros batem com as camadas (teste no painel Motion Hub: o aviso "Parâmetro X não existe neste template" indica nome errado)
- [ ] Preview e poster representam bem o template
- [ ] Tags e sinônimos fazem sentido para quem busca

## Limitações conhecidas

- Templates feitos no **After Effects** não podem ser reexportados pelo Premiere. Os da casa devem ser feitos inteiramente no Premiere.
- O comportamento exato de quais propriedades ficam editáveis num MOGRT feito no Premiere precisa ser confirmado no teste da Fase 0 (ver `fase0-matriz-api.md`, itens 8 a 11).
