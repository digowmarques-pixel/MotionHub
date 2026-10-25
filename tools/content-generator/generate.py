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
    ("fundo-gradiente-marca", "Fundo Gradiente Megalume", "media", V.gradient_fluid, {"warm": False}, False, 2, "Fundo em loop de 8 s: preto com brilhos amarelos, nas cores da marca.", ["fundo", "gradiente", "loop", "marca"], ["background", "bg", "amarelo"], "fundos"),
    ("fundo-gradiente-quente", "Fundo Gradiente Fluido Quente", "media", V.gradient_fluid, {"warm": True}, False, 2, "Fundo em loop de 8 s com gradiente laranja e vinho.", ["fundo", "gradiente", "loop"], ["background", "bg"], "fundos"),
    ("fundo-grade-tech", "Fundo Grade Tecnológica", "media", V.tech_grid, {}, False, 2, "Grade em perspectiva avançando, em loop de 6 s.", ["fundo", "tecnologia", "grade"], ["background", "grid"], "fundos"),
    ("fundo-particulas", "Fundo Partículas", "media", V.particles, {}, False, 2, "Partículas luminosas subindo sobre fundo escuro, em loop de 8 s.", ["fundo", "partículas", "loop"], ["background", "poeira"], "fundos"),
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

PACKS = {
    "sons": ("megalume-sons-essenciais", "Megalume · Sons Essenciais"),
    "overlays": ("megalume-overlays", "Megalume · Overlays de Luz e Textura"),
    "fundos": ("megalume-fundos", "Megalume · Fundos Animados"),
    "formas": ("megalume-formas", "Megalume · Formas e Destaques"),
    "transicoes": ("megalume-transicoes", "Megalume · Transições"),
    "contadores": ("megalume-contadores", "Megalume · Contadores"),
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


def duration_of(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], capture_output=True, text=True, check=True)
    return round(float(out.stdout.strip()), 2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="saida")
    ap.add_argument("--primary", default="FFCC00")
    ap.add_argument("--dark", default="0A0A0A")
    ap.add_argument("--only", default="")
    args = ap.parse_args()
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
                "main": main_file, "role": "audio", "preview": main_file, "poster": "poster.png", "durationSec": round(len(st) / sfx.SR, 2), "pack": "sons"}
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
        size = (480, 270) if fn is V.light_leak else (960, 540) if fn in (V.bokeh, V.particles) else (320, 180) if fn is V.gradient_fluid else (V.W, V.H)
        V.encode(frames, src, alpha=alpha, src_size=size)
        V.preview_and_poster(src, os.path.join(d, "preview.mp4"), os.path.join(d, "poster.png"), alpha, pt)
        item = {**common, "id": f"meg-{vid}", "name": name, "type": typ, "summary": summary, "tags": tags, "synonyms": syn,
                "main": main_file, "role": "media", "preview": "preview.mp4", "poster": "poster.png", "durationSec": duration_of(src),
                "fps": V.FPS, "alpha": alpha, "pack": pack}
        json.dump(item, open(os.path.join(d, "item.json"), "w"), ensure_ascii=False, indent=2)
        mb = os.path.getsize(src) / 1e6
        print(f"vídeo  {name:34s} {time.time() - t0:5.1f}s  {mb:6.1f} MB")

    json.dump({k: {"slug": v[0], "name": v[1]} for k, v in PACKS.items()}, open(os.path.join(args.out, "packs.json"), "w"), ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
