#!/usr/bin/env node
/**
 * seed-demo.mjs — Carrega os dados de demonstração (demo-data.json) numa
 * instância do sistema Vyvian Avena, via a API privada (/api/clients e /api/installments).
 *
 * USO:
 *   node seed-demo.mjs --base https://vyavenaadv.com --email <login> --password <senha>
 *   node seed-demo.mjs --base http://localhost:8787 --token <JWT já obtido>
 *
 * Notas:
 *   - Não apaga nada. Apenas cria. Se um ID já existir, a API devolve 409 e o script ignora.
 *   - Os clientes de demo têm IDs com prefixo "cli_demo_" e parcelas "inst_cli_demo_..."
 *     para serem fáceis de identificar/remover depois.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function arg(name, def = undefined) {
  const i = process.argv.indexOf('--' + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const BASE = (arg('base') || 'http://localhost:8787').replace(/\/$/, '');
const EMAIL = arg('email');
const PASSWORD = arg('password');
let TOKEN = arg('token');

async function api(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch {}
  return { status: res.status, ok: res.ok, data };
}

async function login() {
  if (TOKEN) return TOKEN;
  if (!EMAIL || !PASSWORD) {
    console.error('✖ Faltam credenciais. Use --email e --password, ou --token.');
    process.exit(1);
  }
  const r = await api('/api/auth/login', { method: 'POST', body: { email: EMAIL, password: PASSWORD } });
  if (!r.ok || !r.data.token) {
    console.error('✖ Login falhou:', r.status, r.data.error || r.data);
    process.exit(1);
  }
  console.log('✔ Autenticado como', EMAIL);
  return r.data.token;
}

async function main() {
  const raw = await readFile(join(__dirname, 'demo-data.json'), 'utf-8');
  const { clients, installments, _meta } = JSON.parse(raw);
  console.log(`→ A carregar dados de demonstração em ${BASE}`);
  console.log(`  ${clients.length} clientes · ${installments.length} parcelas\n`);

  const token = await login();

  let cOk = 0, cSkip = 0, iOk = 0, iSkip = 0;

  for (const c of clients) {
    const r = await api('/api/clients', { method: 'POST', body: c, token });
    if (r.ok) { cOk++; process.stdout.write(`  ✔ cliente ${c.name}\n`); }
    else if (r.status === 409) { cSkip++; process.stdout.write(`  • cliente já existe: ${c.name}\n`); }
    else { console.error(`  ✖ cliente ${c.name}:`, r.status, r.data.error || r.data); }
  }

  for (const i of installments) {
    const r = await api('/api/installments', { method: 'POST', body: i, token });
    if (r.ok) iOk++;
    else if (r.status === 409) iSkip++;
    else console.error(`  ✖ parcela ${i.id}:`, r.status, r.data.error || r.data);
  }

  // Marcar como pagas as parcelas que vêm com status "paid" (a API cria sempre como 'pending')
  let paidOk = 0;
  for (const i of installments.filter((x) => x.status === 'paid')) {
    const r = await api(`/api/installments/${i.id}`, {
      method: 'PATCH', token,
      body: { action: 'mark_paid', paid_date: i.paid_date, payment_method: i.payment_method || undefined },
    });
    if (r.ok) paidOk++;
  }

  console.log('\n── Resumo ─────────────────────────');
  console.log(`  Clientes criados:   ${cOk} (ignorados: ${cSkip})`);
  console.log(`  Parcelas criadas:   ${iOk} (ignoradas: ${iSkip})`);
  console.log(`  Parcelas marcadas pagas: ${paidOk}`);
  console.log('✔ Concluído.');
}

main().catch((e) => { console.error('Erro:', e.message); process.exit(1); });
