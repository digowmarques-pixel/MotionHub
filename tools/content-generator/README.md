# Gerador do Pacote Inicial Megalume

Produz por código **33 itens originais**. Não há sample nem template de terceiros, então a Megalume tem todos os direitos.

| Pacote | Itens |
|---|---|
| Sons Essenciais (13) | whoosh clássico, swoosh rápido, whoosh longo, impacto grave, impacto cinematográfico, riser 4 s, swell reverso, clique de interface, pop, glitch, ding, tique de relógio, whoosh com impacto |
| Overlays (5) | light leak quente, light leak frio, bokeh, grão de filme, poeira e riscos |
| Fundos (4, em loop) | gradiente fluido azul, gradiente quente, grade tecnológica, partículas |
| Formas (4, com transparência) | anel explosão, sublinhado, anel pulsante, cantoneiras de foco |
| Transições (4, com transparência) | wipe diagonal, flash branco, íris, glitch |
| Contadores (3, com transparência) | 10 s, 5 s, 3-2-1 |

Formatos:
- Sons: WAV 48 kHz/24-bit, estéreo.
- Vídeos: 1920×1080, 30 fps. Opacos em H.264; com transparência em QuickTime Animation (.mov), que o Premiere lê nativamente.

## Uso

```bash
pip install numpy pillow          # + ffmpeg instalado
python3 generate.py --out ./saida                                   # cores padrão
python3 generate.py --out ./saida --primary FFCC00 --dark 0A0A0A    # cores da marca (padrão)
python3 generate.py --out ./saida --only contador-10s,pop           # só alguns itens

# Enviar ao servidor (curador/admin publica direto com --publish; --packs cria os pacotes)
MOTIONHUB_PASSWORD='...' node import.mjs --dir ./saida --server https://SEU-SERVIDOR --email voce@megalume.com.br --publish --packs
```

Para mudar algo, edite as receitas em `sfx.py` (sons) e `video.py` (vídeos) e gere de novo com uma versão maior (`--version 1.1.0` no import).
Projetos antigos continuam usando a versão anterior.

## Limites
- Não gera títulos com texto editável. Esses precisam ser MOGRT feitos no Premiere (veja `docs/guia-mogrt-premiere.md`).
- É design procedural, bom para uso diário. Para peças de alto impacto (abertura de campanha, vinheta de marca), vale um motion designer.
