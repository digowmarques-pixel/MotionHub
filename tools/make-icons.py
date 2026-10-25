"""Gera os ícones da marca (amarelo #FFCC00 + preto) para o plugin e o Gerenciador."""
import sys
from PIL import Image, ImageDraw

YELLOW, BLACK, LIGHT = (255, 204, 0, 255), (10, 10, 10, 255), (220, 220, 220, 255)


def icon(size, path, bg=True):
    s = size * 4
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    col = LIGHT
    if bg:
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=s // 5, fill=YELLOW)
        col = BLACK
    pts = [(s * 0.2, s * 0.78), (s * 0.2, s * 0.24), (s * 0.5, s * 0.6), (s * 0.8, s * 0.24), (s * 0.8, s * 0.78)]
    d.line(pts, fill=col, width=s // 7, joint="curve")
    im.resize((size, size), Image.LANCZOS).save(path)


if __name__ == "__main__":
    root = sys.argv[1] if len(sys.argv) > 1 else "."
    for scale, suffix in ((1, ""), (2, "@2x")):
        icon(24 * scale, f"{root}/apps/premiere-plugin/plugin/icons/plugin{suffix}.png")
        icon(23 * scale, f"{root}/apps/premiere-plugin/plugin/icons/panel{suffix}.png", bg=False)
    icon(1024, f"{root}/apps/desktop/build/icon.png")
