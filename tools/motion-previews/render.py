"""
Desenha as prévias da aba Movimento: um sprite vertical por preset (12 quadros de 144x81).
Recebe os valores por quadro calculados pelo próprio motor do plugin (scripts/motion-previews.mjs)
e aplica os efeitos na mesma ordem do Premiere: Deslocamento → Transformar → 3D básico → Desfoques.

    python3 render.py frames.json ../../apps/premiere-plugin/plugin/motion-previews
"""
import json
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 288, 162          # renderiza em 2x e reduz
OUT_W, OUT_H = 144, 81
SCALE_1080 = H / 1080     # px "a 1080p" → px da prévia
FONT = "/usr/share/fonts/opentype/inter/Inter-Bold.otf"
IDENTITY = {"x": 0, "y": 0, "scale": 100, "rot": 0, "opacity": 100, "blur": 0, "dblur": 0, "dblurDir": 0, "swivel": 0, "tilt": 0, "ox": 0, "oy": 0}


def font(size):
    try:
        return ImageFont.truetype(FONT, size)
    except OSError:
        return ImageFont.load_default()


def scene_a():
    """Cena quente: céu em degradê, sol amarelo, montanhas e o nome da marca."""
    y = np.linspace(0, 1, H)[:, None]
    top, bottom = np.array([40, 22, 60]), np.array([255, 150, 40])
    sky = (top * (1 - y) + bottom * y)[:, None, :].repeat(W, axis=1).reshape(H, W, 3)
    im = Image.fromarray(sky.astype(np.uint8))
    d = ImageDraw.Draw(im)
    d.ellipse((W * 0.58, H * 0.28, W * 0.58 + 64, H * 0.28 + 64), fill=(255, 214, 40))
    d.polygon([(0, H), (0, H * 0.7), (W * 0.25, H * 0.48), (W * 0.45, H * 0.72), (W * 0.7, H * 0.52), (W, H * 0.75), (W, H)], fill=(25, 14, 30))
    f = font(30)
    d.text((W / 2, H * 0.22), "MEGALUME", font=f, fill=(255, 255, 255), anchor="mm")
    return im


def scene_b():
    """Cena fria: azul/violeta com prédios e outra palavra (para ver a troca nas transições)."""
    y = np.linspace(0, 1, H)[:, None]
    top, bottom = np.array([10, 20, 60]), np.array([90, 60, 200])
    sky = (top * (1 - y) + bottom * y)[:, None, :].repeat(W, axis=1).reshape(H, W, 3)
    im = Image.fromarray(sky.astype(np.uint8))
    d = ImageDraw.Draw(im)
    rng = np.random.default_rng(3)
    x = 0
    while x < W:
        bw = int(rng.integers(18, 40)); bh = int(rng.integers(40, 110))
        d.rectangle((x, H - bh, x + bw - 3, H), fill=(15, 15, 35))
        for wy in range(H - bh + 6, H - 6, 10):
            for wx in range(x + 4, x + bw - 6, 8):
                if rng.random() > 0.5:
                    d.rectangle((wx, wy, wx + 3, wy + 4), fill=(255, 204, 0))
        x += bw
    d.text((W / 2, H * 0.25), "MOTION HUB", font=font(28), fill=(255, 204, 0), anchor="mm")
    return im


def find_coeffs(src, dst):
    m = []
    for (x, y), (u, v) in zip(dst, src):
        m.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        m.append([0, 0, 0, x, y, 1, -v * x, -v * y])
    a = np.array(m, dtype=float)
    b = np.array(src, dtype=float).reshape(8)
    return np.linalg.solve(a, b).tolist()


def basic3d(im, swivel, tilt):
    if abs(swivel) < 0.01 and abs(tilt) < 0.01:
        return im
    if abs(swivel) >= 89.9 or abs(tilt) >= 89.9:
        return Image.new("RGBA", im.size, (0, 0, 0, 0))
    f = W * 1.6
    sw, tl = math.radians(swivel), math.radians(tilt)
    pts = []
    for x, y in [(-W / 2, -H / 2), (W / 2, -H / 2), (W / 2, H / 2), (-W / 2, H / 2)]:
        # gira em Y (swivel) e depois em X (tilt), projeta com perspectiva
        x1, z1 = x * math.cos(sw), x * math.sin(sw)
        y2, z2 = y * math.cos(tl) - z1 * math.sin(tl), y * math.sin(tl) + z1 * math.cos(tl)
        k = f / (f + z2)
        pts.append((W / 2 + x1 * k, H / 2 + y2 * k))
    src = [(0, 0), (W, 0), (W, H), (0, H)]
    return im.transform(im.size, Image.PERSPECTIVE, find_coeffs(src, pts), Image.BICUBIC)


def directional(im, length, direction):
    if length < 0.5:
        return im
    n = 9
    rad = math.radians(direction)
    # Direção 0° = vertical, 90° = horizontal (como no Premiere).
    dx, dy = math.sin(rad) * length, -math.cos(rad) * length
    arr = np.asarray(im).astype(np.float32)
    acc = np.zeros_like(arr)
    for i in range(n):
        s = (i / (n - 1) - 0.5)
        acc += np.roll(np.roll(arr, int(round(dx * s)), axis=1), int(round(dy * s)), axis=0)
    return Image.fromarray((acc / n).astype(np.uint8), im.mode)


def render(base, v):
    v = {**IDENTITY, **v}
    im = base
    if v["ox"] or v["oy"]:
        arr = np.asarray(im)
        im = Image.fromarray(np.roll(np.roll(arr, int(round(v["ox"] * W)), axis=1), int(round(v["oy"] * H)), axis=0))
    im = im.convert("RGBA")
    s = v["scale"] / 100
    if s <= 0.001:
        return Image.new("RGB", (W, H), (0, 0, 0))
    if s != 1 or v["rot"] or v["x"] or v["y"]:
        a = math.radians(v["rot"])
        cx, cy = W / 2 + v["x"] * W, H / 2 + v["y"] * H
        # matriz inversa: saída → entrada
        cos, sin = math.cos(a) / s, math.sin(a) / s
        coeffs = (cos, sin, W / 2 - cos * cx - sin * cy, -sin, cos, H / 2 + sin * cx - cos * cy)
        im = im.transform((W, H), Image.AFFINE, coeffs, Image.BICUBIC)
    im = basic3d(im, v["swivel"], v["tilt"])
    if v["opacity"] < 100:
        a = np.asarray(im).copy()
        a[..., 3] = (a[..., 3] * (v["opacity"] / 100)).astype(np.uint8)
        im = Image.fromarray(a)
    bg = Image.new("RGBA", (W, H), (0, 0, 0, 255))
    im = Image.alpha_composite(bg, im).convert("RGB")
    if v["blur"] > 0.3:
        im = im.filter(ImageFilter.GaussianBlur(v["blur"] * SCALE_1080))
    im = directional(im, v["dblur"] * SCALE_1080, v["dblurDir"])
    return im


def main():
    data = json.load(open(sys.argv[1]))
    dest = sys.argv[2]
    os.makedirs(dest, exist_ok=True)
    scenes = {"a": scene_a(), "b": scene_b()}
    for p in data:
        sprite = Image.new("RGB", (OUT_W, OUT_H * len(p["frames"])))
        for i, fr in enumerate(p["frames"]):
            subs = [np.asarray(render(scenes[fr["img"]], s), dtype=np.float32) for s in fr["subs"]]
            frame = Image.fromarray((sum(subs) / len(subs)).astype(np.uint8)).resize((OUT_W, OUT_H), Image.LANCZOS)
            sprite.paste(frame, (0, i * OUT_H))
        sprite.save(os.path.join(dest, f"{p['id']}.jpg"), quality=72, optimize=True)


if __name__ == "__main__":
    main()
