"""Gera o vídeo de exemplo da esteira e o gabarito (manifesto) com a verdade de cada peça.

Uso: python3 scripts/gerar_video.py [--seed 7] [--duracao 60]

Saídas em public/amostra/:
  esteira.webm   vídeo VP9 (Chrome, Firefox, Edge)
  esteira.mp4    vídeo H.264 (Safari)
  gabarito.json  peças, tipos, defeitos e contagens esperadas por etapa

O detector do app nunca lê o gabarito para contar: ele só enxerga os pixels.
O gabarito serve para medir a precisão.
"""

import argparse
import json
import math
import random
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

W, H = 960, 540
FPS = 30
VELOCIDADE = 200  # px/s
BELT_Y0, BELT_Y1 = 172, 388
LINHAS = {"entrada": 0.15, "inspecao": 0.45, "embalagem": 0.85}
X_PISTAO = 0.56 * W
DURACAO_EMPURRAO = 0.35
QUEDA = 230  # px que a peça rejeitada desce até a caixa

METAL = (184, 188, 194)
METAL_BORDA = (146, 150, 157)
FERRUGEM = (178, 98, 44)
ESTEIRA = (52, 54, 58)
RIPA = (40, 41, 44)
FUNDO = (26, 28, 32)
TRILHO = (92, 94, 100)
PISTAO = (70, 72, 78)


def poligono_tipo(tipo, cx, cy, ang):
    if tipo == "disco":
        return None
    if tipo == "bloco":
        hw, hh = 31, 31
    else:  # barra
        hw, hh = 52, 16
    c, s = math.cos(ang), math.sin(ang)
    pts = []
    for dx, dy in ((-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)):
        pts.append((cx + dx * c - dy * s, cy + dx * s + dy * c))
    return pts


def desenhar_peca(draw, p, cx, cy):
    if p["tipo"] == "disco":
        r = 33
        draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=METAL, outline=METAL_BORDA, width=2)
    else:
        pts = poligono_tipo(p["tipo"], cx, cy, p["angulo"])
        draw.polygon(pts, fill=METAL, outline=METAL_BORDA, width=2)
    # reflexo discreto, como em metal usinado
    draw.ellipse((cx - 9, cy - 14, cx + 3, cy - 8), fill=(210, 213, 218))
    if p["defeito"]:
        rnd = random.Random(p["id"] * 31 + 5)
        ox, oy = rnd.uniform(-9, 9), rnd.uniform(-7, 7)
        for k in range(4):
            rx = rnd.uniform(7, 11)
            ry = rnd.uniform(6, 9)
            px = cx + ox + rnd.uniform(-7, 7)
            py = cy + oy + rnd.uniform(-5, 5)
            draw.ellipse((px - rx, py - ry, px + rx, py + ry), fill=FERRUGEM)


def gerar_pecas(seed, duracao):
    rnd = random.Random(seed)
    pecas = []
    t = 0.6
    pid = 1
    tipos = ["disco", "bloco", "barra"]
    while True:
        t += rnd.uniform(0.75, 1.3)
        # a peça nasce fora da tela, à esquerda, e precisa chegar à embalagem antes do fim
        t_embalagem = t + (LINHAS["embalagem"] * W + 80) / VELOCIDADE
        if t_embalagem > duracao - 0.5:
            break
        tipo = rnd.choices(tipos, weights=[0.4, 0.35, 0.25])[0]
        pecas.append(
            {
                "id": pid,
                "tipo": tipo,
                "defeito": rnd.random() < 0.12,
                "t_nascimento": round(t, 3),
                "y": rnd.uniform(232, 328),
                "angulo": rnd.uniform(0, math.pi),
            }
        )
        pid += 1
    return pecas


def posicao(p, t):
    """Centro da peça no instante t, ou None se ainda não entrou ou já saiu de cena."""
    dt = t - p["t_nascimento"]
    if dt < 0:
        return None
    x = -80 + dt * VELOCIDADE
    y = p["y"]
    if p["defeito"] and x >= X_PISTAO:
        t_pistao = p["t_nascimento"] + (X_PISTAO + 80) / VELOCIDADE
        k = min(1.0, (t - t_pistao) / DURACAO_EMPURRAO)
        x = X_PISTAO
        y = p["y"] + QUEDA * (k * k)
        if k >= 1.0 and t - t_pistao > 2.5:
            # já está na caixa de refugo: some da cena depois de um tempo
            return None
    if x > W + 80:
        return None
    return x, y


def quadro_base(t):
    img = Image.new("RGB", (W, H), FUNDO)
    d = ImageDraw.Draw(img)
    d.rectangle((0, BELT_Y0, W, BELT_Y1), fill=ESTEIRA)
    desloc = (t * VELOCIDADE) % 44
    x = -44 + desloc
    while x < W:
        d.rectangle((x, BELT_Y0, x + 3, BELT_Y1), fill=RIPA)
        x += 44
    d.rectangle((0, BELT_Y0 - 7, W, BELT_Y0 - 2), fill=TRILHO)
    d.rectangle((0, BELT_Y1 + 2, W, BELT_Y1 + 7), fill=TRILHO)
    # caixa de refugo abaixo da esteira, depois do pistão
    d.rectangle((X_PISTAO - 70, 430, X_PISTAO + 110, 536), outline=(80, 60, 50), width=3)
    return img, d


def desenhar_pistao(d, t, pecas):
    """A haste desce até o topo da peça defeituosa, empurra e depois recolhe."""
    topo = BELT_Y0 - 14
    fim = topo
    for p in pecas:
        if not p["defeito"]:
            continue
        t_pistao = p["t_nascimento"] + (X_PISTAO + 80) / VELOCIDADE
        dt = t - t_pistao
        y_contato = p["y"] - 30
        if -0.15 <= dt < 0:
            # desce até encostar na peça enquanto ela chega
            fim = max(fim, topo + (y_contato - topo) * (1 + dt / 0.15))
        elif 0 <= dt <= DURACAO_EMPURRAO:
            k = dt / DURACAO_EMPURRAO
            fim = max(fim, y_contato + QUEDA * k * k * 0.55)
        elif DURACAO_EMPURRAO < dt <= DURACAO_EMPURRAO + 0.4:
            k = (dt - DURACAO_EMPURRAO) / 0.4
            alto = y_contato + QUEDA * 0.55
            fim = max(fim, alto + (topo - alto) * k)
    d.rectangle((X_PISTAO - 22, 92, X_PISTAO + 22, topo), fill=(60, 62, 68), outline=(84, 86, 92))
    if fim > topo:
        d.rectangle((X_PISTAO - 5, topo, X_PISTAO + 5, fim), fill=PISTAO)
        d.rectangle((X_PISTAO - 16, fim - 6, X_PISTAO + 16, fim), fill=PISTAO)


def contagens_esperadas(pecas):
    def conta(filtro):
        r = {"total": 0, "disco": 0, "bloco": 0, "barra": 0}
        for p in pecas:
            if filtro(p):
                r["total"] += 1
                r[p["tipo"]] += 1
        return r

    return {
        "entrada": conta(lambda p: True),
        "inspecao": conta(lambda p: True),
        "defeituosas": conta(lambda p: p["defeito"]),
        "embalagem": conta(lambda p: not p["defeito"]),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--duracao", type=float, default=60.0)
    ap.add_argument("--saida", default=str(Path(__file__).resolve().parent.parent / "public" / "amostra"))
    args = ap.parse_args()

    saida = Path(args.saida)
    saida.mkdir(parents=True, exist_ok=True)
    pecas = gerar_pecas(args.seed, args.duracao)
    ruido = np.random.default_rng(args.seed)
    n_quadros = int(args.duracao * FPS)

    webm = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
         "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "36", "-deadline", "good", "-cpu-used", "5", "-row-mt", "1",
         "-pix_fmt", "yuv420p", str(saida / "esteira.webm")],
        stdin=subprocess.PIPE,
    )
    mp4 = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
         "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
         str(saida / "esteira.mp4")],
        stdin=subprocess.PIPE,
    )

    for i in range(n_quadros):
        t = i / FPS
        img, d = quadro_base(t)
        for p in pecas:
            pos = posicao(p, t)
            if pos:
                desenhar_peca(d, p, *pos)
        desenhar_pistao(d, t, pecas)
        arr = np.asarray(img, dtype=np.int16)
        arr = arr + ruido.normal(0, 4, arr.shape).astype(np.int16)
        arr = (arr * (1 + 0.03 * math.sin(t * 1.7))).clip(0, 255).astype(np.uint8)
        dados = arr.tobytes()
        webm.stdin.write(dados)
        mp4.stdin.write(dados)

    for proc in (webm, mp4):
        proc.stdin.close()
        proc.wait()

    gabarito = {
        "descricao": "Linha fictícia gerada por scripts/gerar_video.py. Use para medir a precisão do detector.",
        "seed": args.seed,
        "duracao_s": args.duracao,
        "fps": FPS,
        "largura": W,
        "altura": H,
        "linhas": LINHAS,
        "faixa_esteira": [BELT_Y0, BELT_Y1],
        "pecas": [
            {"id": p["id"], "tipo": p["tipo"], "defeito": p["defeito"],
             "t_entrada": round(p["t_nascimento"] + (LINHAS["entrada"] * W + 80) / VELOCIDADE, 2)}
            for p in pecas
        ],
        "esperado": contagens_esperadas(pecas),
    }
    (saida / "gabarito.json").write_text(json.dumps(gabarito, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{len(pecas)} peças, {sum(p['defeito'] for p in pecas)} com defeito")
    print(json.dumps(gabarito["esperado"], ensure_ascii=False))


if __name__ == "__main__":
    main()
