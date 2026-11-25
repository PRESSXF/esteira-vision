import { useEffect, useMemo, useRef, useState } from 'react';
import { useDetector, type Retrato } from './useDetector';
import type { PorTipo } from './visao/estatisticas';
import { CONFIG_PADRAO, ETAPAS, NOME_ETAPA, NOME_TIPO, TIPOS, type Config, type Evento } from './visao/tipos';

interface Gabarito {
  fps: number;
  largura: number;
  linhas: Record<string, number>;
  pecas: { id: number; tipo: string; defeito: boolean; t_entrada: number }[];
  esperado: Record<'entrada' | 'inspecao' | 'defeituosas' | 'embalagem', PorTipo>;
}

const AMOSTRA = { webm: '/amostra/esteira.webm', mp4: '/amostra/esteira.mp4', gabarito: '/amostra/gabarito.json' };
const VELOCIDADE_AMOSTRA = 200; // px/s no vídeo de exemplo, para o gabarito ao vivo

export function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const camadaRef = useRef<HTMLCanvasElement>(null);
  const [config, setConfig] = useState<Config>(CONFIG_PADRAO);
  const [fonte, setFonte] = useState<{ tipo: 'amostra' } | { tipo: 'arquivo'; url: string; nome: string }>({ tipo: 'amostra' });
  const [gabarito, setGabarito] = useState<Gabarito | null>(null);
  const [tocando, setTocando] = useState(false);
  const [velocidade, setVelocidade] = useState(1);
  const [erroVideo, setErroVideo] = useState<string | null>(null);
  const chaveVideo = fonte.tipo === 'amostra' ? 'amostra' : fonte.url;
  const { retrato, reiniciar } = useDetector(videoRef, camadaRef, config, chaveVideo);

  useEffect(() => {
    fetch(AMOSTRA.gabarito)
      .then((r) => r.json())
      .then(setGabarito)
      .catch(() => setGabarito(null));
  }, []);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = velocidade;
  }, [velocidade]);

  useEffect(() => () => {
    if (fonte.tipo === 'arquivo') URL.revokeObjectURL(fonte.url);
  }, [fonte]);

  const ehAmostra = fonte.tipo === 'amostra';

  const alternar = async () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      if (v.ended || retrato.terminou) {
        v.currentTime = 0;
      }
      v.playbackRate = velocidade;
      try {
        await v.play();
      } catch {
        setErroVideo('O navegador não conseguiu reproduzir este vídeo. Tente um arquivo MP4 (H.264) ou WebM.');
      }
    } else {
      v.pause();
    }
  };

  const recomecar = () => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    v.currentTime = 0;
    reiniciar();
  };

  const escolherArquivo = (arquivo: File | undefined) => {
    if (!arquivo) return;
    setErroVideo(null);
    reiniciar();
    setFonte({ tipo: 'arquivo', url: URL.createObjectURL(arquivo), nome: arquivo.name });
  };

  const usarAmostra = () => {
    setErroVideo(null);
    reiniciar();
    setConfig(CONFIG_PADRAO);
    setFonte({ tipo: 'amostra' });
  };

  const mudarConfig = (parcial: Partial<Config>) => {
    reiniciar();
    const v = videoRef.current;
    if (v) {
      v.pause();
      v.currentTime = 0;
    }
    setConfig((c) => ({ ...c, ...parcial }));
  };

  return (
    <div className="pagina">
      <header className="topo">
        <div className="marca">
          <h1>Esteira</h1>
          <p>
            Conta e identifica peças numa esteira a partir de vídeo, etapa por etapa, e separa as que têm defeito.
            A análise roda no seu navegador: nenhum quadro sai do seu computador.
          </p>
        </div>
        <div className="fonte" role="group" aria-label="Vídeo analisado">
          <button className={ehAmostra ? 'ativo' : ''} onClick={usarAmostra} aria-pressed={ehAmostra}>
            Vídeo de exemplo
          </button>
          <label className={`botao-arquivo ${!ehAmostra ? 'ativo' : ''}`}>
            {ehAmostra ? 'Analisar meu vídeo' : fonte.nome}
            <input type="file" accept="video/*" onChange={(e) => escolherArquivo(e.target.files?.[0])} />
          </label>
        </div>
      </header>

      <main>
        <section className="linha" aria-label="Linha de produção">
          <div className="palco">
            <video
              ref={videoRef}
              key={chaveVideo}
              muted
              playsInline
              preload="auto"
              crossOrigin="anonymous"
              onPlay={() => setTocando(true)}
              onPause={() => setTocando(false)}
              onEnded={() => setTocando(false)}
              onError={() => setErroVideo('Não foi possível abrir este vídeo. Use um arquivo MP4 (H.264) ou WebM.')}
            >
              {ehAmostra ? (
                <>
                  <source src={AMOSTRA.webm} type="video/webm" />
                  <source src={AMOSTRA.mp4} type="video/mp4" />
                </>
              ) : (
                <source src={fonte.url} />
              )}
            </video>
            <div
              className="faixa"
              style={{ top: `${config.faixa[0] * 100}%`, height: `${(config.faixa[1] - config.faixa[0]) * 100}%` }}
              aria-hidden
            >
              {ETAPAS.map((e) => (
                <span key={e} className="sensor" style={{ left: `${config.linhas[e] * 100}%` }} />
              ))}
            </div>
            <canvas ref={camadaRef} className="camada" aria-hidden />
            {!tocando && retrato.quadros === 0 && (
              <button className="iniciar-grande" onClick={alternar}>
                Iniciar a linha
              </button>
            )}
          </div>

          <Contadores retrato={retrato} config={config} />

          <div className="controles">
            <button onClick={alternar} className="primario">
              {tocando ? 'Pausar' : retrato.terminou ? 'Rodar de novo' : retrato.quadros ? 'Continuar' : 'Iniciar'}
            </button>
            <button onClick={recomecar} disabled={retrato.quadros === 0 && !tocando}>
              Zerar contagem
            </button>
            <div className="velocidade" role="group" aria-label="Velocidade do vídeo">
              {[1, 2, 4].map((v) => (
                <button key={v} className={velocidade === v ? 'ativo' : ''} aria-pressed={velocidade === v} onClick={() => setVelocidade(v)}>
                  {v}×
                </button>
              ))}
            </div>
            <span className="tempo">
              {formatarTempo(retrato.t)} de {formatarTempo(retrato.duracao)}
              {retrato.msPorQuadro > 0 && <> · análise em {retrato.msPorQuadro.toFixed(1)} ms por quadro</>}
            </span>
          </div>
          {erroVideo && <p className="erro">{erroVideo}</p>}
        </section>

        <div className="grade">
          <section className="bloco tipos">
            <h2>Peças por tipo e etapa</h2>
            <TabelaTipos retrato={retrato} />
          </section>

          <section className="bloco ritmo">
            <h2>Ritmo na entrada</h2>
            <Ritmo retrato={retrato} />
          </section>

          {ehAmostra && gabarito && (
            <section className="bloco conferencia">
              <h2>Conferência com o gabarito</h2>
              <Conferencia retrato={retrato} gabarito={gabarito} />
            </section>
          )}

          <section className="bloco eventos">
            <div className="titulo-com-acao">
              <h2>Registro da linha</h2>
              <button className="discreto" onClick={() => exportarCsv(retrato.eventos)} disabled={!retrato.eventos.length}>
                Baixar CSV
              </button>
            </div>
            <Eventos eventos={retrato.eventos} />
          </section>

          <section className="bloco ajustes">
            <details open={!ehAmostra}>
              <summary>Ajustes do detector</summary>
              <Ajustes config={config} mudar={mudarConfig} />
            </details>
          </section>
        </div>
      </main>

      <footer className="rodape">
        <p>
          Linha, peças e empresa fictícias. O vídeo de exemplo é gerado por um script que também grava o gabarito de cada peça,
          o que permite medir a precisão do detector. Desenvolvido por João Guilherme Gomes de Araújo ·{' '}
          <a href="https://github.com/PRESSXF/esteira-vision">código</a> ·{' '}
          <a href="https://clairix.enterprises/cases">ClairiX</a>
        </p>
      </footer>
    </div>
  );
}

function Contadores({ retrato, config }: { retrato: Retrato; config: Config }) {
  const { est } = retrato;
  return (
    <div className="contadores" aria-live="polite">
      {ETAPAS.map((e) => (
        <div key={e} className={`contador etapa-${e}`} style={{ left: `${config.linhas[e] * 100}%` }}>
          <span className="nome">{NOME_ETAPA[e]}</span>
          <span className="numero">{est.porEtapa[e].total}</span>
          {e === 'inspecao' && est.defeituosas.total > 0 && (
            <span className="nota">{est.defeituosas.total} com defeito</span>
          )}
        </div>
      ))}
      <div
        className="contador refugo"
        style={{ left: `${((config.linhas.inspecao + config.linhas.embalagem) / 2) * 100}%` }}
      >
        <span className="nome">Refugo</span>
        <span className="numero">{est.rejeitadas.total}</span>
      </div>
    </div>
  );
}

function TabelaTipos({ retrato }: { retrato: Retrato }) {
  const { est } = retrato;
  const colunas: { chave: string; nome: string; v: (t: keyof PorTipo) => number }[] = [
    { chave: 'entrada', nome: 'Entrada', v: (t) => est.porEtapa.entrada[t] },
    { chave: 'inspecao', nome: 'Inspeção', v: (t) => est.porEtapa.inspecao[t] },
    { chave: 'defeito', nome: 'Com defeito', v: (t) => est.defeituosas[t] },
    { chave: 'refugo', nome: 'Refugo', v: (t) => est.rejeitadas[t] },
    { chave: 'embalagem', nome: 'Embalagem', v: (t) => est.porEtapa.embalagem[t] },
  ];
  return (
    <div className="rolagem">
    <table>
      <thead>
        <tr>
          <th scope="col">Peça</th>
          {colunas.map((c) => (
            <th key={c.chave} scope="col">
              {c.nome}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {TIPOS.map((t) => (
          <tr key={t}>
            <th scope="row">
              <span className={`icone icone-${t}`} aria-hidden />
              {NOME_TIPO[t]}
            </th>
            {colunas.map((c) => (
              <td key={c.chave}>{c.v(t)}</td>
            ))}
          </tr>
        ))}
        <tr className="soma">
          <th scope="row">Total</th>
          {colunas.map((c) => (
            <td key={c.chave}>{c.v('total')}</td>
          ))}
        </tr>
      </tbody>
    </table>
    </div>
  );
}

function Ritmo({ retrato }: { retrato: Retrato }) {
  const { ritmo } = retrato.est;
  const janelas = Math.max(6, Math.ceil((retrato.duracao || 60) / 10));
  const dados = Array.from({ length: janelas }, (_, i) => ritmo[i]?.pecas ?? 0);
  const max = Math.max(60, ...dados);
  const W = 320;
  const H = 120;
  const bw = W / janelas;
  const media = retrato.t > 0 ? Math.round((retrato.est.porEtapa.entrada.total * 60) / retrato.t) : 0;
  return (
    <div>
      <p className="destaque">
        <strong>{media}</strong> peças por minuto, em média
      </p>
      <svg viewBox={`0 0 ${W} ${H + 18}`} role="img" aria-label={`Peças por minuto em janelas de 10 segundos; média de ${media}`}>
        <line x1={0} x2={W} y1={H} y2={H} className="eixo" />
        {dados.map((p, i) => {
          const h = (p / max) * (H - 8);
          return (
            <g key={i}>
              <rect x={i * bw + 3} y={H - h} width={bw - 6} height={h} className="barra-ritmo" rx={2} />
              {i % 2 === 0 && (
                <text x={i * bw + bw / 2} y={H + 14} textAnchor="middle" className="rotulo-eixo">
                  {i * 10}s
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function Conferencia({ retrato, gabarito }: { retrato: Retrato; gabarito: Gabarito }) {
  const { est, t, terminou } = retrato;
  const ateAgora = useMemo(() => {
    const W = gabarito.largura;
    const ate = (pos: number) => (p: Gabarito['pecas'][number]) =>
      p.t_entrada + ((pos - gabarito.linhas.entrada) * W) / VELOCIDADE_AMOSTRA <= t;
    return {
      entrada: gabarito.pecas.filter(ate(gabarito.linhas.entrada)).length,
      embalagem: gabarito.pecas.filter((p) => !p.defeito).filter(ate(gabarito.linhas.embalagem)).length,
    };
  }, [gabarito, t]);

  if (!terminou) {
    return (
      <div className="conf-ao-vivo">
        <p>O gabarito registra cada peça do vídeo. Até agora, ele espera:</p>
        <dl>
          <div>
            <dt>Entrada</dt>
            <dd>
              {est.porEtapa.entrada.total} contadas de {ateAgora.entrada}
            </dd>
          </div>
          <div>
            <dt>Embalagem</dt>
            <dd>
              {est.porEtapa.embalagem.total} contadas de {ateAgora.embalagem}
            </dd>
          </div>
        </dl>
        <p className="nota-pequena">Deixe o vídeo chegar ao fim para ver a conferência completa, por tipo.</p>
      </div>
    );
  }

  const linhas: { nome: string; obtido: PorTipo; esperado: PorTipo }[] = [
    { nome: 'Entrada', obtido: est.porEtapa.entrada, esperado: gabarito.esperado.entrada },
    { nome: 'Inspeção', obtido: est.porEtapa.inspecao, esperado: gabarito.esperado.inspecao },
    { nome: 'Com defeito', obtido: est.defeituosas, esperado: gabarito.esperado.defeituosas },
    { nome: 'Refugo', obtido: est.rejeitadas, esperado: gabarito.esperado.defeituosas },
    { nome: 'Embalagem', obtido: est.porEtapa.embalagem, esperado: gabarito.esperado.embalagem },
  ];
  const chaves: (keyof PorTipo)[] = ['total', ...TIPOS];
  let iguais = 0;
  for (const l of linhas) for (const k of chaves) if (l.obtido[k] === l.esperado[k]) iguais++;
  const total = linhas.length * chaves.length;
  return (
    <div>
      <p className="destaque">
        <strong>
          {iguais} de {total}
        </strong>{' '}
        contagens iguais ao gabarito
      </p>
      <div className="rolagem">
      <table className="tabela-conf">
        <thead>
          <tr>
            <th scope="col">Medida</th>
            {chaves.map((k) => (
              <th key={k} scope="col">
                {k === 'total' ? 'Total' : NOME_TIPO[k]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.nome}>
              <th scope="row">{l.nome}</th>
              {chaves.map((k) => (
                <td key={k} className={l.obtido[k] === l.esperado[k] ? 'ok' : 'difere'}>
                  {l.obtido[k]}/{l.esperado[k]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <p className="nota-pequena">Cada célula mostra contado pelo detector / registrado no gabarito.</p>
    </div>
  );
}

function Eventos({ eventos }: { eventos: Evento[] }) {
  if (!eventos.length) {
    return <p className="vazio">Os eventos aparecem aqui quando a primeira peça cruzar a entrada.</p>;
  }
  return (
    <ol className="lista-eventos">
      {eventos.map((e, i) => (
        <li key={`${e.rastroId}-${e.tipo}-${e.etapa ?? ''}-${i}`} className={e.tipo === 'rejeicao' ? 'rejeicao' : e.defeito ? 'com-defeito' : ''}>
          <span className="t">{formatarTempo(e.t, true)}</span>
          <span className="desc">
            {e.tipo === 'rejeicao' ? (
              <>Peça {e.rastroId} ({NOME_TIPO[e.peca].toLowerCase()}) retirada para o refugo</>
            ) : (
              <>
                Peça {e.rastroId} ({NOME_TIPO[e.peca].toLowerCase()}
                {e.defeito ? ', com defeito' : ''}) passou pela {NOME_ETAPA[e.etapa!].toLowerCase()}
              </>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Ajustes({ config, mudar }: { config: Config; mudar: (c: Partial<Config>) => void }) {
  return (
    <div className="campos">
      <p className="nota-pequena">
        Para o seu vídeo: posicione a faixa sobre a esteira e as linhas onde ficam os sensores. Mudar um ajuste zera a contagem.
      </p>
      <Faixa
        rotulo="Brilho mínimo da peça"
        valor={config.limiarBrilho}
        min={40}
        max={220}
        passo={5}
        formato={(v) => String(v)}
        mudar={(v) => mudar({ limiarBrilho: v })}
      />
      <Faixa
        rotulo="Área mínima da peça"
        valor={config.areaMinima}
        min={50}
        max={1500}
        passo={25}
        formato={(v) => `${v} px`}
        mudar={(v) => mudar({ areaMinima: v })}
      />
      <Faixa
        rotulo="Topo da esteira"
        valor={config.faixa[0]}
        min={0}
        max={0.9}
        passo={0.01}
        formato={pct}
        mudar={(v) => mudar({ faixa: [Math.min(v, config.faixa[1] - 0.05), config.faixa[1]] })}
      />
      <Faixa
        rotulo="Base da esteira"
        valor={config.faixa[1]}
        min={0.1}
        max={1}
        passo={0.01}
        formato={pct}
        mudar={(v) => mudar({ faixa: [config.faixa[0], Math.max(v, config.faixa[0] + 0.05)] })}
      />
      {ETAPAS.map((e) => (
        <Faixa
          key={e}
          rotulo={`Linha da ${NOME_ETAPA[e].toLowerCase()}`}
          valor={config.linhas[e]}
          min={0.02}
          max={0.98}
          passo={0.01}
          formato={pct}
          mudar={(v) => mudar({ linhas: { ...config.linhas, [e]: v } })}
        />
      ))}
    </div>
  );
}

function Faixa(props: { rotulo: string; valor: number; min: number; max: number; passo: number; formato: (v: number) => string; mudar: (v: number) => void }) {
  const id = `campo-${props.rotulo.replace(/\W+/g, '-')}`;
  return (
    <div className="campo">
      <label htmlFor={id}>
        {props.rotulo} <output htmlFor={id}>{props.formato(props.valor)}</output>
      </label>
      <input
        id={id}
        type="range"
        min={props.min}
        max={props.max}
        step={props.passo}
        value={props.valor}
        onChange={(e) => props.mudar(Number(e.target.value))}
      />
    </div>
  );
}

function pct(v: number) {
  return `${Math.round(v * 100)}%`;
}

function formatarTempo(s: number, decimos = false) {
  if (!Number.isFinite(s)) s = 0;
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  const seg = decimos ? r.toFixed(1).padStart(4, '0') : String(Math.floor(r)).padStart(2, '0');
  return `${m}:${seg}`;
}

function exportarCsv(eventosRecentes: Evento[]) {
  const linhas = [['tempo_s', 'evento', 'etapa', 'peca_id', 'tipo', 'defeito']];
  for (const e of [...eventosRecentes].reverse()) {
    linhas.push([e.t.toFixed(2), e.tipo, e.etapa ?? '', String(e.rastroId), e.peca, e.defeito ? 'sim' : 'não']);
  }
  const blob = new Blob(['﻿' + linhas.map((l) => l.join(';')).join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'esteira-eventos.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}
