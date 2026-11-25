/**
 * Avalia o detector contra o gabarito do vídeo de exemplo, quadro a quadro, sem navegador.
 * Uso: npm run avaliar -- [pasta-da-amostra] [--pular N]   (requer ffmpeg)
 *   --pular N  analisa só 1 a cada N quadros, simulando um navegador que perde quadros.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { calcular } from '../src/visao/estatisticas';
import { Rastreador } from '../src/visao/rastreador';
import { detectar } from '../src/visao/segmentacao';
import { CONFIG_PADRAO, ETAPAS, TIPOS } from '../src/visao/tipos';

const LARGURA = 480;
const ALTURA = 270;
const raiz = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const iPular = args.indexOf('--pular');
const pular = iPular >= 0 ? Number(args[iPular + 1]) : 1;
const posicionais = args.filter((a, i) => !a.startsWith('--') && (iPular < 0 || i !== iPular + 1));
const pasta = resolve(raiz, posicionais[0] ?? 'public/amostra');
const video = resolve(pasta, 'esteira.webm');
const gabarito = JSON.parse(readFileSync(resolve(pasta, 'gabarito.json'), 'utf-8'));
const fps: number = gabarito.fps;

const tamanho = LARGURA * ALTURA * 3;
const rastreador = new Rastreador(CONFIG_PADRAO, LARGURA);
let pendente = Buffer.alloc(0);
let quadro = 0;
const inicio = performance.now();

const ff = spawn('ffmpeg', ['-v', 'error', '-i', video, '-vf', `scale=${LARGURA}:${ALTURA}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
ff.stdout.on('data', (parte: Buffer) => {
  pendente = Buffer.concat([pendente, parte]);
  while (pendente.length >= tamanho) {
    const dados = new Uint8Array(pendente.subarray(0, tamanho));
    pendente = pendente.subarray(tamanho);
    const t = quadro / fps;
    if (quadro % pular === 0) {
      rastreador.atualizar(detectar({ dados, largura: LARGURA, altura: ALTURA, canais: 3 }, CONFIG_PADRAO), t);
    }
    quadro++;
  }
});

ff.on('close', () => {
  const ms = performance.now() - inicio;
  rastreador.finalizar(quadro / fps);
  const est = calcular(rastreador.todos(), quadro / fps);
  const esperado = gabarito.esperado;
  const linhas: [string, Record<string, number>, Record<string, number>][] = [
    ...ETAPAS.map((e) => [e, est.porEtapa[e], esperado[e]] as [string, Record<string, number>, Record<string, number>]),
    ['defeituosas', est.defeituosas, esperado.defeituosas],
    ['rejeitadas', est.rejeitadas, esperado.defeituosas],
  ];
  let acertos = 0;
  let total = 0;
  console.log(`\n${quadro} quadros em ${(ms / 1000).toFixed(1)} s (${(ms / quadro).toFixed(1)} ms por quadro)\n`);
  console.log('medida        ' + ['total', ...TIPOS].map((k) => k.padStart(14)).join(''));
  for (const [nome, obtido, alvo] of linhas) {
    const celulas = ['total', ...TIPOS].map((k) => {
      total++;
      if (obtido[k] === alvo[k]) acertos++;
      return `${obtido[k]}/${alvo[k]}${obtido[k] === alvo[k] ? '' : ' ✗'}`.padStart(14);
    });
    console.log(nome.padEnd(14) + celulas.join(''));
  }
  console.log(`\n${acertos} de ${total} contagens iguais ao gabarito (obtido/esperado)`);
  process.exitCode = acertos === total ? 0 : 1;
});
