import { useCallback, useEffect, useRef, useState } from 'react';
import { calcular, type Estatisticas } from './visao/estatisticas';
import { defeitoDoRastro, Rastreador, tipoDoRastro } from './visao/rastreador';
import { detectar } from './visao/segmentacao';
import { NOME_TIPO, type Config, type Evento } from './visao/tipos';

/** Largura em que a análise roda. Menos pixels, mais quadros por segundo. */
const LARGURA_ANALISE = 480;

export interface Retrato {
  t: number;
  duracao: number;
  est: Estatisticas;
  eventos: Evento[];
  msPorQuadro: number;
  quadros: number;
  terminou: boolean;
}

const VAZIO: Retrato = {
  t: 0,
  duracao: 0,
  est: calcular([], 1),
  eventos: [],
  msPorQuadro: 0,
  quadros: 0,
  terminou: false,
};

type VideoComRvfc = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (agora: number, meta: { mediaTime: number }) => void) => number;
  cancelVideoFrameCallback?: (id: number) => void;
};

/**
 * Liga o detector ao vídeo: a cada quadro exibido, reduz a imagem, encontra as peças,
 * atualiza o rastreamento e desenha as caixas na camada por cima do vídeo.
 */
export function useDetector(
  videoRef: React.RefObject<HTMLVideoElement>,
  camadaRef: React.RefObject<HTMLCanvasElement>,
  config: Config,
  /** Muda quando o vídeo é trocado: o elemento é recriado e o detector precisa se ligar ao novo. */
  chaveVideo: string,
) {
  const [retrato, setRetrato] = useState<Retrato>(VAZIO);
  const rastreador = useRef<Rastreador | null>(null);
  const analise = useRef<{ canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null>(null);
  const tempos = useRef<number[]>([]);
  const ultimoRetrato = useRef(0);
  const quadros = useRef(0);
  const configRef = useRef(config);
  configRef.current = config;

  const reiniciar = useCallback(() => {
    rastreador.current = null;
    tempos.current = [];
    quadros.current = 0;
    setRetrato(VAZIO);
    const camada = camadaRef.current;
    camada?.getContext('2d')?.clearRect(0, 0, camada.width, camada.height);
  }, [camadaRef]);

  useEffect(() => {
    rastreador.current = null;
  }, [config]);

  useEffect(() => {
    const video = videoRef.current as VideoComRvfc | null;
    const camada = camadaRef.current;
    if (!video || !camada) return;
    let id = 0;
    let parado = false;

    const publicar = (t: number, terminou: boolean) => {
      const r = rastreador.current;
      if (!r) return;
      const ts = tempos.current;
      setRetrato({
        t,
        duracao: video.duration || t,
        est: calcular(r.todos(), Math.max(t, 1)),
        eventos: r.eventos.slice(-40).reverse(),
        msPorQuadro: ts.length ? ts.reduce((a, b) => a + b, 0) / ts.length : 0,
        quadros: quadros.current,
        terminou,
      });
    };

    const processar = (t: number) => {
      if (!video.videoWidth) return;
      const cfg = configRef.current;
      const h = Math.round((LARGURA_ANALISE * video.videoHeight) / video.videoWidth);
      if (!analise.current || analise.current.canvas.height !== h) {
        const canvas = document.createElement('canvas');
        canvas.width = LARGURA_ANALISE;
        canvas.height = h;
        analise.current = { canvas, ctx: canvas.getContext('2d', { willReadFrequently: true })! };
      }
      if (!rastreador.current) rastreador.current = new Rastreador(cfg, LARGURA_ANALISE);
      const { ctx } = analise.current;
      const inicio = performance.now();
      ctx.drawImage(video, 0, 0, LARGURA_ANALISE, h);
      const img = ctx.getImageData(0, 0, LARGURA_ANALISE, h);
      const deteccoes = detectar({ dados: img.data, largura: LARGURA_ANALISE, altura: h, canais: 4 }, cfg);
      rastreador.current.atualizar(deteccoes, t);
      tempos.current.push(performance.now() - inicio);
      if (tempos.current.length > 60) tempos.current.shift();
      quadros.current++;
      desenhar(camada, rastreador.current, LARGURA_ANALISE, h);
      if (performance.now() - ultimoRetrato.current > 120) {
        ultimoRetrato.current = performance.now();
        publicar(t, false);
      }
    };

    const agendar = () => {
      if (parado) return;
      if (video.requestVideoFrameCallback) {
        id = video.requestVideoFrameCallback((_, meta) => {
          if (!video.paused && !video.ended) processar(meta.mediaTime);
          agendar();
        });
      } else {
        id = requestAnimationFrame(() => {
          if (!video.paused && !video.ended) processar(video.currentTime);
          agendar();
        });
      }
    };
    agendar();

    const aoTerminar = () => {
      rastreador.current?.finalizar(video.duration);
      if (rastreador.current) desenhar(camada, rastreador.current, LARGURA_ANALISE, analise.current?.canvas.height ?? 270);
      publicar(video.duration, true);
    };
    const aoBuscar = () => {
      // pular no vídeo quebra a continuidade do rastreamento: recomeça a contagem
      reiniciar();
    };
    video.addEventListener('ended', aoTerminar);
    video.addEventListener('seeking', aoBuscar);
    return () => {
      parado = true;
      if (video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(id);
      cancelAnimationFrame(id);
      video.removeEventListener('ended', aoTerminar);
      video.removeEventListener('seeking', aoBuscar);
    };
  }, [videoRef, camadaRef, reiniciar, chaveVideo]);

  return { retrato, reiniciar };
}

function desenhar(camada: HTMLCanvasElement, r: Rastreador, w: number, h: number) {
  const cssW = camada.clientWidth;
  const cssH = camada.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  if (camada.width !== Math.round(cssW * dpr) || camada.height !== Math.round(cssH * dpr)) {
    camada.width = Math.round(cssW * dpr);
    camada.height = Math.round(cssH * dpr);
  }
  const ctx = camada.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  const sx = cssW / w;
  const sy = cssH / h;
  const pequeno = cssW < 560;
  ctx.font = `600 ${pequeno ? 10 : 12}px "Barlow Semi Condensed", "Barlow", sans-serif`;
  ctx.textBaseline = 'bottom';
  for (const rastro of r.ativos) {
    if (rastro.quadrosSemVer > 0) continue;
    const c = rastro.ultimo.caixa;
    const defeito = defeitoDoRastro(rastro);
    const cor = defeito ? '#e0601f' : '#3fb6ff';
    const x = c.x0 * sx - 3;
    const y = c.y0 * sy - 3;
    const bw = (c.x1 - c.x0) * sx + 6;
    const bh = (c.y1 - c.y0) * sy + 6;
    ctx.lineWidth = 2;
    ctx.strokeStyle = cor;
    ctx.strokeRect(x, y, bw, bh);
    const tipo = NOME_TIPO[tipoDoRastro(rastro)].toLowerCase();
    const rotulo = pequeno ? `${tipo}${defeito ? ' !' : ''}` : `#${rastro.id} ${tipo}${defeito ? ' · defeito' : ''}`;
    const tw = ctx.measureText(rotulo).width + 8;
    const th = pequeno ? 14 : 17;
    ctx.fillStyle = cor;
    ctx.fillRect(x, y - th, tw, th);
    ctx.fillStyle = '#0e141b';
    ctx.fillText(rotulo, x + 4, y - 2);
  }
}
