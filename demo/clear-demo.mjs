#!/usr/bin/env node
/**
 * clear-demo.mjs — Remove os clientes de demonstração (prefixo cli_demo_) e,
 * por cascata (ON DELETE CASCADE), as respetivas parcelas.
 *
 * USO:
 *   node clear-demo.mjs --base https://vyavenaadv.com --email <login> --password <senha>
 *   node clear-demo.mjs --base http://localhost:8787 --token <JWT>
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const BASE = (arg('base') || 'http://localhost:8787').replace(/\/$/, '');
const EMAIL = arg('email'); const PASSWORD = arg('password'); let TOKEN = arg('token');

async function api(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = {}; try { data = await res.json(); } catch {}
  return { status: res.status, ok: res.ok, data };
}
async function login() {
  if (TOKEN) return TOKEN;
  if (!EMAIL || !PASSWORD) { console.error('✖ Faltam credenciais (--email/--password ou --token).'); process.exit(1); }
  const r = await api('/api/auth/login', { method: 'POST', body: { email: EMAIL, password: PASSWORD } });
  if (!r.ok || !r.data.token) { console.error('✖ Login falhou:', r.status, r.data.error || r.data); process.exit(1); }
  return r.data.token;
}
async function main() {
  const { clients } = JSON.parse(await readFile(join(__dirname, 'demo-data.json'), 'utf-8'));
  const token = await login();
  let n = 0;
  for (const c of clients) {
    const r = await api(`/api/clients/${c.id}`, { method: 'DELETE', token });
    if (r.ok) { n++; console.log(`  ✔ removido ${c.name}`); }
    else console.log(`  • ${c.name}: ${r.status} ${r.data.error || ''}`);
  }
  console.log(`\n✔ ${n} clientes de demonstração removidos (parcelas removidas por cascata).`);
}
main().catch((e) => { console.error('Erro:', e.message); process.exit(1); });
