"""
Gera o "Pacote Inicial Megalume": conteúdo 100% original, produzido por código.
Uso:  python3 generate.py --out ./saida [--primary FFCC00 --dark 0A0A0A] [--only id1,id2]
Saída: uma pasta por item com o arquivo principal, preview.mp4/.wav, poster.png e item.json.
Depois: node import.mjs --dir ./saida --server ... --email ... (envia ao Motion Hub).
"""
import argparse
import json
import os
import subprocess
import time

import numpy as np
from PIL import Image, ImageDraw

import elements as E
import sfx
import video as V

OVERLAY_TIP = "Coloque numa faixa acima do vídeo e use o modo de mesclagem Tela (Screen)."
ALPHA_TIP = "Arquivo com transparência: basta colocar numa faixa acima do vídeo."
TRANSITION_TIP = "Coloque na faixa acima do corte, com o ponto do corte no meio da transição."

VIDEO_ITEMS = [
    # id, nome, tipo, função, kwargs, alfa, poster_t, resumo, tags, sinônimos, pacote
    ("light-leak-quente", "Light Leak Quente", "overlay", V.light_leak, {"warm": True}, False, 2.5, f"Vazamento de luz laranja e vermelho. {OVERLAY_TIP}", ["luz", "quente", "light leak"], ["vazamento de luz", "flare"], "overlays"),
    ("light-leak-frio", "Light Leak Frio", "overlay", V.light_leak, {"warm": False}, False, 2.5, f"Vazamento de luz em azul e violeta. {OVERLAY_TIP}", ["luz", "frio", "light leak"], ["vazamento de luz", "flare"], "overlays"),
    ("bokeh-suave", "Bokeh Suave", "overlay", V.bokeh, {}, False, 3, f"Círculos de luz desfocados subindo devagar. {OVERLAY_TIP}", ["bokeh", "luz", "festa"], ["desfoque", "luzes"], "overlays"),
    ("grao-de-filme", "Grão de Filme", "overlay", V.film_grain, {}, False, 1, "Grão de película sobre cinza médio. Use o modo Sobrepor (Overlay) com 20–40% de opacidade.", ["grão", "filme", "textura"], ["grain", "ruído"], "overlays"),
    ("poeira-e-riscos", "Poeira e Riscos", "overlay", V.dust_scratches, {}, False, 2, f"Partículas de poeira e riscos de película antiga. {OVERLAY_TIP}", ["poeira", "vintage", "textura"], ["dust", "riscos"], "overlays"),
    ("fundo-gradiente-marca", "Fundo Gradiente Megalume", "background", V.gradient_fluid, {"warm": False}, False, 2, "Fundo em loop de 8 s: preto com brilhos amarelos, nas cores da marca.", ["fundo", "gradiente", "loop", "marca"], ["background", "bg", "amarelo"], "fundos"),
    ("fundo-gradiente-quente", "Fundo Gradiente Fluido Quente", "background", V.gradient_fluid, {"warm": True}, False, 2, "Fundo em loop de 8 s com gradiente laranja e vinho.", ["fundo", "gradiente", "loop"], ["background", "bg"], "fundos"),
    ("fundo-grade-tech", "Fundo Grade Tecnológica", "background", V.tech_grid, {}, False, 2, "Grade em perspectiva avançando, em loop de 6 s.", ["fundo", "tecnologia", "grade"], ["background", "grid"], "fundos"),
    ("fundo-particulas", "Fundo Partículas", "background", V.particles, {}, False, 2, "Partículas luminosas subindo sobre fundo escuro, em loop de 8 s.", ["fundo", "partículas", "loop"], ["background", "poeira"], "fundos"),
    ("forma-anel-explosao", "Anel Explosão", "shape", V.ring_burst, {}, True, 0.45, f"Anel que se expande com raios, para destacar um ponto. {ALPHA_TIP}", ["destaque", "anel", "explosão"], ["burst", "círculo"], "formas"),
    ("forma-sublinhado", "Sublinhado Animado", "shape", V.underline, {}, True, 1.2, f"Linha que entra e sai sob um texto. {ALPHA_TIP}", ["sublinhado", "linha", "texto"], ["underline", "traço"], "formas"),
    ("forma-anel-pulsante", "Anel Pulsante", "shape", V.pulse_ring, {}, True, 1, f"Anéis respirando em loop, para chamar atenção. {ALPHA_TIP}", ["anel", "pulso", "loop"], ["círculo", "ping"], "formas"),
    ("forma-cantoneiras", "Cantoneiras de Foco", "shape", V.corner_brackets, {}, True, 1.2, f"Quatro cantoneiras que enquadram o assunto. {ALPHA_TIP}", ["foco", "moldura", "enquadrar"], ["brackets", "mira"], "formas"),
    ("transicao-wipe-diagonal", "Transição Wipe Diagonal", "transition", V.wipe_diagonal, {}, True, 0.3, f"Duas faixas diagonais cobrem e revelam a tela em 1 s. {TRANSITION_TIP}", ["wipe", "diagonal", "transição"], ["cortina", "slide"], "transicoes"),
    ("transicao-flash", "Transição Flash Branco", "transition", V.flash, {}, True, 0.2, f"Clarão branco de 0,6 s. {TRANSITION_TIP}", ["flash", "branco", "transição"], ["clarão", "dip to white"], "transicoes"),
    ("transicao-iris", "Transição Íris", "transition", V.iris, {}, True, 0.5, f"Círculo que cobre e abre a tela em 1 s. {TRANSITION_TIP}", ["íris", "círculo", "transição"], ["iris", "zoom"], "transicoes"),
    ("transicao-glitch", "Transição Glitch", "transition", V.glitch_blocks, {}, True, 0.35, f"Blocos digitais e scanlines por 0,7 s. Combine com o som Glitch Digital. {TRANSITION_TIP}", ["glitch", "digital", "transição"], ["falha", "erro"], "transicoes"),
    ("contador-10s", "Contador 10 Segundos", "timer", V.countdown, {"start": 10}, True, 0.5, f"Contagem regressiva de 10 a 1 com anel de progresso. {ALPHA_TIP}", ["contador", "contagem", "regressiva"], ["countdown", "timer", "cronômetro"], "contadores"),
    ("contador-5s", "Contador 5 Segundos", "timer", V.countdown, {"start": 5}, True, 0.5, f"Contagem regressiva de 5 a 1 com anel de progresso. {ALPHA_TIP}", ["contador", "contagem", "regressiva"], ["countdown", "timer"], "contadores"),
    ("contador-3s", "Contador 3, 2, 1", "timer", V.countdown, {"start": 3, "seconds_per": 0.8}, True, 0.3, f"Contagem rápida 3, 2, 1. {ALPHA_TIP}", ["contador", "3 2 1", "abertura"], ["countdown"], "contadores"),
]

SQUARE, WIDE, TALL = (1080, 1080), (1920, 1080), (1080, 1920)
EL_TIP = "Elemento com transparência (1080×1080): coloque numa faixa acima do vídeo e ajuste a escala. Serve para vídeos horizontais e verticais."


def extra_items():
    """Itens novos: redes sociais, ícones, efeitos 2D, desenhado à mão, transições extras e versões verticais."""
    it = []

    def add(id_, name, typ, fn, kw=None, pt=1.0, summary="", tags=(), syn=(), pack="", size=SQUARE, alpha=True, aspect="any"):
        it.append(dict(id=id_, name=name, type=typ, fn=fn, kw=kw or {}, pt=pt, summary=summary, tags=list(tags), syn=list(syn), pack=pack, size=size, alpha=alpha, aspect=aspect))

    # Redes sociais
    add("social-botao-curtir", "Botão Curtir com Clique", "social", E.button_click, {"before": "CURTIR", "after": "CURTIDO", "glyph_before": E.g_heart}, 1.6, f"Cursor clica e o botão vira amarelo com coração. {EL_TIP}", ["curtir", "like", "botão", "instagram"], ["gostei", "coração"], "social")
    add("social-botao-inscrever", "Botão Inscreva-se com Clique", "social", E.button_click, {"before": "INSCREVA-SE", "after": "INSCRITO", "glyph_before": E.g_bell, "glyph_after": E.g_check}, 1.6, f"Chamada para se inscrever no canal, com clique. {EL_TIP}", ["inscrever", "youtube", "botão", "canal"], ["subscribe"], "social")
    add("social-botao-seguir", "Botão Seguir com Clique", "social", E.button_click, {"before": "SEGUIR", "after": "SEGUINDO", "glyph_before": E.g_plus, "glyph_after": E.g_check}, 1.6, f"Chamada para seguir o perfil, com clique. {EL_TIP}", ["seguir", "follow", "botão", "perfil"], ["follow"], "social")
    add("social-botao-compartilhar", "Botão Compartilhar com Clique", "social", E.button_click, {"before": "COMPARTILHAR", "after": "COMPARTILHADO", "glyph_before": E.g_share, "glyph_after": E.g_check}, 1.6, f"Chamada para compartilhar, com clique. {EL_TIP}", ["compartilhar", "share", "botão"], ["enviar"], "social")
    add("social-sino-notificacao", "Sino de Notificação", "social", E.bell_notify, None, 1.0, f"Sino balançando com aviso de nova notificação. {EL_TIP}", ["sino", "notificação", "youtube"], ["bell", "ativar notificações"], "social")
    add("social-barra-progresso", "Barra de Progresso", "social", E.progress_bar, None, 2.5, f"Barra que enche de 0 a 100% em 5 s. {EL_TIP}", ["progresso", "carregando", "porcentagem"], ["loading", "barra"], "social")
    add("social-arraste-para-cima", "Arraste para Cima", "social", E.swipe_up, None, 1.0, f"Setas subindo com a chamada ARRASTE PARA CIMA. {EL_TIP}", ["arraste", "stories", "chamada"], ["swipe up", "deslize"], "social")
    add("social-link-na-bio", "Link na Bio", "social", E.link_bio, None, 1.0, f"Selo LINK NA BIO com seta apontando para baixo. {EL_TIP}", ["link", "bio", "chamada", "instagram"], ["link in bio"], "social")
    add("social-balao-comentario", "Balão de Comentário", "social", E.comment_bubble, None, 1.0, f"Balão com pontinhos de 'digitando'. {EL_TIP}", ["comentário", "mensagem", "digitando"], ["chat", "balão"], "social")
    add("social-contador-seguidores", "Contador de Seguidores 10K", "social", E.follower_counter, None, 2.2, f"Número sobe até 10K com o texto SEGUIDORES. {EL_TIP}", ["seguidores", "número", "crescimento"], ["followers", "contador"], "social")

    # Ícones animados
    for gid, name, glyph, badge, tags, syn in [
        ("check", "Check (Correto)", E.g_check, "circle", ["check", "correto", "ok"], ["certo", "aprovado"]),
        ("x", "X (Errado)", E.g_x, "circle", ["x", "errado", "não"], ["incorreto", "cancelar"]),
        ("coracao", "Coração", E.g_heart, "circle", ["coração", "amor", "like"], ["heart"]),
        ("estrela", "Estrela", E.g_star, "circle", ["estrela", "favorito", "destaque"], ["star"]),
        ("seta-direita", "Seta para a Direita", E.g_arrow, "circle", ["seta", "direita", "próximo"], ["arrow"]),
        ("play", "Play", E.g_play, "circle", ["play", "vídeo", "assistir"], ["reproduzir"]),
        ("mais", "Mais (+)", E.g_plus, "circle", ["mais", "adicionar", "novo"], ["plus"]),
        ("alerta", "Alerta", E.g_alert, "triangle", ["alerta", "atenção", "aviso"], ["warning", "cuidado"]),
        ("relogio", "Relógio", E.g_clock, "circle", ["relógio", "tempo", "horário"], ["clock"]),
        ("raio", "Raio (Rápido)", E.g_bolt, "circle", ["raio", "energia", "rápido"], ["bolt", "flash"]),
        ("cifrao", "Cifrão (Dinheiro)", E.g_dollar, "circle", ["dinheiro", "preço", "cifrão"], ["money", "real"]),
        ("email", "E-mail", E.g_mail, "circle", ["email", "mensagem", "contato"], ["carta", "mail"]),
        ("compartilhar", "Compartilhar", E.g_share, "circle", ["compartilhar", "share", "rede"], ["enviar"]),
    ]:
        add(f"icone-{gid}", f"Ícone {name}", "icon", E.icon_anim, {"glyph": glyph, "badge": badge}, 1.0, f"Ícone que entra com pulo, fica e sai. {EL_TIP}", tags + ["ícone"], syn, "icones")
    add("icone-localizacao", "Ícone Localização", "icon", E.pin_anim, None, 1.0, f"Pino de mapa quicando com sombra. {EL_TIP}", ["localização", "mapa", "endereço", "ícone"], ["pin", "local"], "icones")

    # Efeitos 2D
    add("fx-faiscas", "Faíscas", "fx", E.sparks, None, 0.3, f"Explosão de faíscas amarelas e brancas. {EL_TIP}", ["faíscas", "brilho", "explosão"], ["sparks", "fagulhas"], "fx")
    add("fx-brilho-estrela", "Brilho Estelar", "fx", E.glint, None, 0.35, f"Cintilância em forma de estrela, para destacar produtos. {EL_TIP}", ["brilho", "cintilar", "produto"], ["glint", "sparkle", "reflexo"], "fx")
    add("fx-onda-de-choque", "Onda de Choque", "fx", E.shockwave, None, 0.3, f"Anéis que se expandem rápido a partir do centro. {EL_TIP}", ["onda", "impacto", "anel"], ["shockwave"], "fx")
    add("fx-explosao-cartoon", "Explosão Cartoon", "fx", E.cartoon_explosion, None, 0.2, f"Explosão estilo desenho com fumaça. {EL_TIP}", ["explosão", "cartoon", "humor"], ["boom", "kaboom"], "fx")
    add("fx-fumaca", "Fumaça (Puff)", "fx", E.smoke_puff, None, 0.5, f"Nuvem de fumaça estilizada para aparecer ou sumir. {EL_TIP}", ["fumaça", "puff", "sumir"], ["smoke", "poof"], "fx")
    add("fx-relampago", "Relâmpago", "fx", E.lightning, None, 0.1, f"Raio elétrico piscando de cima a baixo. {EL_TIP}", ["relâmpago", "raio", "energia"], ["lightning", "trovão"], "fx")
    for size, sfx_, asp in ((WIDE, "", "16:9"), (TALL, "-vertical", "9:16")):
        tag = " (Vertical 9:16)" if sfx_ else ""
        add(f"fx-linhas-velocidade{sfx_}", f"Linhas de Velocidade{tag}", "fx", E.speed_lines, None, 1.0, "Linhas radiais estilo anime, para foco e velocidade. Com transparência, tela cheia.", ["velocidade", "anime", "foco"], ["speed lines", "zoom"], "vertical" if sfx_ else "fx", size, True, asp)
        add(f"fx-confete{sfx_}", f"Confete{tag}", "fx", E.confetti, None, 1.5, "Chuva de confete nas cores da marca, para comemorações. Com transparência, tela cheia.", ["confete", "festa", "comemoração"], ["confetti", "celebração"], "vertical" if sfx_ else "fx", size, True, asp)

    # Desenhado à mão
    for hid, name, path, tags, syn in [
        ("circulo", "Círculo Rabiscado", E.p_circle, ["círculo", "destacar", "rabisco"], ["circle", "marcar"]),
        ("seta", "Seta Desenhada", E.p_arrow, ["seta", "apontar", "rabisco"], ["arrow"]),
        ("sublinhado-ondulado", "Sublinhado Ondulado", E.p_wavy, ["sublinhado", "ondulado", "texto"], ["underline"]),
        ("riscado", "Riscado", E.p_strike, ["riscar", "errado", "texto"], ["strike", "cortar"]),
        ("check", "Check Desenhado", E.p_check, ["check", "correto", "rabisco"], ["certo"]),
        ("estrela", "Estrela Rabiscada", E.p_star, ["estrela", "destaque", "rabisco"], ["star", "doodle"]),
        ("enfase", "Traços de Ênfase", E.p_emphasis, ["ênfase", "atenção", "destaque"], ["linhas", "brilho"]),
    ]:
        add(f"mao-{hid}", name, "handdrawn", E.hand_anim, {"path_fn": path}, 1.0, f"Traço que se desenha e treme como animação à mão. {EL_TIP}", tags + ["desenhado à mão"], syn + ["doodle"], "mao")
    add("mao-marca-texto", "Marca-Texto", "handdrawn", E.highlighter, None, 1.0, f"Faixa amarela translúcida passando sobre um texto. {EL_TIP}", ["marca-texto", "destacar", "texto", "desenhado à mão"], ["highlight"], "mao")

    # Transições extras, em 16:9 e 9:16
    for size, sfx_, asp in ((WIDE, "", "16:9"), (TALL, "-vertical", "9:16")):
        tag = " (Vertical 9:16)" if sfx_ else ""
        pk = "vertical" if sfx_ else "transicoes"
        tip = "Coloque na faixa acima do corte, com o corte no meio da transição."
        add(f"transicao-paineis{sfx_}", f"Transição Painéis Deslizantes{tag}", "transition", E.slide_panels, None, 0.45, f"Painéis amarelo e preto cobrem e revelam a tela em 1 s. {tip}", ["painel", "slide", "transição"], ["wipe"], pk, size, True, asp)
        add(f"transicao-listras{sfx_}", f"Transição Listras{tag}", "transition", E.stripes, None, 0.5, f"Listras amarelas e pretas em cascata. {tip}", ["listras", "faixas", "transição"], ["stripes"], pk, size, True, asp)
        add(f"transicao-quadrados{sfx_}", f"Transição Quadrados{tag}", "transition", E.tiles, None, 0.45, f"Quadrados que crescem em diagonal e somem. {tip}", ["quadrados", "mosaico", "transição"], ["tiles", "pixel"], pk, size, True, asp)
        add(f"transicao-feixe-de-luz{sfx_}", f"Transição Feixe de Luz{tag}", "transition", E.light_streak, None, 0.4, f"Feixe de luz passa com clarão no meio. {tip}", ["luz", "feixe", "transição"], ["light streak", "flare"], pk, size, True, asp)
        add(f"transicao-dip-preto{sfx_}", f"Transição Escurecer (Dip to Black){tag}", "transition", E.dip_black, None, 0.4, f"Escurece e volta em 0,8 s. {tip}", ["preto", "fade", "transição"], ["dip to black", "fade"], pk, size, True, asp)
    return it


def vertical_variants():
    """Versões 9:16 dos fundos, overlays e transições originais."""
    out = []
    keep = {"background", "overlay", "transition"}
    for (vid, name, typ, fn, kw, alpha, pt, summary, tags, syn, pack) in VIDEO_ITEMS:
        if typ in keep:
            out.append(dict(id=f"{vid}-vertical", name=f"{name} (Vertical 9:16)", type=typ, fn=fn, kw=kw, pt=pt, summary=summary, tags=tags + ["vertical", "stories", "reels"], syn=syn, pack="vertical", size=TALL, alpha=alpha, aspect="9:16"))
    return out


TEXTURES = [
    ("textura-papel", "Textura de Papel", E.tex_paper, "Papel com fibras. Use o modo Multiplicar sobre o vídeo.", ["papel", "textura", "fundo"], ["paper"]),
    ("textura-grunge", "Textura Grunge", E.tex_grunge, "Manchas escuras com transparência, para visual sujo e envelhecido.", ["grunge", "sujo", "textura"], ["dirt", "envelhecido"]),
    ("textura-reticula", "Textura Retícula", E.tex_halftone, "Pontos de retícula em degradê, estilo impressão/HQ, com transparência.", ["retícula", "pontos", "hq"], ["halftone", "pop art"]),
    ("textura-scanlines", "Textura Scanlines", E.tex_scanlines, "Linhas horizontais de TV antiga, com transparência.", ["scanlines", "tv", "retrô"], ["crt", "vhs"]),
    ("textura-vinheta", "Vinheta", E.tex_vignette, "Escurecimento suave nas bordas, com transparência.", ["vinheta", "bordas", "cinema"], ["vignette"]),
]


PACKS = {
    "sons": ("megalume-sons-essenciais", "Megalume · Sons Essenciais"),
    "overlays": ("megalume-overlays", "Megalume · Overlays de Luz e Textura"),
    "fundos": ("megalume-fundos", "Megalume · Fundos Animados"),
    "formas": ("megalume-formas", "Megalume · Formas e Destaques"),
    "transicoes": ("megalume-transicoes", "Megalume · Transições"),
    "contadores": ("megalume-contadores", "Megalume · Contadores"),
    "social": ("megalume-redes-sociais", "Megalume · Redes Sociais"),
    "icones": ("megalume-icones", "Megalume · Ícones Animados"),
    "fx": ("megalume-efeitos-2d", "Megalume · Efeitos 2D"),
    "mao": ("megalume-desenhado-a-mao", "Megalume · Desenhado à Mão"),
    "texturas": ("megalume-texturas", "Megalume · Texturas"),
    "vertical": ("megalume-vertical", "Megalume · Vertical 9:16"),
}


def waveform_poster(st, path, pal):
    w, h = 1920, 1080
    im = Image.new("RGB", (w, h), (31, 31, 31))
    d = ImageDraw.Draw(im)
    mono = np.abs(st).max(axis=1)
    cols = np.array_split(mono, w // 6)
    mid = h / 2
    for i, c in enumerate(cols):
        a = float(c.max()) if len(c) else 0
        x = i * 6 + 3
        d.line([(x, mid - a * 360), (x, mid + a * 360)], fill=pal.primary, width=4)
    im.save(path)


def make_thumb(item_dir, item):
    """Miniatura pequena (480 px, JPG) para os cards do painel: leve para ler do NAS."""
    src = os.path.join(item_dir, item.get("poster") or "")
    if not item.get("poster") or not os.path.exists(src):
        return
    im = Image.open(src).convert("RGB")
    im.thumbnail((480, 270), Image.LANCZOS)
    im.save(os.path.join(item_dir, "thumb.jpg"), quality=82, optimize=True)
    item["thumb"] = "thumb.jpg"


def add_thumbs(out):
    """Atualiza uma saída já gerada: cria thumb.jpg e registra no item.json."""
    for d in sorted(os.listdir(out)):
        p = os.path.join(out, d, "item.json")
        if not os.path.exists(p):
            continue
        item = json.load(open(p))
        make_thumb(os.path.join(out, d), item)
        json.dump(item, open(p, "w"), ensure_ascii=False, indent=2)


def duration_of(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], capture_output=True, text=True, check=True)
    return round(float(out.stdout.strip()), 2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="saida")
    ap.add_argument("--primary", default="FFCC00")
    ap.add_argument("--dark", default="0A0A0A")
    ap.add_argument("--only", default="")
    ap.add_argument("--thumbs-only", action="store_true", help="só cria thumb.jpg numa saída já gerada")
    args = ap.parse_args()
    if args.thumbs_only:
        add_thumbs(args.out)
        return
    hexrgb = lambda s: tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))
    pal = V.Palette(primary=hexrgb(args.primary), dark=hexrgb(args.dark))
    only = set(filter(None, args.only.split(",")))
    os.makedirs(args.out, exist_ok=True)
    common = {"license": "megalume-internal", "language": None, "aspectRatio": "16:9", "origin": "Gerado por código (tools/content-generator), conteúdo original da Megalume"}

    for sid, (fn, name, summary, tags, syn) in sfx.RECIPES.items():
        if only and sid not in only:
            continue
        t0 = time.time()
        d = os.path.join(args.out, f"sfx-{sid}")
        os.makedirs(d, exist_ok=True)
        st = fn()
        main_file = f"{sid}.wav"
        sfx.write_wav(os.path.join(d, main_file), st)
        waveform_poster(st, os.path.join(d, "poster.png"), pal)
        item = {**common, "id": f"meg-sfx-{sid}", "name": name, "type": "sfx", "summary": summary, "tags": tags + ["som"], "synonyms": syn,
                "main": main_file, "role": "audio", "preview": main_file, "poster": "poster.png", "durationSec": round(len(st) / sfx.SR, 2), "pack": "sons", "aspectRatio": "any"}
        make_thumb(d, item)
        json.dump(item, open(os.path.join(d, "item.json"), "w"), ensure_ascii=False, indent=2)
        print(f"som    {name:34s} {time.time() - t0:5.1f}s")

    for (vid, name, typ, fn, kw, alpha, pt, summary, tags, syn, pack) in VIDEO_ITEMS:
        if only and vid not in only:
            continue
        t0 = time.time()
        d = os.path.join(args.out, vid)
        os.makedirs(d, exist_ok=True)
        ext = "mov" if alpha else "mp4"
        main_file = f"{vid}.{ext}"
        src = os.path.join(d, main_file)
        frames = fn(pal, **kw)
        V.encode(frames, src, alpha=alpha, src_size=V.render_size(fn))
        V.preview_and_poster(src, os.path.join(d, "preview.mp4"), os.path.join(d, "poster.png"), alpha, pt)
        item = {**common, "id": f"meg-{vid}", "name": name, "type": typ, "summary": summary, "tags": tags, "synonyms": syn,
                "main": main_file, "role": "media", "preview": "preview.mp4", "poster": "poster.png", "durationSec": duration_of(src),
                "fps": V.FPS, "alpha": alpha, "pack": pack}
        make_thumb(d, item)
        json.dump(item, open(os.path.join(d, "item.json"), "w"), ensure_ascii=False, indent=2)
        mb = os.path.getsize(src) / 1e6
        print(f"vídeo  {name:34s} {time.time() - t0:5.1f}s  {mb:6.1f} MB")

    for x in extra_items() + vertical_variants():
        if only and x["id"] not in only:
            continue
        t0 = time.time()
        V.set_size(*x["size"])
        d = os.path.join(args.out, x["id"])
        os.makedirs(d, exist_ok=True)
        ext = "mov" if x["alpha"] else "mp4"
        main_file = f"{x['id']}.{ext}"
        src = os.path.join(d, main_file)
        V.encode(x["fn"](pal, **x["kw"]), src, alpha=x["alpha"], src_size=V.render_size(x["fn"]))
        V.preview_and_poster(src, os.path.join(d, "preview.mp4"), os.path.join(d, "poster.png"), x["alpha"], x["pt"])
        item = {**common, "id": f"meg-{x['id']}", "name": x["name"], "type": x["type"], "summary": x["summary"], "tags": x["tags"], "synonyms": x["syn"],
                "main": main_file, "role": "media", "preview": "preview.mp4", "poster": "poster.png", "durationSec": duration_of(src),
                "fps": V.FPS, "alpha": x["alpha"], "pack": x["pack"], "aspectRatio": x["aspect"]}
        make_thumb(d, item)
        json.dump(item, open(os.path.join(d, "item.json"), "w"), ensure_ascii=False, indent=2)
        print(f"novo   {x['name']:44s} {time.time() - t0:5.1f}s  {os.path.getsize(src) / 1e6:6.1f} MB")
    V.set_size(*WIDE)

    for tid, name, fn, summary, tags, syn in TEXTURES:
        if only and tid not in only:
            continue
        V.set_size(*WIDE)
        d = os.path.join(args.out, tid)
        os.makedirs(d, exist_ok=True)
        fn(pal).save(os.path.join(d, f"{tid}.png"))
        item = {**common, "id": f"meg-{tid}", "name": name, "type": "texture", "summary": summary, "tags": tags, "synonyms": syn,
                "main": f"{tid}.png", "role": "media", "preview": f"{tid}.png", "poster": f"{tid}.png", "pack": "texturas", "aspectRatio": "any"}
        make_thumb(d, item)
        json.dump(item, open(os.path.join(d, "item.json"), "w"), ensure_ascii=False, indent=2)
        print(f"textura {name}")

    json.dump({k: {"slug": v[0], "name": v[1]} for k, v in PACKS.items()}, open(os.path.join(args.out, "packs.json"), "w"), ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
