"""
Geração de vídeos originais (1920×1080, 30 fps) por código.
Opaco → H.264 (.mp4). Com transparência → QuickTime Animation (.mov, canal alfa).
"""
import math
import subprocess
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H, FPS = 1920, 1080, 30
rng = np.random.default_rng(424242)


class Palette:
    def __init__(self, primary=(75, 156, 245), dark=(11, 26, 43), light=(255, 255, 255), accent=(255, 140, 66)):
        self.primary, self.dark, self.light, self.accent = primary, dark, light, accent


FONT_BOLD = "/usr/share/fonts/opentype/inter/Inter-Bold.otf"


def ease_out_cubic(x):
    return 1 - (1 - min(max(x, 0), 1)) ** 3


def ease_in_out(x):
    x = min(max(x, 0), 1)
    return 4 * x ** 3 if x < 0.5 else 1 - (-2 * x + 2) ** 3 / 2


def ease_out_back(x, s=1.70158):
    x = min(max(x, 0), 1) - 1
    return x * x * ((s + 1) * x + s) + 1


# ---------------- codificação ----------------

def encode(frames, path, alpha=False, src_size=(W, H), seconds=None, crf=18):
    """Recebe gerador de frames uint8 (H×W×3 ou ×4) e grava o arquivo."""
    sw, sh = src_size
    pix = "rgba" if alpha else "rgb24"
    vf = [] if (sw, sh) == (W, H) else [f"scale={W}:{H}:flags=bicubic"]
    if alpha:
        out = ["-c:v", "qtrle", "-pix_fmt", "argb"]
    else:
        out = ["-c:v", "libx264", "-preset", "slow", "-crf", str(crf), "-pix_fmt", "yuv420p", "-movflags", "+faststart"]
    cmd = ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", pix, "-s", f"{sw}x{sh}", "-r", str(FPS), "-i", "-"]
    if vf:
        cmd += ["-vf", ",".join(vf)]
    cmd += out + [path]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for f in frames:
        p.stdin.write(np.ascontiguousarray(f).tobytes())
    p.stdin.close()
    if p.wait() != 0:
        raise RuntimeError(f"ffmpeg falhou em {path}")


def preview_and_poster(src, preview_path, poster_path, alpha, poster_time):
    """Preview H.264 (com alfa composto sobre cinza escuro) e poster PNG."""
    bg = "color=c=0x1f1f1f:s=1920x1080:r=30"
    if alpha:
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", bg, "-i", src, "-filter_complex", "[0][1]overlay=shortest=1,format=yuv420p",
                        "-c:v", "libx264", "-crf", "23", "-movflags", "+faststart", preview_path], check=True)
        # QuickTime Animation é codificado em delta: pular direto (-ss na entrada) gera quadro parcial.
        # Por isso a seleção do quadro acontece depois da decodificação, a partir do início.
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", bg, "-i", src, "-filter_complex",
                        f"[0][1]overlay=shortest=1,select='gte(t\\,{poster_time})'", "-frames:v", "1", poster_path], check=True)
    else:
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-c:v", "libx264", "-crf", "23", "-an", "-movflags", "+faststart", preview_path], check=True)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(poster_time), "-i", src, "-frames:v", "1", poster_path], check=True)


# ---------------- overlays (fundo preto, usar modo Tela/Screen) ----------------

def light_leak(pal, warm=True, seconds=6):
    lw, lh = 480, 270
    yy, xx = np.mgrid[0:lh, 0:lw].astype(np.float32)
    cols = [(255, 120, 40), (255, 60, 30), (255, 200, 90), (255, 90, 120)] if warm else [(60, 140, 255), (120, 80, 255), (80, 220, 255), (200, 120, 255)]
    blobs = [dict(c=np.array(cols[i], np.float32) / 255, ph=rng.uniform(0, 6.28, 2), sp=rng.uniform(0.15, 0.4, 2), r=rng.uniform(60, 120), gain=rng.uniform(1.2, 2.0)) for i in range(4)]
    vign = np.clip(1.25 - np.sqrt(((xx - lw / 2) / (lw / 2)) ** 2 + ((yy - lh / 2) / (lh / 2)) ** 2) * 0.75, 0, 1)[..., None]
    n = seconds * FPS
    for k in range(n):
        t = k / FPS
        loop = 2 * math.pi * t / seconds
        img = np.zeros((lh, lw, 3), np.float32)
        for b in blobs:
            cx = lw * (0.5 + 0.45 * math.sin(loop * b["sp"][0] * 2 + b["ph"][0]))
            cy = lh * (0.5 + 0.5 * math.sin(loop * b["sp"][1] * 2 + b["ph"][1]))
            d2 = (xx - cx) ** 2 + (yy - cy) ** 2
            img += np.exp(-d2 / (2 * b["r"] ** 2))[..., None] * b["c"] * b["gain"]
        flick = 0.85 + 0.15 * math.sin(loop * 3) * math.sin(loop * 5 + 1)
        img = (1 - np.exp(-img * 1.6 * flick)) * vign
        fade = min(1, t / 0.5, (seconds - t) / 0.5)
        yield (np.clip(img * fade, 0, 1) * 255).astype(np.uint8)


def bokeh(pal, seconds=6):
    lw, lh = 960, 540
    yy, xx = np.mgrid[0:lh, 0:lw].astype(np.float32)
    n_c = 28
    base = [np.array(c, np.float32) / 255 for c in (pal.primary, (255, 210, 150), (255, 255, 255), (160, 200, 255))]
    circles = [dict(x=rng.uniform(0, lw), y=rng.uniform(0, lh), r=rng.uniform(12, 45), c=base[i % 4], sp=rng.uniform(8, 25), tw=rng.uniform(0, 6.28)) for i in range(n_c)]
    for k in range(seconds * FPS):
        t = k / FPS
        img = np.zeros((lh, lw, 3), np.float32)
        for c in circles:
            cy = (c["y"] - c["sp"] * t * 3) % (lh + 100) - 50
            d = np.sqrt((xx - c["x"]) ** 2 + (yy - cy) ** 2)
            disc = np.clip((c["r"] - d) / 3, 0, 1) * (0.25 + 0.1 * np.clip(d / c["r"], 0, 1))
            tw = 0.6 + 0.4 * math.sin(t * 2 + c["tw"])
            img += disc[..., None] * c["c"] * tw
        fade = min(1, t / 0.5, (seconds - t) / 0.5)
        yield (np.clip(img * fade, 0, 1) * 255).astype(np.uint8)


def film_grain(pal, seconds=4):
    """Cinza médio + grão: usar modo Sobrepor (Overlay) ou Luz suave."""
    for _ in range(seconds * FPS):
        g = rng.normal(128, 22, (H // 2, W // 2)).astype(np.float32)
        img = np.repeat(np.repeat(g, 2, 0), 2, 1)
        yield np.repeat(np.clip(img, 0, 255).astype(np.uint8)[..., None], 3, axis=2)


def dust_scratches(pal, seconds=5):
    scratches = []
    for k in range(seconds * FPS):
        im = Image.new("L", (W, H), 0)
        d = ImageDraw.Draw(im)
        for _ in range(int(rng.integers(8, 30))):
            x, y, r = rng.uniform(0, W), rng.uniform(0, H), rng.uniform(0.8, 3.5)
            d.ellipse([x - r, y - r, x + r, y + r], fill=int(rng.uniform(120, 255)))
        if rng.random() < 0.06:
            scratches.append([rng.uniform(0, W), int(rng.integers(3, 12))])
        for s in scratches:
            s[0] += rng.normal(0, 2)
            d.line([(s[0], 0), (s[0] + rng.normal(0, 4), H)], fill=int(rng.uniform(90, 180)), width=1)
            s[1] -= 1
        scratches = [s for s in scratches if s[1] > 0]
        im = im.filter(ImageFilter.GaussianBlur(0.6))
        a = np.asarray(im)
        yield np.stack([a, a, a], axis=2)


# ---------------- fundos (loop) ----------------

def gradient_fluid(pal, seconds=8, warm=False):
    lw, lh = 320, 180
    yy, xx = np.mgrid[0:lh, 0:lw].astype(np.float32) / lw
    c1 = np.array(pal.dark if not warm else (40, 10, 30), np.float32)
    c2 = np.array(pal.primary if not warm else (255, 90, 60), np.float32)
    c3 = np.array((120, 80, 255) if not warm else (255, 190, 80), np.float32)
    for k in range(seconds * FPS):
        p = 2 * math.pi * k / (seconds * FPS)
        f = np.sin(xx * 6 + p) + np.sin(yy * 9 - p) + np.sin((xx + yy) * 5 + 2 * p) + np.sin(np.sqrt((xx - 0.5) ** 2 + (yy - 0.3) ** 2) * 12 - p)
        a = (f + 4) / 8
        b = (np.sin(xx * 3 - p + yy * 4) + 1) / 2
        img = c1[None, None] * (1 - a[..., None]) + c2[None, None] * a[..., None]
        img = img * (1 - 0.35 * b[..., None]) + c3[None, None] * 0.35 * b[..., None]
        yield img.astype(np.uint8)


def tech_grid(pal, seconds=6):
    """Grade em perspectiva avançando (loop): linhas com brilho, mais fortes perto da câmera."""
    top, bot = np.array(pal.dark, np.float32) * 1.3, np.array(pal.dark, np.float32) * 0.35
    yl = np.linspace(0, 1, H)[:, None, None]
    base = np.repeat(top * (1 - yl) + bot * yl, W, axis=1)
    horizon, vx = int(H * 0.42), W / 2
    depth = np.clip((np.arange(H) - horizon) / (H - horizon), 0, 1)[:, None, None] ** 0.7
    col = np.array(pal.primary, np.float32)
    for k in range(seconds * FPS):
        ph = (k / (seconds * FPS)) % 1
        lines = Image.new("L", (W, H), 0)
        d = ImageDraw.Draw(lines)
        for i in range(-16, 17):
            d.line([(vx + i * 30, horizon), (vx + i * 260, H)], fill=255, width=3)
        for j in range(14):
            z = (j + ph) / 14
            y = horizon + (H - horizon) * z ** 2.2
            d.line([(0, y), (W, y)], fill=255, width=3)
        sharp = np.asarray(lines, np.float32)[..., None] / 255
        glow = np.asarray(lines.filter(ImageFilter.GaussianBlur(8)), np.float32)[..., None] / 255
        img = base + col * (sharp * 0.9 + glow * 1.6) * depth
        # brilho no horizonte
        img += col * np.exp(-((np.arange(H) - horizon) / 40.0) ** 2)[:, None, None] * 0.35
        yield np.clip(img, 0, 255).astype(np.uint8)


def particles(pal, seconds=8):
    lw, lh = 960, 540
    n_p = 160
    xs, ys = rng.uniform(0, lw, n_p), rng.uniform(0, lh, n_p)
    sp, sz, ph = rng.uniform(6, 22, n_p), rng.uniform(1, 3.2, n_p), rng.uniform(0, 6.28, n_p)
    yyg = np.linspace(0, 1, lh)[:, None, None]
    bg = (np.array(pal.dark, np.float32) * (1 - yyg) * 1.1 + np.array((4, 6, 12), np.float32) * yyg)
    bg = np.repeat(bg, lw, axis=1)
    col = np.array(pal.primary, np.float32)
    for k in range(seconds * FPS):
        t = k / FPS
        loop = t / seconds
        im = Image.new("L", (lw, lh), 0)
        d = ImageDraw.Draw(im)
        for i in range(n_p):
            y = (ys[i] - sp[i] * seconds * loop * 3) % lh
            x = xs[i] + 8 * math.sin(2 * math.pi * loop * 2 + ph[i])
            b = int(140 + 115 * math.sin(2 * math.pi * loop * 3 + ph[i]))
            d.ellipse([x - sz[i], y - sz[i], x + sz[i], y + sz[i]], fill=max(b, 60))
        a = np.asarray(im.filter(ImageFilter.GaussianBlur(1.2)), np.float32)[..., None] / 255
        g = np.asarray(im.filter(ImageFilter.GaussianBlur(5)), np.float32)[..., None] / 255
        img = bg + col * g * 1.5 + 255 * a * 0.9
        yield np.clip(img, 0, 255).astype(np.uint8)


# ---------------- formas e transições (com alfa) ----------------

SS = 2  # supersampling para bordas suaves


def _canvas():
    return Image.new("RGBA", (W * SS, H * SS), (0, 0, 0, 0))


def _down(im):
    return np.asarray(im.resize((W, H), Image.LANCZOS))


def ring_burst(pal, seconds=1.6):
    cx, cy = W * SS / 2, H * SS / 2
    for k in range(int(seconds * FPS)):
        p = k / (seconds * FPS - 1)
        im = _canvas()
        d = ImageDraw.Draw(im)
        r = ease_out_cubic(p / 0.8) * 320 * SS
        th = max(1, int((1 - ease_out_cubic(p)) * 40 * SS))
        a = int(255 * (1 - max(0, (p - 0.5) / 0.5)))
        if r > th:
            d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=pal.primary + (a,), width=th)
        for i in range(12):
            ang = i * math.pi / 6
            r0 = ease_out_cubic(max(0, p - 0.05) / 0.7) * 380 * SS
            r1 = ease_out_cubic(max(0, p - 0.15) / 0.7) * 380 * SS
            if r0 - r1 > 2:
                d.line([(cx + math.cos(ang) * r1, cy + math.sin(ang) * r1), (cx + math.cos(ang) * r0, cy + math.sin(ang) * r0)], fill=pal.light + (a,), width=6 * SS)
        yield _down(im)


def underline(pal, seconds=2.6, length=900):
    x0, y = (W - length) / 2 * SS, H * 0.62 * SS
    for k in range(int(seconds * FPS)):
        t = k / FPS
        im = _canvas()
        d = ImageDraw.Draw(im)
        grow = ease_out_cubic(t / 0.6)
        shrink = ease_in_out((t - (seconds - 0.6)) / 0.55)
        a, b = x0 + length * SS * shrink, x0 + length * SS * grow
        if b - a > 1:
            d.rounded_rectangle([a, y, b, y + 12 * SS], radius=6 * SS, fill=pal.primary + (255,))
        a2, b2 = x0 + length * SS * ease_in_out((t - (seconds - 0.5)) / 0.5), x0 + length * SS * ease_out_cubic((t - 0.12) / 0.6)
        if b2 - a2 > 1:
            d.rounded_rectangle([a2, y + 22 * SS, b2, y + 28 * SS], radius=3 * SS, fill=pal.light + (220,))
        yield _down(im)


def pulse_ring(pal, seconds=3):
    cx, cy = W * SS / 2, H * SS / 2
    for k in range(seconds * FPS):
        p = 2 * math.pi * k / (seconds * FPS)
        im = _canvas()
        d = ImageDraw.Draw(im)
        for i, (base, w, a) in enumerate([(140, 10, 255), (190, 4, 140), (240, 2, 70)]):
            r = (base + 14 * math.sin(p + i * 0.8)) * SS
            d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=pal.primary + (a,), width=w * SS)
        yield _down(im)


def corner_brackets(pal, seconds=2.6, box=(560, 320, 1360, 760), arm=110):
    x0, y0, x1, y1 = [v * SS for v in box]
    arm *= SS
    for k in range(int(seconds * FPS)):
        t = k / FPS
        im = _canvas()
        d = ImageDraw.Draw(im)
        grow = ease_out_back(t / 0.55)
        out = ease_in_out((t - (seconds - 0.45)) / 0.45)
        L = arm * grow * (1 - out)
        off = 30 * SS * (1 - ease_out_cubic(t / 0.55)) + 40 * SS * out
        col = pal.light + (int(255 * (1 - out)),)
        wdt = 8 * SS
        if L > 1:
            for (cx, cy, sx, sy) in [(x0 - off, y0 - off, 1, 1), (x1 + off, y0 - off, -1, 1), (x0 - off, y1 + off, 1, -1), (x1 + off, y1 + off, -1, -1)]:
                d.line([(cx, cy), (cx + sx * L, cy)], fill=col, width=wdt)
                d.line([(cx, cy), (cx, cy + sy * L)], fill=col, width=wdt)
        yield _down(im)


def wipe_diagonal(pal, seconds=1.0):
    """Cobre a tela inteira na metade (0,5 s): coloque o corte no meio da transição."""
    for k in range(int(seconds * FPS)):
        p = k / (seconds * FPS - 1)
        im = _canvas()
        d = ImageDraw.Draw(im)
        for color, delay in [(pal.primary, 0.0), (pal.dark, 0.08)]:
            q = min(max((p - delay) / (1 - 0.08), 0), 1)
            lead = ease_in_out(min(q / 0.5, 1)) * 1.6 - 0.3
            trail = ease_in_out(max((q - 0.5) / 0.5, 0)) * 1.6 - 0.3
            pts = []
            for a in (trail, lead):
                xs = a * W * SS
                pts.append((xs, a))
            lx, tx = pts[1][0], pts[0][0]
            skew = 0.35 * W * SS
            poly = [(tx - skew, H * SS), (tx, 0), (lx, 0), (lx - skew, H * SS)] if lx > tx else []
            if poly:
                d.polygon(poly, fill=color + (255,))
        yield _down(im)


def flash(pal, seconds=0.6):
    for k in range(int(seconds * FPS)):
        p = k / (seconds * FPS - 1)
        a = ease_out_cubic(p / 0.35) if p < 0.35 else 1 - ease_in_out((p - 0.35) / 0.65)
        f = np.zeros((H, W, 4), np.uint8)
        f[..., :3] = 255
        f[..., 3] = int(255 * a)
        yield f


def iris(pal, seconds=1.0):
    cx, cy = W * SS / 2, H * SS / 2
    R = math.hypot(W, H) / 2 * SS + 10
    for k in range(int(seconds * FPS)):
        p = k / (seconds * FPS - 1)
        im = _canvas()
        d = ImageDraw.Draw(im)
        outer = ease_in_out(min(p / 0.5, 1)) * R
        inner = ease_in_out(max((p - 0.5) / 0.5, 0)) * R
        if outer > inner:
            d.ellipse([cx - outer, cy - outer, cx + outer, cy + outer], fill=pal.primary + (255,))
            if inner > 0:
                d.ellipse([cx - inner, cy - inner, cx + inner, cy + inner], fill=(0, 0, 0, 0))
        yield _down(im)


def glitch_blocks(pal, seconds=0.7):
    cols = [(255, 40, 80), (40, 220, 255), pal.primary, (255, 255, 255)]
    for k in range(int(seconds * FPS)):
        p = k / (seconds * FPS - 1)
        intensity = math.sin(math.pi * p)
        f = np.zeros((H, W, 4), np.uint8)
        for _ in range(int(4 + 40 * intensity)):
            h = int(rng.uniform(4, 90))
            y = int(rng.uniform(0, H - h))
            x = int(rng.uniform(-200, W))
            w = int(rng.uniform(80, 900))
            c = cols[int(rng.integers(0, 4))]
            f[y:y + h, max(x, 0):min(x + w, W), :3] = c
            f[y:y + h, max(x, 0):min(x + w, W), 3] = int(rng.uniform(120, 255) * intensity)
        f[::4, :, 3] = (f[::4, :, 3] * 0.5).astype(np.uint8)  # scanlines
        yield f


def countdown(pal, start=10, seconds_per=1.0):
    font = ImageFont.truetype(FONT_BOLD, 300 * SS)
    cx, cy = W * SS / 2, H * SS / 2
    R = 260 * SS
    total = int(start * seconds_per * FPS)
    for k in range(total):
        t = k / FPS
        i = int(t // seconds_per)
        n = start - i
        local = (t - i * seconds_per) / seconds_per
        im = _canvas()
        d = ImageDraw.Draw(im)
        d.ellipse([cx - R, cy - R, cx + R, cy + R], outline=(255, 255, 255, 50), width=14 * SS)
        rem = 1 - (t / (start * seconds_per))
        if rem > 0:
            d.arc([cx - R, cy - R, cx + R, cy + R], start=-90, end=-90 + 360 * rem, fill=pal.primary + (255,), width=14 * SS)
        s = 1.15 - 0.15 * ease_out_cubic(local / 0.35)
        a = int(255 * min(1, local / 0.12) * (1 - max(0, (local - 0.9) / 0.1)))
        txt = Image.new("RGBA", im.size, (0, 0, 0, 0))
        td = ImageDraw.Draw(txt)
        td.text((cx, cy), str(n), font=font, fill=(255, 255, 255, a), anchor="mm")
        if abs(s - 1) > 0.002:
            tw, th = txt.size
            sc = txt.resize((int(tw * s), int(th * s)), Image.BILINEAR)
            txt = sc.crop(((sc.width - tw) // 2, (sc.height - th) // 2, (sc.width - tw) // 2 + tw, (sc.height - th) // 2 + th))
        im = Image.alpha_composite(im, txt)
        yield _down(im)
