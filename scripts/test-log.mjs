// scripts/test-log.mjs — corre a suíte e grava um log legível + relatório HTML.
//   npm run test:log
// Produz:
//   tests/ULTIMO-LOG.txt   — saída completa do Vitest (texto, para colar/arquivar)
//   tests/relatorio.html   — relatório navegável (abre no browser)

import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const raiz = process.cwd();
const dir = join(raiz, 'tests');
mkdirSync(dir, { recursive: true });

const jsonTmp = join(dir, '.resultados.json');
const alvo = process.argv.slice(2);

console.log('A correr a suíte de testes…\n');

const r = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['vitest', 'run', '--reporter=verbose', '--reporter=json', '--outputFile.json=' + jsonTmp, ...alvo],
  { encoding: 'utf8', cwd: raiz, shell: process.platform === 'win32' }
);

const saida = (r.stdout || '') + (r.stderr || '');
process.stdout.write(saida);

// ─── log de texto ────────────────────────────────────────────────────────────
const carimbo = new Date().toLocaleString('pt-PT', { timeZone: 'Europe/Lisbon' });
writeFileSync(
  join(dir, 'ULTIMO-LOG.txt'),
  `Suíte de testes — Vyvian Avena Advogada\nExecutada em ${carimbo}\n` +
  `${'='.repeat(72)}\n\n${saida}`,
  'utf8'
);

// ─── relatório HTML ──────────────────────────────────────────────────────────
let dados = null;
try { dados = JSON.parse(readFileSync(jsonTmp, 'utf8')); } catch { /* sem JSON */ }
if (existsSync(jsonTmp)) rmSync(jsonTmp, { force: true });

if (dados) {
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const ficheiros = dados.testResults || [];
  const todos = ficheiros.flatMap((f) => f.assertionResults || []);
  const n = { total: todos.length, ok: 0, falha: 0, saltado: 0 };
  for (const t of todos) {
    if (t.status === 'passed') n.ok++;
    else if (t.status === 'failed') n.falha++;
    else n.saltado++;
  }

  // Testes `it.fails(...)` documentam defeitos conhecidos do código: o Vitest
  // conta-os como "passed" (falharam como era esperado), por isso são invisíveis
  // no total. Contam-se aqui a partir da fonte para aparecerem no relatório.
  let bugs = 0;
  const titulosBug = new Set();
  for (const f of ficheiros) {
    try {
      const src = readFileSync(f.name, 'utf8');
      for (const m of src.matchAll(/it\.fails\(\s*(['"`])([\s\S]*?)\1/g)) {
        bugs++;
        titulosBug.add(m[2].replace(/\$\{[^}]*\}/g, '').trim());
      }
    } catch { /* ficheiro movido — ignorar */ }
  }
  const ehBug = (t) => titulosBug.has(String(t).trim());

  const icone = { passed: '✓', failed: '✕', pending: '○', skipped: '○', todo: '○' };
  const secoes = ficheiros.map((f) => {
    const nome = f.name.replace(raiz, '').replace(/\\/g, '/').replace(/^\//, '');
    const casos = f.assertionResults || [];
    const falhou = casos.some((c) => c.status === 'failed');
    // agrupar por describe (ancestorTitles)
    const grupos = new Map();
    for (const c of casos) {
      const k = (c.ancestorTitles || []).join(' › ') || '(sem grupo)';
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(c);
    }
    const corpo = [...grupos].map(([g, cs]) => `
      <div class="grupo"><h3>${esc(g)}</h3><ul>` +
      cs.map((c) => `<li class="${ehBug(c.title) ? 'bug' : c.status}">` +
        `<span class="i">${ehBug(c.title) ? '!' : (icone[c.status] || '·')}</span>` +
        `<span class="t">${esc(c.title)}</span>` +
        (ehBug(c.title) ? '<span class="etiq">defeito conhecido</span>' : '') +
        (c.duration ? `<span class="ms">${Math.round(c.duration)}ms</span>` : '') +
        (c.failureMessages?.length ? `<pre>${esc(c.failureMessages.join('\n\n'))}</pre>` : '') +
        `</li>`).join('') + `</ul></div>`).join('');
    const okF = casos.filter((c) => c.status === 'passed').length;
    return `<details class="ficheiro ${falhou ? 'mau' : 'bom'}" ${falhou ? 'open' : ''}>
      <summary><span class="i">${falhou ? '✕' : '✓'}</span> ${esc(nome)}
      <span class="cont">${okF}/${casos.length}</span></summary>${corpo}</details>`;
  }).join('\n');

  const html = `<!doctype html><html lang="pt"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Testes — Vyvian Avena Advogada</title><style>
:root{--verde:#12302a;--dourado:#8e6f3f;--ok:#2f7a4f;--mau:#b3261e;--txt:#2c2a26;--sub:#8a8275;--linha:#e8e4dc;--fundo:#faf8f4}
*{box-sizing:border-box}body{margin:0;padding:32px 20px;background:var(--fundo);color:var(--txt);
font:15px/1.6 Georgia,'Times New Roman',serif}
.wrap{max-width:900px;margin:0 auto}
h1{color:var(--verde);font-size:26px;margin:0 0 4px;font-weight:600}
.meta{color:var(--sub);font-size:13px;margin:0 0 24px}
.kpis{display:flex;gap:12px;flex-wrap:wrap;margin:0 0 28px}
.kpi{flex:1;min-width:110px;background:#fff;border:1px solid var(--linha);border-radius:10px;padding:14px 16px}
.kpi b{display:block;font-size:28px;line-height:1.1;color:var(--verde);font-weight:600}
.kpi.mau b{color:var(--mau)} .kpi.ok b{color:var(--ok)}
.kpi span{font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--sub)}
.ficheiro{background:#fff;border:1px solid var(--linha);border-radius:10px;margin:0 0 12px;overflow:hidden}
.ficheiro>summary{cursor:pointer;padding:13px 16px;font-family:ui-monospace,Consolas,monospace;font-size:13px;
list-style:none;display:flex;align-items:center;gap:9px}
.ficheiro>summary::-webkit-details-marker{display:none}
.ficheiro.bom>summary .i{color:var(--ok)} .ficheiro.mau>summary .i{color:var(--mau)}
.cont{margin-left:auto;color:var(--sub);font-size:12px}
.grupo{border-top:1px solid var(--linha);padding:12px 16px 14px}
.grupo h3{margin:0 0 8px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--dourado);font-weight:600}
ul{list-style:none;margin:0;padding:0}
li{display:flex;align-items:baseline;gap:9px;padding:3px 0;font-size:14px;flex-wrap:wrap}
li .i{width:12px;flex:none} li.passed .i{color:var(--ok)} li.failed .i{color:var(--mau)}
li.bug .i{color:var(--dourado);font-weight:700} li.bug .t{color:var(--dourado)}
.etiq{font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:var(--dourado);
border:1px solid currentColor;border-radius:3px;padding:1px 5px;opacity:.75}
.kpi.aviso b{color:var(--dourado)}
li.failed .t{color:var(--mau)} li.pending .i,li.skipped .i,li.todo .i{color:var(--sub)}
li .t{flex:1;min-width:0} .ms{color:var(--sub);font-size:11px;font-variant-numeric:tabular-nums}
pre{flex-basis:100%;margin:6px 0 8px;padding:11px 13px;background:#fdf3f2;border-left:3px solid var(--mau);
border-radius:4px;font:12px/1.5 ui-monospace,Consolas,monospace;white-space:pre-wrap;overflow-x:auto;color:#7d1d17}
@media(prefers-color-scheme:dark){:root{--fundo:#14130f;--txt:#e9e5dc;--linha:#2d2a24;--sub:#9a9284;--verde:#cfe3d6}
body{background:var(--fundo)}.kpi,.ficheiro{background:#1b1a15}pre{background:#2a1a18;color:#f0c9c4}}
</style></head><body><div class="wrap">
<h1>Suíte de testes</h1>
<p class="meta">Vyvian Avena Advogada · ${esc(carimbo)}</p>
<div class="kpis">
  <div class="kpi"><b>${n.total}</b><span>Testes</span></div>
  <div class="kpi ok"><b>${n.ok}</b><span>Passaram</span></div>
  <div class="kpi ${n.falha ? 'mau' : ''}"><b>${n.falha}</b><span>Falharam</span></div>
  <div class="kpi aviso"><b>${bugs}</b><span>Defeitos conhecidos</span></div>
  <div class="kpi"><b>${ficheiros.length}</b><span>Ficheiros</span></div>
</div>
${secoes}
</div></body></html>`;
  writeFileSync(join(dir, 'relatorio.html'), html, 'utf8');
}

console.log(`\nLog gravado em  tests/ULTIMO-LOG.txt`);
if (dados) console.log(`Relatório HTML  tests/relatorio.html`);
process.exit(r.status ?? 0);
