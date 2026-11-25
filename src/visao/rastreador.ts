import {
  CONFIG_PADRAO,
  ETAPAS,
  TIPOS,
  type Config,
  type Deteccao,
  type Etapa,
  type Evento,
  type Rastro,
  type TipoPeca,
} from './tipos';

export function tipoDoRastro(r: Rastro): TipoPeca {
  let melhor: TipoPeca = r.ultimo.tipo;
  let votos = -1;
  for (const t of TIPOS) {
    if (r.votosTipo[t] > votos) {
      votos = r.votosTipo[t];
      melhor = t;
    }
  }
  return votos > 0 ? melhor : r.ultimo.tipo;
}

export function defeitoDoRastro(r: Rastro): boolean {
  if (r.votosValidos === 0) return r.ultimo.defeito;
  return r.votosDefeito / r.votosValidos >= 0.5;
}

/**
 * Segue cada peça de um quadro para o outro e registra quando ela cruza uma linha de contagem.
 * A ligação usa a posição prevista pela velocidade da peça, o que tolera quadros pulados.
 */
export class Rastreador {
  private proximoId = 1;
  private ultimoT: number | null = null;
  ativos: Rastro[] = [];
  encerrados: Rastro[] = [];
  eventos: Evento[] = [];

  constructor(
    private config: Config = CONFIG_PADRAO,
    private largura: number,
  ) {}

  private xLinha(e: Etapa) {
    return this.config.linhas[e] * this.largura;
  }

  atualizar(deteccoes: Deteccao[], t: number): Evento[] {
    const dt = this.ultimoT === null ? 1 / 30 : Math.max(1 / 120, t - this.ultimoT);
    this.ultimoT = t;
    const novos: Evento[] = [];

    // pares (rastro, detecção) ordenados pela distância à posição prevista
    const pares: { r: Rastro; d: Deteccao; dist: number }[] = [];
    for (const r of this.ativos) {
      const px = r.cx + r.vx * dt;
      const py = r.cy + r.vy * dt;
      const limite = this.config.distanciaMaxima * (1 + 0.5 * r.quadrosSemVer);
      for (const d of deteccoes) {
        const dist = Math.hypot(d.cx - px, d.cy - py);
        if (dist <= limite) pares.push({ r, d, dist });
      }
    }
    pares.sort((a, b) => a.dist - b.dist);

    const rastrosUsados = new Set<Rastro>();
    const deteccoesUsadas = new Set<Deteccao>();
    for (const { r, d } of pares) {
      if (rastrosUsados.has(r) || deteccoesUsadas.has(d)) continue;
      rastrosUsados.add(r);
      deteccoesUsadas.add(d);
      this.mover(r, d, dt, t, novos);
    }

    for (const d of deteccoes) {
      if (deteccoesUsadas.has(d)) continue;
      const r: Rastro = {
        id: this.proximoId++,
        cx: d.cx,
        cy: d.cy,
        vx: 0,
        vy: 0,
        ultimo: d,
        votosTipo: { disco: 0, bloco: 0, barra: 0 },
        votosDefeito: 0,
        votosValidos: 0,
        cruzou: {},
        quadrosSemVer: 0,
        inicio: t,
        fim: t,
        rejeitada: false,
      };
      this.votar(r, d);
      this.ativos.push(r);
    }

    const seguem: Rastro[] = [];
    for (const r of this.ativos) {
      if (!rastrosUsados.has(r) && r.inicio !== t) r.quadrosSemVer++;
      if (r.quadrosSemVer > this.config.quadrosPerdidos) this.encerrar(r, t, novos);
      else seguem.push(r);
    }
    this.ativos = seguem;
    this.eventos.push(...novos);
    return novos;
  }

  /** Encerra todos os rastros, por exemplo no fim do vídeo. */
  finalizar(t: number): Evento[] {
    const novos: Evento[] = [];
    for (const r of this.ativos) this.encerrar(r, t, novos, true);
    this.ativos = [];
    this.eventos.push(...novos);
    return novos;
  }

  private votar(r: Rastro, d: Deteccao) {
    if (d.naBorda) return;
    r.votosTipo[d.tipo]++;
    r.votosValidos++;
    if (d.defeito) r.votosDefeito++;
  }

  private mover(r: Rastro, d: Deteccao, dt: number, t: number, novos: Evento[]) {
    const vx = (d.cx - r.cx) / dt;
    const vy = (d.cy - r.cy) / dt;
    // média móvel: a velocidade da esteira é estável, o ruído da medida não
    const primeiroMovimento = r.vx === 0 && r.vy === 0;
    r.vx = primeiroMovimento ? vx : 0.7 * r.vx + 0.3 * vx;
    r.vy = primeiroMovimento ? vy : 0.7 * r.vy + 0.3 * vy;
    const xAntes = r.cx;
    r.cx = d.cx;
    r.cy = d.cy;
    r.ultimo = d;
    r.quadrosSemVer = 0;
    r.fim = t;
    this.votar(r, d);
    for (const e of ETAPAS) {
      const L = this.xLinha(e);
      if (r.cruzou[e] === undefined && xAntes < L && d.cx >= L) {
        r.cruzou[e] = t;
        novos.push({ t, tipo: 'passagem', etapa: e, rastroId: r.id, peca: tipoDoRastro(r), defeito: defeitoDoRastro(r) });
      }
    }
  }

  private encerrar(r: Rastro, t: number, novos: Evento[], fimDoVideo = false) {
    // passou pela inspeção, não chegou à embalagem e não saiu pela direita: foi retirada da linha
    const saiuPelaDireita = r.cx >= this.largura - this.config.distanciaMaxima;
    if (!fimDoVideo && r.cruzou.inspecao !== undefined && r.cruzou.embalagem === undefined && !saiuPelaDireita) {
      r.rejeitada = true;
      novos.push({ t, tipo: 'rejeicao', rastroId: r.id, peca: tipoDoRastro(r), defeito: defeitoDoRastro(r) });
    }
    this.encerrados.push(r);
  }

  todos(): Rastro[] {
    return [...this.encerrados, ...this.ativos];
  }
}
