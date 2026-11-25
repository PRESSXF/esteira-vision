import { CONFIG_PADRAO, type Config, type Deteccao, type Quadro, type TipoPeca } from './tipos';

/** Pixel com tom de oxidação: bem mais vermelho que azul e com brilho suficiente. */
export function ehOxidacao(r: number, g: number, b: number): boolean {
  return r > 110 && r - b > 60 && r - g > 35;
}

/**
 * Classifica a forma por atributos que não mudam com a rotação da peça:
 * - alongamento: razão entre o maior e o menor eixo (momentos de segunda ordem);
 * - compacidade: área dividida pela área do círculo que envolve a peça.
 * Disco: alongamento ~1 e compacidade ~1. Bloco: alongamento ~1 e compacidade ~0,64.
 * Barra: alongamento alto.
 */
export function classificarForma(alongamento: number, compacidade: number): TipoPeca {
  if (alongamento > 2) return 'barra';
  if (compacidade > 0.8) return 'disco';
  return 'bloco';
}

/**
 * Encontra as peças num quadro: separa o que é mais claro que a esteira,
 * agrupa pixels vizinhos (componentes conectados, vizinhança 8) e mede cada grupo.
 */
export function detectar(quadro: Quadro, config: Config = CONFIG_PADRAO): Deteccao[] {
  const { dados, largura: w, altura: h, canais } = quadro;
  const y0 = Math.max(0, Math.floor(config.faixa[0] * h));
  const y1 = Math.min(h, Math.ceil(config.faixa[1] * h));
  const rh = y1 - y0;
  if (rh <= 0) return [];

  const n = w * rh;
  const rotulo = new Int32Array(n);
  const pai: number[] = [0];
  const oxid = new Uint8Array(n);

  const achar = (a: number): number => {
    while (pai[a] !== a) {
      pai[a] = pai[pai[a]];
      a = pai[a];
    }
    return a;
  };
  const unir = (a: number, b: number) => {
    const ra = achar(a);
    const rb = achar(b);
    if (ra !== rb) pai[Math.max(ra, rb)] = Math.min(ra, rb);
  };

  // 1ª passada: máscara e rótulos provisórios
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < w; x++) {
      const p = ((y + y0) * w + x) * canais;
      const r = dados[p];
      const g = dados[p + 1];
      const b = dados[p + 2];
      const brilho = 0.299 * r + 0.587 * g + 0.114 * b;
      const ox = ehOxidacao(r, g, b);
      if (!(brilho > config.limiarBrilho || ox)) continue;
      const i = y * w + x;
      if (ox) oxid[i] = 1;
      const vizinhos: number[] = [];
      if (x > 0 && rotulo[i - 1]) vizinhos.push(rotulo[i - 1]);
      if (y > 0) {
        const acima = i - w;
        if (rotulo[acima]) vizinhos.push(rotulo[acima]);
        if (x > 0 && rotulo[acima - 1]) vizinhos.push(rotulo[acima - 1]);
        if (x < w - 1 && rotulo[acima + 1]) vizinhos.push(rotulo[acima + 1]);
      }
      if (vizinhos.length === 0) {
        const novo = pai.length;
        pai.push(novo);
        rotulo[i] = novo;
      } else {
        const menor = Math.min(...vizinhos);
        rotulo[i] = menor;
        for (const v of vizinhos) unir(menor, v);
      }
    }
  }

  // 2ª passada: somatórios por componente
  interface Soma {
    area: number;
    sx: number;
    sy: number;
    sxx: number;
    syy: number;
    sxy: number;
    ox: number;
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  }
  const somas = new Map<number, Soma>();
  for (let i = 0; i < n; i++) {
    if (!rotulo[i]) continue;
    const raiz = achar(rotulo[i]);
    rotulo[i] = raiz;
    const x = i % w;
    const y = (i - x) / w;
    let s = somas.get(raiz);
    if (!s) {
      s = { area: 0, sx: 0, sy: 0, sxx: 0, syy: 0, sxy: 0, ox: 0, x0: x, y0: y, x1: x, y1: y };
      somas.set(raiz, s);
    }
    s.area++;
    s.sx += x;
    s.sy += y;
    s.sxx += x * x;
    s.syy += y * y;
    s.sxy += x * y;
    s.ox += oxid[i];
    if (x < s.x0) s.x0 = x;
    if (x > s.x1) s.x1 = x;
    if (y < s.y0) s.y0 = y;
    if (y > s.y1) s.y1 = y;
  }

  const validos = [...somas.entries()].filter(([, s]) => s.area >= config.areaMinima);
  const centro = new Map<number, { cx: number; cy: number; r2: number }>();
  for (const [raiz, s] of validos) centro.set(raiz, { cx: s.sx / s.area, cy: s.sy / s.area, r2: 0 });

  // 3ª passada: raio máximo a partir do centro, para a compacidade
  if (centro.size) {
    for (let i = 0; i < n; i++) {
      const c = rotulo[i] ? centro.get(rotulo[i]) : undefined;
      if (!c) continue;
      const x = i % w;
      const y = (i - x) / w;
      const d2 = (x - c.cx) ** 2 + (y - c.cy) ** 2;
      if (d2 > c.r2) c.r2 = d2;
    }
  }

  const deteccoes: Deteccao[] = [];
  for (const [raiz, s] of validos) {
    const c = centro.get(raiz)!;
    const mxx = s.sxx / s.area - c.cx * c.cx;
    const myy = s.syy / s.area - c.cy * c.cy;
    const mxy = s.sxy / s.area - c.cx * c.cy;
    const tr = mxx + myy;
    const det = mxx * myy - mxy * mxy;
    const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
    const l1 = tr / 2 + disc;
    const l2 = Math.max(1e-6, tr / 2 - disc);
    const alongamento = Math.sqrt(l1 / l2);
    // +0,5 compensa o pixel discreto no raio
    const raio = Math.sqrt(c.r2) + 0.5;
    const compacidade = s.area / (Math.PI * raio * raio);
    const fracaoOxidacao = s.ox / s.area;
    const naBorda = s.x0 <= 0 || s.x1 >= w - 1 || s.y0 <= 0 || s.y1 >= rh - 1;
    deteccoes.push({
      cx: c.cx,
      cy: c.cy + y0,
      area: s.area,
      caixa: { x0: s.x0, y0: s.y0 + y0, x1: s.x1, y1: s.y1 + y0 },
      alongamento,
      compacidade,
      fracaoOxidacao,
      tipo: classificarForma(alongamento, compacidade),
      defeito: fracaoOxidacao > config.limiarDefeito,
      naBorda,
    });
  }
  return deteccoes;
}
