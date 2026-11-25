export type TipoPeca = 'disco' | 'bloco' | 'barra';
export const TIPOS: TipoPeca[] = ['disco', 'bloco', 'barra'];

export type Etapa = 'entrada' | 'inspecao' | 'embalagem';
export const ETAPAS: Etapa[] = ['entrada', 'inspecao', 'embalagem'];

export const NOME_ETAPA: Record<Etapa, string> = {
  entrada: 'Entrada',
  inspecao: 'Inspeção',
  embalagem: 'Embalagem',
};

export const NOME_TIPO: Record<TipoPeca, string> = {
  disco: 'Disco',
  bloco: 'Bloco',
  barra: 'Barra',
};

/** Quadro em pixels RGBA (como ImageData) ou RGB, já na resolução de análise. */
export interface Quadro {
  dados: Uint8ClampedArray | Uint8Array;
  largura: number;
  altura: number;
  /** 4 para RGBA (canvas), 3 para RGB (ffmpeg). */
  canais: 3 | 4;
}

export interface Config {
  /** Faixa vertical da esteira analisada, em fração da altura (0 a 1). */
  faixa: [number, number];
  /** Posição horizontal de cada linha de contagem, em fração da largura. */
  linhas: Record<Etapa, number>;
  /** Brilho mínimo (0 a 255) para um pixel contar como peça. */
  limiarBrilho: number;
  /** Área mínima de uma peça, em pixels na resolução de análise. */
  areaMinima: number;
  /** Fração de pixels de oxidação acima da qual a peça é marcada com defeito. */
  limiarDefeito: number;
  /** Distância máxima, em pixels, para ligar uma detecção a uma peça já rastreada. */
  distanciaMaxima: number;
  /** Quadros sem ver a peça antes de encerrar o rastro. */
  quadrosPerdidos: number;
}

export const CONFIG_PADRAO: Config = {
  faixa: [0.33, 0.71],
  linhas: { entrada: 0.15, inspecao: 0.45, embalagem: 0.85 },
  limiarBrilho: 100,
  areaMinima: 250,
  limiarDefeito: 0.03,
  distanciaMaxima: 28,
  quadrosPerdidos: 6,
};

export interface Deteccao {
  cx: number;
  cy: number;
  area: number;
  caixa: { x0: number; y0: number; x1: number; y1: number };
  alongamento: number;
  compacidade: number;
  fracaoOxidacao: number;
  tipo: TipoPeca;
  defeito: boolean;
  /** Toca a borda da área analisada: a forma pode estar cortada. */
  naBorda: boolean;
}

export interface Rastro {
  id: number;
  cx: number;
  cy: number;
  vx: number;
  vy: number;
  ultimo: Deteccao;
  votosTipo: Record<TipoPeca, number>;
  votosDefeito: number;
  votosValidos: number;
  cruzou: Partial<Record<Etapa, number>>;
  quadrosSemVer: number;
  inicio: number;
  fim: number;
  rejeitada: boolean;
}

export interface Evento {
  t: number;
  tipo: 'passagem' | 'rejeicao';
  etapa?: Etapa;
  rastroId: number;
  peca: TipoPeca;
  defeito: boolean;
}
