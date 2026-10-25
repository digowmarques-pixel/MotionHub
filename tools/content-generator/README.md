# Gerador do Pacote Inicial Megalume

Produz por código **122 itens originais**. Não há sample nem template de terceiros, então a Megalume tem todos os direitos.

| Pacote | Itens |
|---|---|
| Sons Essenciais (32) | whooshes (clássico, rápido, longo, grave, agudo, duplo), impactos (grave, cinematográfico, seco, metálico, sub drop), risers (2, 4 e 8 s), downlifter, swell reverso, glitch (longo e curto), clique, pop, ding, notificação dupla, tique e tique-taque, digitação, obturador, sucesso, erro, moeda, scratch de vinil, batida de coração, whoosh com impacto |
| Redes Sociais (10) | botões com clique (curtir, inscreva-se, seguir, compartilhar), sino de notificação, barra de progresso, arraste para cima, link na bio, balão de comentário, contador de seguidores |
| Ícones Animados (14) | check, X, coração, estrela, seta, play, mais, alerta, relógio, raio, cifrão, e-mail, compartilhar, localização |
| Efeitos 2D (10) | faíscas, brilho estelar, onda de choque, explosão cartoon, fumaça, relâmpago, linhas de velocidade, confete |
| Desenhado à Mão (8) | círculo rabiscado, seta, sublinhado ondulado, riscado, check, estrela, traços de ênfase, marca-texto |
| Transições (9 em 16:9) | wipe diagonal, flash branco, íris, glitch, painéis deslizantes, listras, quadrados, feixe de luz, escurecer |
| Overlays (5) | light leak quente e frio, bokeh, grão de filme, poeira e riscos |
| Fundos (4, em loop) | gradiente Megalume, gradiente quente, grade tecnológica, partículas |
| Formas (4) | anel explosão, sublinhado, anel pulsante, cantoneiras de foco |
| Contadores (3) | 10 s, 5 s, 3-2-1 |
| Texturas (5) | papel, grunge, retícula, scanlines, vinheta |
| Vertical 9:16 (18) | versões verticais de fundos, overlays, transições, linhas de velocidade e confete |

**Total: 122 itens.** Ícones, botões e efeitos são quadrados (1080×1080) com transparência, então servem em vídeo horizontal e vertical.

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
