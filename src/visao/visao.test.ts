import { describe, expect, it } from 'vitest';
import { calcular } from './estatisticas';
import { Rastreador } from './rastreador';
import { classificarForma, detectar, ehOxidacao } from './segmentacao';
import { CONFIG_PADRAO, type Config, type Quadro, type TipoPeca } from './tipos';

const W = 480;
const H = 270;
// faixa analisada no padrão: y de 89 a 192
const YC = 140;

type Forma = { tipo: TipoPeca; cx: number; cy: number; ang?: number; ferrugem?: boolean };

function dentro(f: Forma, x: number, y: number): boolean {
  const dx = x - f.cx;
  const dy = y - f.cy;
  if (f.tipo === 'disco') return dx * dx + dy * dy <= 16.5 * 16.5;
  const a = f.ang ?? 0;
  const u = dx * Math.cos(a) + dy * Math.sin(a);
  const v = -dx * Math.sin(a) + dy * Math.cos(a);
  const [hw, hh] = f.tipo === 'bloco' ? [15.5, 15.5] : [26, 8];
  return Math.abs(u) <= hw && Math.abs(v) <= hh;
}

function quadro(formas: Forma[]): Quadro {
  const dados = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = (y * W + x) * 4;
      let cor: [number, number, number] = x % 22 < 2 ? [40, 41, 44] : [52, 54, 58];
      for (const f of formas) {
        if (dentro(f, x, y)) {
          const mancha = f.ferrugem && Math.hypot(x - f.cx, y - f.cy) < 6;
          cor = mancha ? [178, 98, 44] : [184, 188, 194];
        }
      }
      dados[p] = cor[0];
      dados[p + 1] = cor[1];
      dados[p + 2] = cor[2];
      dados[p + 3] = 255;
    }
  }
  return { dados, largura: W, altura: H, canais: 4 };
}

describe('segmentação', () => {
  it('ignora a esteira vazia e suas ripas', () => {
    expect(detectar(quadro([]))).toEqual([]);
  });

  it('encontra três peças separadas e mede o centro', () => {
    const d = detectar(quadro([
      { tipo: 'disco', cx: 100, cy: YC },
      { tipo: 'bloco', cx: 200, cy: YC },
      { tipo: 'barra', cx: 320, cy: YC },
    ]));
    expect(d).toHaveLength(3);
    const disco = d.find((x) => Math.abs(x.cx - 100) < 1)!;
    expect(disco.cy).toBeCloseTo(YC, 0);
  });

  it.each([0, 0.4, Math.PI / 4, 1.2])('classifica a forma com a peça girada em %f rad', (ang) => {
    const d = detectar(quadro([
      { tipo: 'disco', cx: 100, cy: YC, ang },
      { tipo: 'bloco', cx: 200, cy: YC, ang },
      { tipo: 'barra', cx: 320, cy: YC, ang },
    ]));
    const porX = [...d].sort((a, b) => a.cx - b.cx).map((x) => x.tipo);
    expect(porX).toEqual(['disco', 'bloco', 'barra']);
  });

  it('marca defeito quando há oxidação e não marca peça limpa', () => {
    const d = detectar(quadro([
      { tipo: 'disco', cx: 100, cy: YC, ferrugem: true },
      { tipo: 'disco', cx: 200, cy: YC },
    ]));
    const [a, b] = [...d].sort((x, y) => x.cx - y.cx);
    expect(a.defeito).toBe(true);
    expect(b.defeito).toBe(false);
  });

  it('ignora o que está fora da faixa da esteira', () => {
    expect(detectar(quadro([{ tipo: 'disco', cx: 100, cy: 30 }]))).toEqual([]);
  });

  it('marca a peça cortada pela borda', () => {
    const [d] = detectar(quadro([{ tipo: 'disco', cx: 5, cy: YC }]));
    expect(d.naBorda).toBe(true);
  });

  it('regras de cor e forma', () => {
    expect(ehOxidacao(178, 98, 44)).toBe(true);
    expect(ehOxidacao(184, 188, 194)).toBe(false);
    expect(classificarForma(3.2, 0.36)).toBe('barra');
    expect(classificarForma(1.05, 0.92)).toBe('disco');
    expect(classificarForma(1.02, 0.63)).toBe('bloco');
  });
});

describe('rastreamento e contagem', () => {
  const config: Config = { ...CONFIG_PADRAO };

  /** Simula peças passando a 100 px/s; a peça com `sai` deixa a esteira em x = sai. */
  function simular(pecas: { tipo: TipoPeca; t0: number; ferrugem?: boolean; sai?: number }[], duracao: number, passo = 1 / 30) {
    const r = new Rastreador(config, W);
    for (let t = 0; t <= duracao; t += passo) {
      const formas: Forma[] = [];
      for (const p of pecas) {
        const x = -20 + (t - p.t0) * 100;
        if (t < p.t0 || x > W + 20) continue;
        if (p.sai !== undefined && x > p.sai) continue;
        formas.push({ tipo: p.tipo, cx: x, cy: YC, ferrugem: p.ferrugem });
      }
      r.atualizar(detectar(quadro(formas), config), t);
    }
    r.finalizar(duracao);
    return r;
  }

  it('conta cada peça uma vez por etapa e separa por tipo', () => {
    const r = simular([
      { tipo: 'disco', t0: 0 },
      { tipo: 'bloco', t0: 1 },
      { tipo: 'barra', t0: 2 },
    ], 8);
    const est = calcular(r.todos(), 8);
    expect(est.porEtapa.entrada).toEqual({ total: 3, disco: 1, bloco: 1, barra: 1 });
    expect(est.porEtapa.embalagem.total).toBe(3);
    expect(est.rejeitadas.total).toBe(0);
  });

  it('detecta a peça defeituosa retirada antes da embalagem', () => {
    const r = simular([
      { tipo: 'disco', t0: 0 },
      { tipo: 'disco', t0: 1, ferrugem: true, sai: 0.56 * W },
    ], 8);
    const est = calcular(r.todos(), 8);
    expect(est.porEtapa.inspecao.total).toBe(2);
    expect(est.defeituosas.total).toBe(1);
    expect(est.rejeitadas.total).toBe(1);
    expect(est.porEtapa.embalagem.total).toBe(1);
    expect(r.eventos.filter((e) => e.tipo === 'rejeicao')).toHaveLength(1);
  });

  it('mantém a contagem com quadros pulados', () => {
    const r = simular([
      { tipo: 'disco', t0: 0 },
      { tipo: 'bloco', t0: 1 },
    ], 8, 4 / 30);
    expect(calcular(r.todos(), 8).porEtapa.embalagem.total).toBe(2);
  });
});
