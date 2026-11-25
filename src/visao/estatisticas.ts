import { defeitoDoRastro, tipoDoRastro } from './rastreador';
import { ETAPAS, TIPOS, type Etapa, type Rastro, type TipoPeca } from './tipos';

export type PorTipo = Record<TipoPeca | 'total', number>;

export interface Estatisticas {
  porEtapa: Record<Etapa, PorTipo>;
  /** Peças que a inspeção marcou com defeito. */
  defeituosas: PorTipo;
  /** Peças que passaram pela inspeção e saíram da linha antes da embalagem. */
  rejeitadas: PorTipo;
  /** Peças por minuto na entrada, em janelas de 10 s. */
  ritmo: { t: number; pecas: number }[];
}

function zerado(): PorTipo {
  return { total: 0, disco: 0, bloco: 0, barra: 0 };
}

export function calcular(rastros: Rastro[], duracao: number, janela = 10): Estatisticas {
  const porEtapa = Object.fromEntries(ETAPAS.map((e) => [e, zerado()])) as Record<Etapa, PorTipo>;
  const defeituosas = zerado();
  const rejeitadas = zerado();
  const nJanelas = Math.max(1, Math.ceil(duracao / janela));
  const ritmo = Array.from({ length: nJanelas }, (_, i) => ({ t: i * janela, pecas: 0 }));

  for (const r of rastros) {
    const tipo = tipoDoRastro(r);
    for (const e of ETAPAS) {
      if (r.cruzou[e] !== undefined) {
        porEtapa[e].total++;
        porEtapa[e][tipo]++;
      }
    }
    if (r.cruzou.inspecao !== undefined && defeitoDoRastro(r)) {
      defeituosas.total++;
      defeituosas[tipo]++;
    }
    if (r.rejeitada) {
      rejeitadas.total++;
      rejeitadas[tipo]++;
    }
    const te = r.cruzou.entrada;
    if (te !== undefined) {
      const k = Math.min(nJanelas - 1, Math.floor(te / janela));
      ritmo[k].pecas++;
    }
  }
  for (const j of ritmo) j.pecas = Math.round((j.pecas * 60) / janela);
  return { porEtapa, defeituosas, rejeitadas, ritmo };
}

export { TIPOS };
