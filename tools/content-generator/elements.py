"""
Elementos animados originais: redes sociais, ícones, efeitos 2D, desenhado à mão,
texturas e transições extras. Todos desenhados por código (PIL), com transparência.
O tamanho do quadro vem de video.W/video.H (use video.set_size antes).
"""
import math
from functools import lru_cache

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

import video as V

SS = V.SS
rng = np.random.default_rng(777)
WHITE = (255, 255, 255)
GRAY = (60, 60, 60)


@lru_cache(maxsize=256)
def font(px):
    return ImageFont.truetype(V.FONT_BOLD, int(px))


def clamp(x, a=0.0, b=1.0):
    return min(max(x, a), b)


def canvas():
    return Image.new("RGBA", (V.W * SS, V.H * SS), (0, 0, 0, 0))


def finish(im, alpha=1.0):
    a = np.asarray(im.resize((V.W, V.H), Image.LANCZOS)).copy()
    if alpha < 1:
        a[..., 3] = (a[..., 3].astype(np.float32) * clamp(alpha)).astype(np.uint8)
    return a


def center():
    return V.W * SS / 2, V.H * SS / 2


def unit():
    """Meio do menor lado do quadro, em pixels supersampled."""
    return min(V.W, V.H) * SS / 2


def pop(t, total, tin=0.35, tout=0.3):
    """Escala e opacidade de entrada (com overshoot) e saída."""
    s_in = V.ease_out_back(t / tin) if t < tin else 1.0
    out = clamp((t - (total - tout)) / tout)
    return max(s_in, 0.0) * (1 - 0.6 * V.ease_in_out(out)), 1 - V.ease_in_out(out)


def frames(total):
    return [k / V.FPS for k in range(int(total * V.FPS))]


def burst(d, cx, cy, r, p, col, n=10, width=1.0):
    """Raios curtos saindo do centro (usado na entrada de ícones e cliques)."""
    if not 0 < p < 1:
        return
    for i in range(n):
        a = i * 2 * math.pi / n + 0.3
        r0 = r * (1.05 + 0.5 * V.ease_out_cubic(p))
        r1 = r * (1.05 + 0.5 * V.ease_out_cubic(max(0, p - 0.25) / 0.75))
        if r0 - r1 > 2:
            d.line([(cx + math.cos(a) * r1, cy + math.sin(a) * r1), (cx + math.cos(a) * r0, cy + math.sin(a) * r0)], fill=col + (255,), width=max(2, int(r * 0.06 * width)))


def text(d, xy, s, px, fill, anchor="mm"):
    if px < 2:
        return
    d.text(xy, s, font=font(max(2, int(px))), fill=fill, anchor=anchor)


# ======================= glifos =======================

def heart_pts(cx, cy, r):
    pts = []
    for i in range(60):
        t = i / 60 * 2 * math.pi
        x = 16 * math.sin(t) ** 3
        y = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
        pts.append((cx + x / 17 * r, cy - y / 17 * r - r * 0.05))
    return pts


def star_pts(cx, cy, r, rot=0.0, n=5, inner=0.45):
    pts = []
    for i in range(n * 2):
        a = -math.pi / 2 + i * math.pi / n + rot
        rr = r if i % 2 == 0 else r * inner
        pts.append((cx + math.cos(a) * rr, cy + math.sin(a) * rr))
    return pts


def partial_polyline(pts, k):
    """Primeira fração k (0..1) de uma polilinha, para efeito de 'desenhar'."""
    if k <= 0:
        return []
    segs = [math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1)]
    total, acc, out = sum(segs) * clamp(k), 0.0, [pts[0]]
    for i, L in enumerate(segs):
        if acc + L >= total:
            f = (total - acc) / L if L else 0
            out.append((pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f))
            return out
        out.append(pts[i + 1])
        acc += L
    return out


def g_check(d, cx, cy, r, col, k):
    pts = partial_polyline([(cx - r * 0.45, cy + r * 0.02), (cx - r * 0.12, cy + r * 0.35), (cx + r * 0.5, cy - r * 0.35)], k)
    if len(pts) > 1:
        d.line(pts, fill=col, width=int(r * 0.16), joint="curve")


def g_x(d, cx, cy, r, col, k):
    a = r * 0.38
    for i, (p0, p1) in enumerate([((cx - a, cy - a), (cx + a, cy + a)), ((cx + a, cy - a), (cx - a, cy + a))]):
        kk = clamp(k * 2 - i)
        if kk > 0:
            d.line([p0, (p0[0] + (p1[0] - p0[0]) * kk, p0[1] + (p1[1] - p0[1]) * kk)], fill=col, width=int(r * 0.16))


def g_heart(d, cx, cy, r, col, k):
    s = 0.62 * (1 + 0.12 * math.sin(k * math.pi * 4) * (1 - k))
    d.polygon(heart_pts(cx, cy, r * s), fill=col)


def g_star(d, cx, cy, r, col, k):
    d.polygon(star_pts(cx, cy, r * 0.62, rot=(1 - V.ease_out_cubic(k)) * math.pi * 0.8), fill=col)


def g_arrow(d, cx, cy, r, col, k, angle=0.0):
    off = (1 - V.ease_out_cubic(k)) * -r * 0.5
    pts = [(-0.5, -0.12), (0.1, -0.12), (0.1, -0.36), (0.55, 0), (0.1, 0.36), (0.1, 0.12), (-0.5, 0.12)]
    ca, sa = math.cos(angle), math.sin(angle)
    out = []
    for x, y in pts:
        x = x * r + off
        y = y * r
        out.append((cx + x * ca - y * sa, cy + x * sa + y * ca))
    d.polygon(out, fill=col)


def g_play(d, cx, cy, r, col, k):
    s = 0.5 * (0.7 + 0.3 * V.ease_out_back(k))
    d.polygon([(cx - r * s * 0.7, cy - r * s), (cx + r * s, cy), (cx - r * s * 0.7, cy + r * s)], fill=col)


def g_plus(d, cx, cy, r, col, k):
    a = r * 0.42 * V.ease_out_back(k)
    w = int(r * 0.17)
    d.line([(cx - a, cy), (cx + a, cy)], fill=col, width=w)
    d.line([(cx, cy - a), (cx, cy + a)], fill=col, width=w)


def g_alert(d, cx, cy, r, col, k):
    text(d, (cx, cy + r * 0.02), "!", r * 1.1, col)


def g_dollar(d, cx, cy, r, col, k):
    text(d, (cx, cy + r * 0.02), "$", r * 1.0, col)


def g_clock(d, cx, cy, r, col, k):
    rr = r * 0.55
    d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], outline=col, width=int(r * 0.1))
    for ang, L in ((k * 4 * math.pi - math.pi / 2, 0.42), (k * 0.6 * math.pi - math.pi / 2, 0.28)):
        d.line([(cx, cy), (cx + math.cos(ang) * r * L, cy + math.sin(ang) * r * L)], fill=col, width=int(r * 0.09))


def g_bolt(d, cx, cy, r, col, k):
    pts = [(0.12, -0.62), (-0.32, 0.08), (-0.02, 0.08), (-0.14, 0.62), (0.32, -0.12), (0.02, -0.12)]
    d.polygon([(cx + x * r, cy + y * r) for x, y in pts], fill=col)


def g_mail(d, cx, cy, r, col, k):
    w, h = r * 0.62, r * 0.42
    d.rectangle([cx - w, cy - h, cx + w, cy + h], outline=col, width=int(r * 0.09))
    open_ = math.sin(k * math.pi) * 0.25
    d.line([(cx - w, cy - h), (cx, cy + h * (0.15 - open_)), (cx + w, cy - h)], fill=col, width=int(r * 0.09), joint="curve")


def g_pin(d, cx, cy, r, col, k):
    rr = r * 0.36
    py = cy - r * 0.16 - math.sin(k * math.pi) * r * 0.12
    d.polygon([(cx - rr * 0.92, py + rr * 0.35), (cx, py + r * 0.68), (cx + rr * 0.92, py + rr * 0.35)], fill=col)
    d.ellipse([cx - rr, py - rr, cx + rr, py + rr], fill=col)
    return py, rr


def g_bell(d, cx, cy, r, col, k, swing=0.0):
    """Sino desenhado em coordenadas rotacionadas pelo balanço."""
    ca, sa = math.cos(swing), math.sin(swing)
    top = (cx, cy - r * 0.62)

    def tr(x, y):
        x, y = x * r, y * r
        return (top[0] + x * ca - y * sa, top[1] + x * sa + y * ca)

    body = [tr(-0.42, 1.0), tr(-0.36, 0.55), tr(-0.3, 0.3), tr(-0.18, 0.14), tr(0, 0.1), tr(0.18, 0.14), tr(0.3, 0.3), tr(0.36, 0.55), tr(0.42, 1.0)]
    d.polygon(body, fill=col)
    d.line([tr(-0.55, 1.02), tr(0.55, 1.02)], fill=col, width=int(r * 0.12))
    c = tr(0, 1.16)
    d.ellipse([c[0] - r * 0.1, c[1] - r * 0.1, c[0] + r * 0.1, c[1] + r * 0.1], fill=col)
    k0 = tr(0, 0.04)
    d.ellipse([k0[0] - r * 0.07, k0[1] - r * 0.07, k0[0] + r * 0.07, k0[1] + r * 0.07], fill=col)


def g_share(d, cx, cy, r, col, k):
    nodes = [(cx + r * 0.32, cy - r * 0.34), (cx - r * 0.34, cy), (cx + r * 0.32, cy + r * 0.34)]
    w = int(r * 0.08)
    d.line([nodes[0], nodes[1], nodes[2]], fill=col, width=w)
    for x, y in nodes:
        rr = r * 0.14
        d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=col)


# ======================= ícones animados =======================

def icon_anim(pal, glyph, seconds=2.4, badge="circle", glyph_kw=None):
    cx, cy = center()
    R = unit() * 0.42
    for t in frames(seconds):
        s, a = pop(t, seconds)
        k = clamp((t - 0.15) / 0.6)
        bob = 1 + 0.025 * math.sin(2 * math.pi * 1.2 * t)
        r = R * s * bob
        im = canvas()
        d = ImageDraw.Draw(im)
        burst(d, cx, cy, R, clamp((t - 0.05) / 0.5), pal.primary)
        if r > 2:
            if badge == "circle":
                d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=pal.primary + (255,))
            elif badge == "triangle":
                d.polygon([(cx, cy - r * 1.05), (cx + r * 1.1, cy + r * 0.85), (cx - r * 1.1, cy + r * 0.85)], fill=pal.primary + (255,))
            glyph(d, cx, cy + (r * 0.12 if badge == "triangle" else 0), r, pal.dark + (255,), k, **(glyph_kw or {}))
        yield finish(im, a)


def pin_anim(pal, seconds=2.4):
    """Localização: pino amarelo com furo, quicando, e sombra."""
    cx, cy = center()
    R = unit() * 0.42
    for t in frames(seconds):
        s, a = pop(t, seconds)
        k = (t * 1.4) % 1
        im = canvas()
        d = ImageDraw.Draw(im)
        r = R * s * 1.6
        if r > 2:
            sh = r * (0.5 - 0.15 * math.sin(k * math.pi))
            d.ellipse([cx - sh, cy + r * 0.62, cx + sh, cy + r * 0.72], fill=(0, 0, 0, 90))
            py, rr = g_pin(d, cx, cy, r, pal.primary + (255,), k)
            h = rr * 0.42
            d.ellipse([cx - h, py - h, cx + h, py + h], fill=pal.dark + (255,))
        yield finish(im, a)


# ======================= redes sociais =======================

CURSOR = [(0, 0), (0, 17), (4.2, 13.2), (7, 19.6), (9.4, 18.6), (6.6, 12.2), (12.2, 12.2)]


def draw_cursor(d, x, y, size, press):
    s = size * (0.85 if press else 1)
    pts = [(x + px * s, y + py * s) for px, py in CURSOR]
    d.polygon(pts, fill=(255, 255, 255, 255), outline=(10, 10, 10, 255))
    d.line(pts + [pts[0]], fill=(10, 10, 10, 255), width=max(2, int(s * 0.9)))


def button_click(pal, before, after, glyph_before, glyph_after=None, seconds=3.2):
    """Botão que recebe um clique do cursor e muda de estado (curtir, inscrever-se, seguir)."""
    cx, cy = center()
    U = unit()
    bw, bh = U * 1.25, U * 0.34
    click_t = 1.25
    for t in frames(seconds):
        s, a = pop(t, seconds)
        clicked = t >= click_t
        press = click_t - 0.08 <= t < click_t + 0.06
        im = canvas()
        d = ImageDraw.Draw(im)
        # Largura do botão acompanha o texto mais longo (antes/depois do clique).
        need = max(font(bh * 0.36).getlength(before), font(bh * 0.36).getlength(after)) + bh * 1.35
        base_w = max(bw, need)
        w, h = base_w * s * (0.96 if press else 1), bh * s * (0.96 if press else 1)
        if w > 4:
            fill = pal.primary if clicked else pal.dark
            fg = pal.dark if clicked else WHITE
            d.rounded_rectangle([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], radius=h / 2, fill=fill + (255,), outline=pal.primary + (255,), width=int(U * 0.018))
            label = after if clicked else before
            ir = h * 0.3
            ix = cx - w / 2 + h * 0.62
            g = (glyph_after or glyph_before) if clicked else glyph_before
            gk = clamp((t - click_t) / 0.4) if clicked else 1.0
            g(d, ix, cy, ir * 1.6, fg + (255,), gk)
            text(d, (cx + h * 0.28, cy + h * 0.02), label, h * 0.36 * s if s < 1 else h * 0.36, fg + (255,))
            burst(d, cx, cy, h * 0.9, clamp((t - click_t) / 0.45), pal.primary, n=12, width=0.6)
        # cursor entra, clica e sai
        ent = V.ease_out_cubic(clamp((t - 0.45) / 0.7))
        ext = V.ease_in_out(clamp((t - (click_t + 0.45)) / 0.5))
        if 0 < ent and ext < 1:
            tx, ty = cx + base_w * 0.22, cy + bh * 0.1
            x = tx + (1 - ent) * U * 0.6 + ext * U * 0.4
            y = ty + (1 - ent) * U * 0.6 + ext * U * 0.5
            draw_cursor(d, x, y, U * 0.0085, press)
        yield finish(im, a)


def bell_notify(pal, seconds=2.6):
    cx, cy = center()
    R = unit() * 0.42
    for t in frames(seconds):
        s, a = pop(t, seconds)
        sw = math.sin(t * 2 * math.pi * 2.2) * 0.45 * math.exp(-max(0, t - 0.3) * 1.6) if t > 0.3 else 0
        im = canvas()
        d = ImageDraw.Draw(im)
        r = R * s
        if r > 2:
            g_bell(d, cx, cy, r, pal.primary + (255,), 0, swing=sw)
            bs = V.ease_out_back(clamp((t - 0.55) / 0.3)) * r * 0.32
            if bs > 1:
                bx, by = cx + r * 0.45, cy - r * 0.45
                d.ellipse([bx - bs, by - bs, bx + bs, by + bs], fill=WHITE + (255,))
                text(d, (bx, by + bs * 0.05), "1", bs * 1.3, pal.dark + (255,))
            # ondas de "toque"
            for i in range(2):
                p = clamp((t - 0.35 - i * 0.12) / 0.6)
                if 0 < p < 1:
                    for sgn in (-1, 1):
                        rr = r * (0.9 + 0.35 * p)
                        d.arc([cx - rr, cy - rr, cx + rr, cy + rr], start=(-60 if sgn > 0 else 200), end=(-20 if sgn > 0 else 240), fill=pal.primary + (int(255 * (1 - p)),), width=int(r * 0.07))
        yield finish(im, a)


def progress_bar(pal, seconds=5.0):
    cx, cy = center()
    U = unit()
    bw, bh = U * 1.6, U * 0.07
    for t in frames(seconds):
        s, a = pop(t, seconds, tin=0.3, tout=0.35)
        p = V.ease_in_out(clamp((t - 0.35) / (seconds - 1.0)))
        im = canvas()
        d = ImageDraw.Draw(im)
        w = bw * min(s, 1.0)
        d.rounded_rectangle([cx - w / 2, cy - bh / 2, cx + w / 2, cy + bh / 2], radius=bh / 2, fill=(255, 255, 255, 60))
        if p > 0.01:
            d.rounded_rectangle([cx - w / 2, cy - bh / 2, cx - w / 2 + w * p, cy + bh / 2], radius=bh / 2, fill=pal.primary + (255,))
        text(d, (cx - w / 2 + w * p, cy - bh * 1.6), f"{int(p * 100)}%", U * 0.12, WHITE + (255,))
        yield finish(im, a)


def swipe_up(pal, seconds=3.0):
    cx, cy = center()
    U = unit()
    for t in frames(seconds):
        s, a = pop(t, seconds)
        im = canvas()
        d = ImageDraw.Draw(im)
        for i in range(3):
            ph = ((t * 1.6) - i * 0.18) % 1
            y = cy + U * 0.1 - ph * U * 0.35 - i * U * 0.02
            al = int(255 * math.sin(ph * math.pi) * a)
            w = U * 0.22 * s
            d.line([(cx - w, y + w * 0.55), (cx, y), (cx + w, y + w * 0.55)], fill=pal.primary + (al,), width=int(U * 0.05), joint="curve")
        text(d, (cx, cy + U * 0.45), "ARRASTE PARA CIMA", U * 0.11 * min(s, 1), WHITE + (255,))
        yield finish(im, a)


def link_bio(pal, seconds=3.0):
    cx, cy = center()
    U = unit()
    for t in frames(seconds):
        s, a = pop(t, seconds)
        im = canvas()
        d = ImageDraw.Draw(im)
        w, h = U * 1.0 * s, U * 0.28 * s
        if w > 4:
            d.rounded_rectangle([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], radius=h / 2, fill=pal.primary + (255,))
            text(d, (cx, cy + h * 0.03), "LINK NA BIO", h * 0.42, pal.dark + (255,))
            by = cy + h * 0.95 + abs(math.sin(t * math.pi * 2)) * U * 0.08
            aw = U * 0.09
            d.polygon([(cx - aw, by), (cx + aw, by), (cx, by + aw * 1.2)], fill=WHITE + (255,))
        yield finish(im, a)


def comment_bubble(pal, seconds=3.0):
    cx, cy = center()
    U = unit()
    for t in frames(seconds):
        s, a = pop(t, seconds)
        im = canvas()
        d = ImageDraw.Draw(im)
        w, h = U * 0.9 * s, U * 0.5 * s
        if w > 4:
            d.rounded_rectangle([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], radius=h * 0.35, fill=WHITE + (255,))
            d.polygon([(cx - w * 0.28, cy + h * 0.45), (cx - w * 0.38, cy + h * 0.78), (cx - w * 0.1, cy + h * 0.48)], fill=WHITE + (255,))
            for i in range(3):
                ph = math.sin((t * 3 - i * 0.25) * math.pi)
                r = h * 0.09 * (1 + 0.35 * max(0, ph))
                x = cx + (i - 1) * h * 0.38
                d.ellipse([x - r, cy - r - max(0, ph) * h * 0.06, x + r, cy + r - max(0, ph) * h * 0.06], fill=pal.dark + (255,))
        yield finish(im, a)


def follower_counter(pal, seconds=3.4, target=10000):
    cx, cy = center()
    U = unit()
    for t in frames(seconds):
        s, a = pop(t, seconds)
        p = V.ease_out_cubic(clamp((t - 0.3) / 1.8))
        n = int(target * p)
        label = f"{n / 1000:.1f}K".replace(".0K", "K").replace(".", ",") if n >= 1000 else str(n)
        im = canvas()
        d = ImageDraw.Draw(im)
        if s > 0.05:
            text(d, (cx, cy - U * 0.08), label, U * 0.42 * min(s, 1.1), pal.primary + (255,))
            text(d, (cx, cy + U * 0.3), "SEGUIDORES", U * 0.1 * min(s, 1), WHITE + (255,))
        yield finish(im, a)


# ======================= efeitos 2D =======================

def sparks(pal, seconds=1.6, n=40):
    cx, cy = center()
    U = unit()
    ang = rng.uniform(0, 2 * math.pi, n)
    spd = rng.uniform(0.6, 1.4, n) * U * 1.6
    life = rng.uniform(0.5, 1.2, n)
    cols = [pal.primary, WHITE, pal.accent]
    for t in frames(seconds):
        im = canvas()
        d = ImageDraw.Draw(im)
        for i in range(n):
            if t > life[i]:
                continue
            p = t / life[i]
            dist = spd[i] * (1 - (1 - min(t, life[i])) ** 2) * 0.6
            x = cx + math.cos(ang[i]) * dist
            y = cy + math.sin(ang[i]) * dist + U * 0.25 * t * t
            L = U * 0.14 * (1 - p * 0.6)
            d.line([(x, y), (x - math.cos(ang[i]) * L, y - math.sin(ang[i]) * L + U * 0.02 * t)], fill=cols[i % 3] + (int(255 * (1 - p ** 2)),), width=max(3, int(U * 0.022 * (1 - p * 0.5))))
        glow = im.filter(ImageFilter.GaussianBlur(6 * SS))
        yield finish(Image.alpha_composite(glow, im))


def glint(pal, seconds=1.2):
    cx, cy = center()
    U = unit()
    extras = [(rng.uniform(-0.5, 0.5), rng.uniform(-0.5, 0.5), rng.uniform(0.2, 0.5), rng.uniform(0.1, 0.5)) for _ in range(3)]
    for t in frames(seconds):
        im = canvas()
        d = ImageDraw.Draw(im)
        for ox, oy, sc, delay in [(0, 0, 1.0, 0.0)] + extras:
            p = clamp((t - delay) / 0.7)
            if not 0 < p < 1:
                continue
            s = math.sin(p * math.pi) * U * 0.55 * sc
            x, y = cx + ox * U, cy + oy * U
            rot = p * math.pi / 4
            for k in range(2):
                a = rot + k * math.pi / 2
                ca, sa = math.cos(a), math.sin(a)
                pts = [(x + ca * s, y + sa * s), (x - sa * s * 0.08, y + ca * s * 0.08), (x - ca * s, y - sa * s), (x + sa * s * 0.08, y - ca * s * 0.08)]
                d.polygon(pts, fill=WHITE + (255,))
            g = s * 0.18
            d.ellipse([x - g, y - g, x + g, y + g], fill=pal.primary + (200,))
        glow = im.filter(ImageFilter.GaussianBlur(8 * SS))
        yield finish(Image.alpha_composite(glow, im))


def speed_lines(pal, seconds=2.0, n=90):
    cx, cy = center()
    R = math.hypot(V.W, V.H) * SS / 2
    for k, t in enumerate(frames(seconds)):
        if k % 2 == 0:
            im = canvas()
            d = ImageDraw.Draw(im)
            for _ in range(n):
                a = rng.uniform(0, 2 * math.pi)
                r0 = R * rng.uniform(0.45, 0.8)
                w = rng.uniform(0.004, 0.018)
                pts = [(cx + math.cos(a - w) * R, cy + math.sin(a - w) * R), (cx + math.cos(a) * r0, cy + math.sin(a) * r0), (cx + math.cos(a + w) * R, cy + math.sin(a + w) * R)]
                d.polygon(pts, fill=WHITE + (int(rng.uniform(150, 240)),))
            last = finish(im, min(1, t / 0.15, (seconds - t) / 0.2))
        yield last


def shockwave(pal, seconds=1.2):
    cx, cy = center()
    U = unit()
    for t in frames(seconds):
        im = canvas()
        d = ImageDraw.Draw(im)
        f = clamp(1 - t / 0.25)
        if f > 0:
            r = U * 0.25 * (1 + t)
            d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=pal.primary + (int(200 * f),))
        for i, delay in enumerate((0.0, 0.1, 0.22)):
            p = clamp((t - delay) / 0.9)
            if 0 < p < 1:
                r = U * (0.15 + 0.95 * V.ease_out_cubic(p))
                w = max(2, int(U * 0.08 * (1 - p)))
                col = WHITE if i == 1 else pal.primary
                d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=col + (int(255 * (1 - p)),), width=w)
        yield finish(im)


def confetti(pal, seconds=4.0, n=140):
    cols = [pal.primary, WHITE, pal.accent, (255, 230, 120)]
    W2, H2 = V.W * SS, V.H * SS
    xs = rng.uniform(0, W2, n)
    ys = rng.uniform(-H2 * 0.6, -H2 * 0.02, n)
    vy = rng.uniform(0.18, 0.32, n) * H2
    sway = rng.uniform(0.5, 2.0, n)
    rot = rng.uniform(0, 6.28, n)
    size = rng.uniform(0.008, 0.016, n) * min(W2, H2)
    for t in frames(seconds):
        im = canvas()
        d = ImageDraw.Draw(im)
        for i in range(n):
            y = ys[i] + vy[i] * t
            if y > H2 + 50:
                continue
            x = xs[i] + math.sin(t * sway[i] * 2 + rot[i]) * size[i] * 3
            a = rot[i] + t * sway[i] * 3
            flip = abs(math.cos(t * sway[i] * 4 + rot[i]))
            w, h = size[i] * flip + 1, size[i] * 0.55
            ca, sa = math.cos(a), math.sin(a)
            pts = [(x + ca * dx - sa * dy, y + sa * dx + ca * dy) for dx, dy in ((-w, -h), (w, -h), (w, h), (-w, h))]
            d.polygon(pts, fill=cols[i % 4] + (255,))
        yield finish(im, min(1, (seconds - t) / 0.4))


def cartoon_explosion(pal, seconds=1.4):
    cx, cy = center()
    U = unit()
    puffs = [(rng.uniform(0, 6.28), rng.uniform(0.35, 0.75), rng.uniform(0.12, 0.22)) for _ in range(12)]
    for t in frames(seconds):
        im = canvas()
        d = ImageDraw.Draw(im)
        p = clamp(t / 0.28)
        if t < 0.45:
            s = V.ease_out_back(p) * U * 0.8 * (1 - clamp((t - 0.3) / 0.15))
            if s > 2:
                d.polygon(star_pts(cx, cy, s, rot=0.2, n=12, inner=0.62), fill=pal.accent + (255,))
                d.polygon(star_pts(cx, cy, s * 0.72, rot=0.45, n=10, inner=0.6), fill=pal.primary + (255,))
                d.ellipse([cx - s * 0.3, cy - s * 0.3, cx + s * 0.3, cy + s * 0.3], fill=WHITE + (255,))
        q = clamp((t - 0.25) / (seconds - 0.25))
        if q > 0:
            for ang, dist, rr in puffs:
                r = U * rr * (0.6 + 0.8 * q)
                x = cx + math.cos(ang) * U * dist * (0.5 + q)
                y = cy + math.sin(ang) * U * dist * (0.5 + q) - U * 0.15 * q
                d.ellipse([x - r, y - r, x + r, y + r], fill=(200, 200, 200, int(220 * (1 - q))))
        yield finish(im)


def smoke_puff(pal, seconds=1.8):
    cx, cy = center()
    U = unit()
    blobs = [(rng.uniform(0, 6.28), rng.uniform(0.05, 0.35), rng.uniform(0.15, 0.28), rng.uniform(0.75, 0.95)) for _ in range(14)]
    for t in frames(seconds):
        q = clamp(t / seconds)
        im = canvas()
        d = ImageDraw.Draw(im)
        for ang, dist, rr, shade in blobs:
            r = U * rr * (0.4 + 0.9 * V.ease_out_cubic(q))
            x = cx + math.cos(ang) * U * dist * (0.6 + q)
            y = cy + math.sin(ang) * U * dist * (0.6 + q) - U * 0.25 * q
            c = int(255 * shade)
            d.ellipse([x - r, y - r, x + r, y + r], fill=(c, c, c, int(230 * (1 - q) ** 1.3)))
        yield finish(im.filter(ImageFilter.GaussianBlur(3 * SS)))


def lightning(pal, seconds=0.9):
    cx, cy = center()
    H2, W2 = V.H * SS, V.W * SS

    def bolt():
        pts = [(cx + rng.uniform(-0.1, 0.1) * W2, 0.0), (cx + rng.uniform(-0.1, 0.1) * W2, float(H2))]
        for _ in range(6):
            new = [pts[0]]
            for a, b in zip(pts, pts[1:]):
                mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
                off = (b[1] - a[1]) * 0.25 * rng.uniform(-1, 1)
                new += [(mx + off, my), b]
            pts = new
        return pts

    shape = bolt()
    for k, t in enumerate(frames(seconds)):
        on = (k // 2) % 3 != 2 and t < seconds * 0.75
        if k % 6 == 0:
            shape = bolt()
        im = canvas()
        if on:
            d = ImageDraw.Draw(im)
            d.line(shape, fill=pal.primary + (255,), width=int(18 * SS))
            glow = im.filter(ImageFilter.GaussianBlur(20 * SS))
            im = Image.alpha_composite(glow, im)
            d = ImageDraw.Draw(im)
            d.line(shape, fill=WHITE + (255,), width=int(6 * SS))
        yield finish(im)


# ======================= desenhado à mão =======================

def jitter(pts, seed, amount):
    r = np.random.default_rng(seed)
    return [(x + r.normal(0, amount), y + r.normal(0, amount)) for x, y in pts]


def hand_anim(pal, path_fn, seconds=2.5, draw_time=0.6, width=0.035, color=None, extra=None):
    """Traço que se desenha e depois 'ferve' (redesenho com tremor a cada 3 quadros), como animação à mão."""
    U = unit()
    col = (color or pal.primary) + (255,)
    for k, t in enumerate(frames(seconds)):
        prog = V.ease_in_out(clamp(t / draw_time))
        fade = 1 - V.ease_in_out(clamp((t - (seconds - 0.3)) / 0.3))
        im = canvas()
        d = ImageDraw.Draw(im)
        seed = k // 3
        for stroke in path_fn(U, t):
            pts = jitter(stroke, seed + len(stroke), U * 0.004)
            part = partial_polyline(pts, prog)
            if len(part) > 1:
                d.line(part, fill=col, width=int(U * width), joint="curve")
        if extra:
            extra(d, U, t, prog, seed)
        yield finish(im, fade)


def p_circle(U, t):
    cx, cy = center()
    pts = []
    for i in range(140):
        a = -2.2 + i / 139 * 2 * math.pi * 1.15
        r = 1 + 0.06 * math.sin(a * 3)
        pts.append((cx + math.cos(a) * U * 0.72 * r, cy + math.sin(a) * U * 0.42 * r))
    return [pts]


def p_arrow(U, t):
    cx, cy = center()
    curve = []
    for i in range(60):
        s = i / 59
        x = cx - U * 0.7 + s * U * 1.3
        y = cy + U * 0.35 - math.sin(s * math.pi * 0.9) * U * 0.55 + s * -U * 0.1
        curve.append((x, y))
    hx, hy = curve[-1]
    return [curve, [(hx - U * 0.22, hy - U * 0.02), (hx, hy), (hx - U * 0.08, hy + U * 0.2)]]


def p_wavy(U, t):
    cx, cy = center()
    return [[(cx - U * 0.8 + i / 80 * U * 1.6, cy + math.sin(i / 80 * math.pi * 6) * U * 0.05) for i in range(81)]]


def p_strike(U, t):
    cx, cy = center()
    return [[(cx - U * 0.75, cy + U * 0.05), (cx + U * 0.75, cy - U * 0.08)], [(cx - U * 0.7, cy + U * 0.14), (cx + U * 0.72, cy + U * 0.02)]]


def p_check(U, t):
    cx, cy = center()
    return [[(cx - U * 0.45, cy), (cx - U * 0.12, cy + U * 0.32), (cx + U * 0.55, cy - U * 0.45)]]


def p_star(U, t):
    cx, cy = center()
    pts = []
    for i in range(6):
        a = -math.pi / 2 + i * 4 * math.pi / 5
        pts.append((cx + math.cos(a) * U * 0.6, cy + math.sin(a) * U * 0.6))
    return [pts]


def p_emphasis(U, t):
    cx, cy = center()
    out = []
    for i in range(8):
        a = i * math.pi / 4 + 0.2
        out.append([(cx + math.cos(a) * U * 0.32, cy + math.sin(a) * U * 0.32), (cx + math.cos(a) * U * 0.62, cy + math.sin(a) * U * 0.62)])
    return out


def highlighter(pal, seconds=2.5):
    """Marca-texto: faixa translúcida que cresce da esquerda para a direita."""
    cx, cy = center()
    U = unit()
    for k, t in enumerate(frames(seconds)):
        p = V.ease_out_cubic(clamp(t / 0.6))
        fade = 1 - V.ease_in_out(clamp((t - (seconds - 0.3)) / 0.3))
        im = canvas()
        d = ImageDraw.Draw(im)
        r = np.random.default_rng(k // 3)
        x0, x1 = cx - U * 0.8, cx - U * 0.8 + U * 1.6 * p
        h = U * 0.16
        if x1 - x0 > 4:
            top = [(x, cy - h / 2 + r.normal(0, U * 0.006)) for x in np.linspace(x0, x1, 20)]
            bot = [(x, cy + h / 2 + r.normal(0, U * 0.006)) for x in np.linspace(x1, x0, 20)]
            d.polygon(top + bot, fill=pal.primary + (150,))
        yield finish(im, fade)


# ======================= texturas (imagens fixas) =======================

def tex_paper(pal):
    g = rng.normal(0, 1, (V.H // 4, V.W // 4)).astype(np.float32)
    low = np.asarray(Image.fromarray(((g - g.min()) / np.ptp(g) * 255).astype(np.uint8)).resize((V.W, V.H), Image.BICUBIC).filter(ImageFilter.GaussianBlur(6)), np.float32)
    fine = rng.normal(0, 6, (V.H, V.W))
    base = np.array([238, 232, 220], np.float32)
    img = base[None, None] + ((low - 128) * 0.12 + fine)[..., None]
    im = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(im)
    for _ in range(900):
        x, y = rng.uniform(0, V.W), rng.uniform(0, V.H)
        a = rng.uniform(0, 6.28)
        L = rng.uniform(4, 22)
        c = int(rng.uniform(200, 225))
        d.line([(x, y), (x + math.cos(a) * L, y + math.sin(a) * L)], fill=(c, c - 4, c - 12), width=1)
    return im


def tex_grunge(pal):
    a = np.zeros((V.H, V.W), np.float32)
    for scale, wgt in ((64, 0.6), (16, 0.3), (4, 0.1)):
        g = rng.normal(0, 1, (V.H // scale + 1, V.W // scale + 1)).astype(np.float32)
        up = np.asarray(Image.fromarray(((g - g.min()) / np.ptp(g) * 255).astype(np.uint8)).resize((V.W, V.H), Image.BICUBIC), np.float32) / 255
        a += up * wgt
    mask = np.clip((a - 0.55) * 4, 0, 1) * 200
    rgba = np.zeros((V.H, V.W, 4), np.uint8)
    rgba[..., 3] = mask.astype(np.uint8)
    return Image.fromarray(rgba, "RGBA")


def tex_halftone(pal):
    im = Image.new("RGBA", (V.W, V.H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    step = 24
    for y in range(0, V.H + step, step):
        for x in range(0, V.W + step, step):
            off = step / 2 if (y // step) % 2 else 0
            r = (x / V.W) * step * 0.48
            if r > 0.6:
                d.ellipse([x + off - r, y - r, x + off + r, y + r], fill=(0, 0, 0, 255))
    return im


def tex_scanlines(pal):
    a = np.zeros((V.H, V.W, 4), np.uint8)
    a[::4, :, 3] = 110
    a[1::4, :, 3] = 50
    return Image.fromarray(a, "RGBA")


def tex_vignette(pal):
    yy, xx = np.mgrid[0:V.H, 0:V.W].astype(np.float32)
    d = np.sqrt(((xx - V.W / 2) / (V.W / 2)) ** 2 + ((yy - V.H / 2) / (V.H / 2)) ** 2)
    a = np.clip((d - 0.55) / 0.75, 0, 1) ** 1.6 * 235
    rgba = np.zeros((V.H, V.W, 4), np.uint8)
    rgba[..., 3] = a.astype(np.uint8)
    return Image.fromarray(rgba, "RGBA")


# ======================= transições extras (tela cheia) =======================

def slide_panels(pal, seconds=1.0):
    W2, H2 = V.W * SS, V.H * SS
    for t in frames(seconds):
        p = t / seconds
        im = canvas()
        d = ImageDraw.Draw(im)
        for col, delay in ((pal.primary, 0.0), (pal.dark, 0.1)):
            q = clamp((p - delay) / 0.9)
            lead = V.ease_in_out(clamp(q / 0.5)) * W2
            trail = V.ease_in_out(clamp((q - 0.5) / 0.5)) * W2
            if lead > trail:
                d.rectangle([trail, 0, lead, H2], fill=col + (255,))
        yield finish(im)


def stripes(pal, seconds=1.0, n=8):
    W2, H2 = V.W * SS, V.H * SS
    bh = H2 / n
    for t in frames(seconds):
        p = t / seconds
        im = canvas()
        d = ImageDraw.Draw(im)
        for i in range(n):
            delay = i * 0.04
            q = clamp((p - delay) / (1 - 0.04 * n))
            lead = V.ease_in_out(clamp(q / 0.5)) * W2
            trail = V.ease_in_out(clamp((q - 0.5) / 0.5)) * W2
            if lead > trail:
                col = pal.primary if i % 2 == 0 else pal.dark
                d.rectangle([trail, i * bh, lead, (i + 1) * bh + 1], fill=col + (255,))
        yield finish(im)


def tiles(pal, seconds=1.0, cols=12):
    W2, H2 = V.W * SS, V.H * SS
    size = W2 / cols
    rows = int(math.ceil(H2 / size))
    for t in frames(seconds):
        p = t / seconds
        im = canvas()
        d = ImageDraw.Draw(im)
        for r in range(rows):
            for c in range(cols):
                delay = (r + c) / (rows + cols) * 0.35
                q = clamp((p - delay) / 0.65)
                s = V.ease_in_out(clamp(q / 0.5)) * (1 - V.ease_in_out(clamp((q - 0.5) / 0.5)))
                if s > 0.01:
                    hs = size / 2 * s * 1.02
                    x, y = c * size + size / 2, r * size + size / 2
                    col = pal.primary if (r + c) % 2 == 0 else pal.dark
                    d.rectangle([x - hs, y - hs, x + hs, y + hs], fill=col + (255,))
        yield finish(im)


def light_streak(pal, seconds=0.8):
    W2, H2 = V.W * SS, V.H * SS
    for t in frames(seconds):
        p = t / seconds
        im = canvas()
        d = ImageDraw.Draw(im)
        x = -W2 * 0.3 + p * W2 * 1.6
        for w, al, col in ((W2 * 0.35, 90, pal.primary), (W2 * 0.12, 200, WHITE)):
            d.polygon([(x - w, 0), (x + w * 0.3, 0), (x + w, H2), (x - w * 0.3, H2)], fill=col + (al,))
        im = im.filter(ImageFilter.GaussianBlur(40 * SS))
        flash = math.sin(p * math.pi) ** 4
        if flash > 0.01:
            over = Image.new("RGBA", im.size, (255, 255, 255, int(200 * flash)))
            im = Image.alpha_composite(im, over)
        yield finish(im)


def dip_black(pal, seconds=0.8):
    for t in frames(seconds):
        p = t / seconds
        a = V.ease_in_out(clamp(p / 0.5)) if p < 0.5 else 1 - V.ease_in_out(clamp((p - 0.5) / 0.5))
        f = np.zeros((V.H, V.W, 4), np.uint8)
        f[..., :3] = 5
        f[..., 3] = int(255 * a)
        yield f
