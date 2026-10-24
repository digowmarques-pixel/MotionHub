"""
Síntese de efeitos sonoros originais (48 kHz, 24-bit, estéreo).
Todo som é gerado matematicamente: nenhum sample de terceiros.
"""
import wave
import numpy as np

SR = 48000
rng = np.random.default_rng(20261024)


def t_axis(sec):
    return np.arange(int(sec * SR)) / SR


def env_adsr(n, a, d, s_level, r, total):
    """Envelope em segundos; total = duração."""
    t = np.arange(n) / SR
    e = np.zeros(n)
    e = np.where(t < a, t / max(a, 1e-6), e)
    dm = (t >= a) & (t < a + d)
    e = np.where(dm, 1 - (1 - s_level) * (t - a) / max(d, 1e-6), e)
    sm = (t >= a + d) & (t < total - r)
    e = np.where(sm, s_level, e)
    rm = t >= total - r
    e = np.where(rm, s_level * np.clip((total - t) / max(r, 1e-6), 0, 1), e)
    return e


def pink(n):
    """Ruído rosa por filtragem espectral 1/f."""
    w = rng.standard_normal(n)
    f = np.fft.rfft(w)
    freqs = np.fft.rfftfreq(n, 1 / SR)
    f[1:] /= np.sqrt(freqs[1:])
    f[0] = 0
    x = np.fft.irfft(f, n)
    return x / np.max(np.abs(x))


def band_sweep(x, f_start, f_end, q=1.5, frame=2048, hop=512, curve=1.0):
    """Filtro passa-faixa que varre de f_start a f_end ao longo do sinal (STFT)."""
    n = len(x)
    win = np.hanning(frame)
    out = np.zeros(n + frame)
    norm = np.zeros(n + frame)
    freqs = np.fft.rfftfreq(frame, 1 / SR)
    frames = max(1, (n - frame) // hop + 1)
    for i in range(frames):
        p = (i / max(frames - 1, 1)) ** curve
        fc = f_start * (f_end / f_start) ** p
        bw = fc / q
        gain = np.exp(-0.5 * ((freqs - fc) / bw) ** 2)
        seg = x[i * hop:i * hop + frame]
        if len(seg) < frame:
            seg = np.pad(seg, (0, frame - len(seg)))
        spec = np.fft.rfft(seg * win) * gain
        out[i * hop:i * hop + frame] += np.fft.irfft(spec, frame) * win
        norm[i * hop:i * hop + frame] += win ** 2
    norm[norm < 1e-6] = 1
    return (out / norm)[:n]


def lowpass(x, cutoff):
    f = np.fft.rfft(x)
    freqs = np.fft.rfftfreq(len(x), 1 / SR)
    f *= 1 / np.sqrt(1 + (freqs / cutoff) ** 4)
    return np.fft.irfft(f, len(x))


def highpass(x, cutoff):
    f = np.fft.rfft(x)
    freqs = np.fft.rfftfreq(len(x), 1 / SR)
    f *= 1 / np.sqrt(1 + (cutoff / np.maximum(freqs, 1)) ** 4)
    return np.fft.irfft(f, len(x))


def reverb(x, seconds=1.8, mix=0.3, damp=3000):
    """Reverb por convolução com resposta ao impulso de ruído decaindo."""
    n = int(seconds * SR)
    ir = rng.standard_normal(n) * np.exp(-np.arange(n) / SR * (6.9 / seconds))
    ir = lowpass(ir, damp)
    ir /= np.sqrt(np.sum(ir ** 2))
    total = len(x) + n
    size = 1 << (total - 1).bit_length()
    wet = np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(ir, size), size)[:total]
    dry = np.pad(x, (0, n))
    return dry * (1 - mix) + wet * mix * 3


def stereo(mono, pan=None, width=0.0):
    """pan: array -1..1 (esquerda..direita) ou None. width: decorrelação leve."""
    if pan is None:
        pan = np.zeros(len(mono))
    l = mono * np.cos((pan + 1) * np.pi / 4)
    r = mono * np.sin((pan + 1) * np.pi / 4)
    if width:
        d = int(0.0007 * SR)
        r = np.concatenate([np.zeros(d), r[:-d]]) * (1 - width) + r * width
    return np.stack([l, r], axis=1)


def finish(st, peak_db=-1.0, fade_in=0.002, fade_out=0.05):
    st = np.tanh(st * 1.2) / np.tanh(1.2)  # saturação suave
    n = len(st)
    fi, fo = int(fade_in * SR), int(fade_out * SR)
    if fi:
        st[:fi] *= np.linspace(0, 1, fi)[:, None]
    if fo:
        st[-fo:] *= np.linspace(1, 0, fo)[:, None]
    st = st - np.mean(st, axis=0)
    return st / np.max(np.abs(st)) * 10 ** (peak_db / 20)


def write_wav(path, st):
    data = np.clip(st, -1, 1)
    ints = (data * (2 ** 23 - 1)).astype(np.int32)
    b = ints.astype("<i4").tobytes()
    # 24-bit: descarta o byte mais significativo de cada amostra de 32 bits
    raw = np.frombuffer(b, dtype=np.uint8).reshape(-1, 4)[:, :3].tobytes()
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(3)
        w.setframerate(SR)
        w.writeframes(raw)


# ---------------- receitas ----------------

def whoosh(sec=1.2, f0=300, f1=4000, peak=0.55, pan_from=-0.8, pan_to=0.8):
    n = int(sec * SR)
    x = band_sweep(pink(n), f0, f1, q=1.2)
    t = np.arange(n) / SR
    e = np.exp(-((t - sec * peak) ** 2) / (2 * (sec * 0.18) ** 2))
    pan = np.linspace(pan_from, pan_to, n)
    return finish(stereo(x * e, pan, 0.3), fade_out=0.08)


def swoosh_fast():
    return whoosh(0.45, 800, 7000, 0.45)


def whoosh_long():
    n = int(2.4 * SR)
    a = band_sweep(pink(n), 150, 2500, q=1.0)
    b = band_sweep(pink(n), 2500, 400, q=2.0) * 0.5
    t = np.arange(n) / SR
    e = np.exp(-((t - 1.3) ** 2) / (2 * 0.45 ** 2))
    return finish(stereo((a + b) * e, np.sin(t * 1.3) * 0.7, 0.4), fade_out=0.2)


def boom(sec=2.5, f_hi=110, f_lo=38):
    t = t_axis(sec)
    freq = f_lo + (f_hi - f_lo) * np.exp(-t * 9)
    phase = 2 * np.pi * np.cumsum(freq) / SR
    body = np.sin(phase) * np.exp(-t * 2.2)
    click = highpass(rng.standard_normal(len(t)), 2000) * np.exp(-t * 120) * 0.6
    rumble = lowpass(pink(len(t)), 180) * np.exp(-t * 1.6) * 0.5
    mono = body + click + rumble
    return finish(stereo(reverb(mono, 2.0, 0.25, 1200)[: int((sec + 0.5) * SR)], width=0.5), fade_out=0.3)


def cinematic_hit():
    t = t_axis(3.5)
    b = boom(3.5)[:, 0][: len(t)]
    partials = [97, 233, 389, 541, 811, 1187]
    metal = sum(np.sin(2 * np.pi * f * t + rng.uniform(0, 6)) * np.exp(-t * (1.2 + i * 0.6)) / (i + 1) for i, f in enumerate(partials))
    mono = b * 0.9 + metal * 0.35
    return finish(stereo(reverb(mono, 3.0, 0.4, 2500)[: len(t) + SR], width=0.6), fade_out=0.6)


def riser(sec=4.0):
    n = int(sec * SR)
    t = np.arange(n) / SR
    noise = band_sweep(pink(n), 200, 9000, q=1.3, curve=1.8)
    f = 110 * 2 ** (t / sec * 3)  # sobe 3 oitavas
    saw = 2 * ((np.cumsum(f) / SR) % 1) - 1
    saw = lowpass(saw, 3000)
    e = (t / sec) ** 2.2
    trem = 1 + 0.25 * np.sin(2 * np.pi * (2 + 14 * t / sec) * t)
    mono = (noise * 0.8 + saw * 0.25) * e * trem
    return finish(stereo(mono, None, 0.5), fade_out=0.01)


def reverse_swell():
    hit = cinematic_hit()[:, 0]
    rev = hit[::-1][-int(2.2 * SR):]
    return finish(stereo(rev, None, 0.5), fade_in=0.3, fade_out=0.005)


def ui_click():
    t = t_axis(0.12)
    x = highpass(rng.standard_normal(len(t)), 1500) * np.exp(-t * 400) + np.sin(2 * np.pi * 2200 * t) * np.exp(-t * 300) * 0.5
    return finish(stereo(x), fade_out=0.02)


def pop():
    t = t_axis(0.25)
    f = 180 + 700 * np.exp(-t * 40)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 22)
    return finish(stereo(x), fade_out=0.03)


def glitch():
    sec = 1.0
    n = int(sec * SR)
    out = np.zeros(n)
    pos = 0
    while pos < n:
        ln = int(rng.uniform(0.015, 0.09) * SR)
        kind = rng.integers(0, 4)
        tt = np.arange(ln) / SR
        if kind == 0:
            seg = np.sign(np.sin(2 * np.pi * rng.uniform(80, 1200) * tt))
        elif kind == 1:
            seg = rng.standard_normal(ln)
        elif kind == 2:
            seg = np.round(np.sin(2 * np.pi * rng.uniform(200, 3000) * tt) * 4) / 4
        else:
            seg = np.zeros(ln)
        out[pos:pos + ln] = seg[: n - pos] * rng.uniform(0.3, 1)
        pos += ln
    out = np.round(out * 8) / 8  # bitcrush
    pan = np.repeat(rng.uniform(-0.7, 0.7, n // 2400 + 1), 2400)[:n]
    return finish(stereo(lowpass(out, 9000), pan), fade_out=0.03)


def ding():
    t = t_axis(2.0)
    partials = [(1046.5, 1.0, 2.5), (2093, 0.4, 4), (2637, 0.25, 5), (3520, 0.12, 7)]
    x = sum(a * np.sin(2 * np.pi * f * t) * np.exp(-t * d) for f, a, d in partials)
    return finish(stereo(reverb(x, 1.2, 0.2, 6000)[: len(t)], width=0.3), fade_out=0.3)


def tick():
    t = t_axis(0.08)
    x = np.sin(2 * np.pi * 3200 * t) * np.exp(-t * 180) + highpass(rng.standard_normal(len(t)), 3000) * np.exp(-t * 600) * 0.4
    return finish(stereo(x), fade_out=0.01)


def transition_sweep():
    """Whoosh + pequeno impacto no fim: para cortes com transição."""
    w = whoosh(1.0, 300, 5000, 0.75)
    h = boom(1.2, 140, 50)
    n = int(1.9 * SR)
    out = np.zeros((n, 2))
    out[: len(w)] += w
    start = int(0.78 * SR)
    seg = h[: n - start]
    out[start:start + len(seg)] += seg * 0.8
    return finish(out, fade_out=0.15)


RECIPES = {
    "whoosh-classico": (whoosh, "Whoosh Clássico", "Passagem de ar média, atravessa da esquerda para a direita.", ["whoosh", "passagem", "transição"], ["swish", "vento"]),
    "swoosh-rapido": (swoosh_fast, "Swoosh Rápido", "Passagem curta e aguda para textos e cortes rápidos.", ["swoosh", "rápido", "texto"], ["swish"]),
    "whoosh-longo": (whoosh_long, "Whoosh Longo", "Passagem lenta e cheia, boa para aberturas.", ["whoosh", "abertura", "lento"], ["vento"]),
    "impacto-grave": (lambda: boom(), "Impacto Grave", "Boom grave com cauda, para revelações de logo e títulos.", ["impacto", "boom", "grave"], ["hit", "batida"]),
    "impacto-cinematico": (cinematic_hit, "Impacto Cinematográfico", "Hit grave com camada metálica e reverb longo.", ["impacto", "cinema", "trailer"], ["hit", "trailer hit"]),
    "riser-4s": (riser, "Riser 4 segundos", "Tensão crescente que termina seco, para antes de um corte.", ["riser", "tensão", "build"], ["subida", "uplifter"]),
    "swell-reverso": (reverse_swell, "Swell Reverso", "Ataque reverso que cresce até o ponto de corte.", ["reverso", "swell", "transição"], ["reverse"]),
    "clique-interface": (ui_click, "Clique de Interface", "Clique curto e limpo para UI, mouse e listas.", ["clique", "ui", "interface"], ["click", "botão"]),
    "pop": (pop, "Pop", "Pop curto para ícones e elementos que aparecem.", ["pop", "aparecer", "ícone"], ["bolha"]),
    "glitch-digital": (glitch, "Glitch Digital", "Falhas digitais picotadas, combina com transições glitch.", ["glitch", "digital", "tecnologia"], ["falha", "erro"]),
    "notificacao-ding": (ding, "Notificação Ding", "Sino curto e brilhante para destaques e checklists.", ["notificação", "sino", "destaque"], ["ding", "alerta"]),
    "tique-relogio": (tick, "Tique de Relógio", "Tique seco para contadores e cronômetros.", ["relógio", "contador", "tique"], ["tick", "tac"]),
    "transicao-impacto": (transition_sweep, "Whoosh com Impacto", "Passagem que termina num impacto: transição pronta para cortes.", ["whoosh", "impacto", "transição"], ["swish hit"]),
}
