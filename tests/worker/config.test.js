// tests/worker/config.test.js
// Configurações → gestão de utilizadores, permissões e convites por e-mail.
//   handleConfig        (/api/config/users/…)      — autenticado
//   handlePublicConvite (/api/public/convite/…)    — público, validado pelo token
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleConfig, handlePublicConvite, PERMISSOES } from '../../worker/routes/config.js';
import { verifyPassword } from '../../worker/lib/auth.js';
import { criarEnv, req, json, mockFetch } from '../helpers/env.js';

// hash com formato válido mas inútil — só para satisfazer o NOT NULL da coluna
const HASH_FALSO = 'pbkdf2-sha256$1$c2FsdA==$aGFzaA==';
const TOKEN_A = 'a'.repeat(48);
const TOKEN_B = 'b'.repeat(48);
const daqui = (dias) => new Date(Date.now() + dias * 86400000).toISOString();

let env;

async function semear(env, u) {
  await env.DB.prepare(`
    INSERT INTO users (id, email, password_hash, name, initials, role, cargo, phone,
                       permissions, status, invite_token, invite_expires, photo_key, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    u.id, u.email, u.password_hash ?? HASH_FALSO, u.name ?? 'Utilizador',
    u.initials ?? 'U', u.role ?? 'admin', u.cargo ?? null, u.phone ?? null,
    u.permissions_raw ?? JSON.stringify(u.permissions ?? ['*']),
    u.status ?? 'ativo', u.invite_token ?? null, u.invite_expires ?? null,
    u.photo_key ?? null, u.created_at ?? '2026-01-01 10:00:00',
  ).run();
  return u.id;
}

// chama a rota autenticada; `sub` é o utilizador da sessão
function chamar(metodo, caminho, opts = {}, sub = 'usr_dra') {
  const path = caminho.split('?')[0];
  return handleConfig(req(metodo, caminho, opts), env, path, { sub });
}
function publico(metodo, caminho, opts = {}) {
  return handlePublicConvite(req(metodo, caminho, opts), env, caminho.split('?')[0]);
}

beforeEach(async () => {
  env = criarEnv();
  // qualquer criação/reenvio de convite bate no Resend
  vi.stubGlobal('fetch', mockFetch({ json: { id: 'email_1' } }));
  await semear(env, {
    id: 'usr_dra', email: 'dra@exemplo.pt', name: 'Vyvian Avena',
    permissions: ['*'], created_at: '2026-01-01 09:00:00',
  });
});
afterEach(() => vi.unstubAllGlobals());

// ─────────────────────────────────────────────────────────────────────────────
describe('handleConfig — porta de entrada (permissões)', () => {
  it('recusa com 401 quando a sessão aponta para um utilizador que já não existe', async () => {
    const r = await chamar('GET', '/api/config/users', {}, 'usr_fantasma');
    expect(r.status).toBe(401);
    expect((await json(r)).error).toBe('Unauthorized');
  });

  it('recusa com 403 quem não tem gerir_utilizadores', async () => {
    await semear(env, { id: 'usr_ana', email: 'ana@exemplo.pt', permissions: ['painel', 'clientes'] });
    const r = await chamar('GET', '/api/config/users', {}, 'usr_ana');
    expect(r.status).toBe(403);
    expect((await json(r)).error).toMatch(/Sem permissão/);
  });

  it('deixa entrar quem tem a permissão total "*"', async () => {
    expect((await chamar('GET', '/api/config/users')).status).toBe(200);
  });

  it('deixa entrar quem tem gerir_utilizadores explícito', async () => {
    await semear(env, { id: 'usr_gestor', email: 'g@exemplo.pt', permissions: ['painel', 'gerir_utilizadores'] });
    expect((await chamar('GET', '/api/config/users', {}, 'usr_gestor')).status).toBe(200);
  });

  it('trata permissões com JSON corrompido como lista vazia (403 em vez de rebentar)', async () => {
    await semear(env, { id: 'usr_lixo', email: 'lixo@exemplo.pt', permissions_raw: 'não é json' });
    expect((await chamar('GET', '/api/config/users', {}, 'usr_lixo')).status).toBe(403);
  });

  it('trata permissões guardadas como objeto (não lista) como lista vazia', async () => {
    await semear(env, { id: 'usr_obj', email: 'obj@exemplo.pt', permissions_raw: '{"painel":true}' });
    expect((await chamar('GET', '/api/config/users', {}, 'usr_obj')).status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/config/users', () => {
  it('lista os utilizadores por ordem de criação', async () => {
    await semear(env, { id: 'usr_b', email: 'b@exemplo.pt', created_at: '2026-03-01 10:00:00' });
    await semear(env, { id: 'usr_a', email: 'a@exemplo.pt', created_at: '2026-02-01 10:00:00' });
    const body = await json(await chamar('GET', '/api/config/users'));
    expect(body.users.map((u) => u.id)).toEqual(['usr_dra', 'usr_a', 'usr_b']);
  });

  it('nunca expõe password_hash nem invite_token', async () => {
    await semear(env, {
      id: 'usr_c', email: 'c@exemplo.pt', status: 'convidado',
      invite_token: TOKEN_A, invite_expires: daqui(7),
    });
    const body = await json(await chamar('GET', '/api/config/users'));
    for (const u of body.users) {
      expect(u).not.toHaveProperty('password_hash');
      expect(u).not.toHaveProperty('invite_token');
    }
  });

  it('devolve permissions já como lista e has_photo como booleano', async () => {
    await semear(env, { id: 'usr_d', email: 'd@exemplo.pt', permissions: ['painel', 'apoio'], photo_key: 'users/usr_d/foto-1' });
    const body = await json(await chamar('GET', '/api/config/users'));
    const d = body.users.find((u) => u.id === 'usr_d');
    expect(d.permissions).toEqual(['painel', 'apoio']);
    expect(d.has_photo).toBe(true);
    expect(body.users.find((u) => u.id === 'usr_dra').has_photo).toBe(false);
  });

  it('só mostra invite_expires a quem ainda está convidado', async () => {
    await semear(env, { id: 'usr_e', email: 'e@exemplo.pt', status: 'convidado', invite_token: TOKEN_A, invite_expires: '2026-09-01T00:00:00.000Z' });
    const body = await json(await chamar('GET', '/api/config/users'));
    expect(body.users.find((u) => u.id === 'usr_e').invite_expires).toBe('2026-09-01T00:00:00.000Z');
    expect(body.users.find((u) => u.id === 'usr_dra')).not.toHaveProperty('invite_expires');
  });

  it('acompanha a lista de permissões disponíveis', async () => {
    const body = await json(await chamar('GET', '/api/config/users'));
    expect(body.permissoes_disponiveis).toEqual(PERMISSOES);
    expect(body.permissoes_disponiveis).toContain('gerir_utilizadores');
  });

  it('recusa métodos não suportados na coleção com 405', async () => {
    const r = await chamar('DELETE', '/api/config/users');
    expect(r.status).toBe(405);
    expect((await json(r)).error).toBe('Método não suportado.');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/config/users — criar utilizador', () => {
  const novo = (extra = {}) => ({ body: { name: 'Ana Maria Silva', email: 'Ana@Exemplo.PT', ...extra } });

  it('cria com 201, estado «convidado» e iniciais calculadas', async () => {
    const r = await chamar('POST', '/api/config/users', novo());
    expect(r.status).toBe(201);
    const body = await json(r);
    expect(body.ok).toBe(true);
    expect(body.user).toMatchObject({
      name: 'Ana Maria Silva', email: 'ana@exemplo.pt', initials: 'AM',
      status: 'convidado', permissions: ['painel'], has_photo: false,
    });
    expect(body.user.id).toMatch(/^usr_/);
  });

  it('envia o convite por e-mail e reporta convite_enviado', async () => {
    const body = await json(await chamar('POST', '/api/config/users', novo()));
    expect(body.convite_enviado).toBe(true);
    expect(body.envio).toMatchObject({ channel: 'email', ok: true });
    expect(fetch.chamadas[0].url).toBe('https://api.resend.com/emails');
    const enviado = JSON.parse(fetch.chamadas[0].body);
    expect(enviado.to).toEqual(['ana@exemplo.pt']);
    expect(enviado.subject).toMatch(/Convite/);
    expect(enviado.html).toMatch(/\/admin\/convite\/[a-f0-9]{48}/);
  });

  it('cria na mesma quando o Resend não está configurado (convite_enviado falso)', async () => {
    env.RESEND_API_KEY = '';
    const body = await json(await chamar('POST', '/api/config/users', novo()));
    expect(body.convite_enviado).toBe(false);
    expect(body.envio.skipped).toBe(true);
    expect(env.DB.conta('users', "email = 'ana@exemplo.pt'")).toBe(1);
  });

  it('guarda um token de convite de 48 hex válido por 7 dias', async () => {
    const antes = Date.now();
    await chamar('POST', '/api/config/users', novo());
    const u = env.DB.linha(`SELECT invite_token, invite_expires FROM users WHERE email = 'ana@exemplo.pt'`);
    expect(u.invite_token).toMatch(/^[a-f0-9]{48}$/);
    const dias = (new Date(u.invite_expires).getTime() - antes) / 86400000;
    expect(dias).toBeGreaterThan(6.9);
    expect(dias).toBeLessThan(7.1);
  });

  it('guarda uma password aleatória inutilizável (nunca a do convite)', async () => {
    await chamar('POST', '/api/config/users', novo());
    const u = env.DB.linha(`SELECT password_hash FROM users WHERE email = 'ana@exemplo.pt'`);
    expect(u.password_hash).toMatch(/^pbkdf2-sha256\$\d+\$/);
    expect(await verifyPassword('', u.password_hash)).toBe(false);
  });

  it('recusa sem nome', async () => {
    const r = await chamar('POST', '/api/config/users', { body: { email: 'x@exemplo.pt' } });
    expect(r.status).toBe(400);
    expect((await json(r)).error).toBe('Indique o nome.');
  });

  it('recusa nome só com espaços', async () => {
    expect((await chamar('POST', '/api/config/users', { body: { name: '   ', email: 'x@exemplo.pt' } })).status).toBe(400);
  });

  it('recusa corpo vazio com a mensagem do nome', async () => {
    const r = await chamar('POST', '/api/config/users');
    expect(r.status).toBe(400);
    expect((await json(r)).error).toBe('Indique o nome.');
  });

  it('recusa corpo JSON inválido sem rebentar', async () => {
    const r = await chamar('POST', '/api/config/users', { body: '{ isto não é json' });
    expect(r.status).toBe(400);
  });

  it.each(['', 'sem-arroba', 'a@b', 'a b@exemplo.pt', 'a@@exemplo.pt', 'a@exemplo'])(
    'recusa o e-mail inválido «%s»', async (email) => {
      const r = await chamar('POST', '/api/config/users', { body: { name: 'Ana', email } });
      expect(r.status).toBe(400);
      expect((await json(r)).error).toBe('E-mail inválido.');
    });

  it('recusa e-mail duplicado com 409', async () => {
    await chamar('POST', '/api/config/users', novo());
    const r = await chamar('POST', '/api/config/users', novo({ name: 'Outra Pessoa' }));
    expect(r.status).toBe(409);
    expect((await json(r)).error).toMatch(/Já existe/);
  });

  it('deteta o duplicado mesmo com maiúsculas diferentes', async () => {
    const r = await chamar('POST', '/api/config/users', { body: { name: 'Clone', email: 'DRA@EXEMPLO.PT' } });
    expect(r.status).toBe(409);
  });

  it('guarda apenas as permissões conhecidas', async () => {
    const body = await json(await chamar('POST', '/api/config/users', novo({ permissions: ['painel', 'clientes', 'voar'] })));
    expect(body.user.permissions).toEqual(['painel', 'clientes']);
  });

  it('cai para ["painel"] quando nenhuma permissão é reconhecida', async () => {
    const body = await json(await chamar('POST', '/api/config/users', novo({ permissions: ['voar', 'apagar_tudo'] })));
    expect(body.user.permissions).toEqual(['painel']);
  });

  it('cai para ["painel"] com lista de permissões vazia', async () => {
    const body = await json(await chamar('POST', '/api/config/users', novo({ permissions: [] })));
    expect(body.user.permissions).toEqual(['painel']);
  });

  it('ignora permissions que não seja lista', async () => {
    const body = await json(await chamar('POST', '/api/config/users', novo({ permissions: 'todas' })));
    expect(body.user.permissions).toEqual(['painel']);
  });

  // Assimetria deliberada de leitura: na criação "*" não faz parte de PERMISSOES e é
  // filtrado (o utilizador nasce só com o painel); no PATCH "*" é aceite tal e qual.
  it('descarta "*" na criação e dá só o painel (ao contrário do PATCH)', async () => {
    const body = await json(await chamar('POST', '/api/config/users', novo({ permissions: ['*'] })));
    expect(body.user.permissions).toEqual(['painel']);
  });

  it('guarda cargo e telefone, e deixa-os a null quando vêm vazios', async () => {
    const comCargo = await json(await chamar('POST', '/api/config/users', novo({ cargo: 'Estagiária', phone: '+351911111111' })));
    expect(comCargo.user).toMatchObject({ cargo: 'Estagiária', phone: '+351911111111' });
    const sem = await json(await chamar('POST', '/api/config/users', { body: { name: 'B', email: 'b@exemplo.pt', cargo: '', phone: '' } }));
    expect(sem.user.cargo).toBe(null);
    expect(sem.user.phone).toBe(null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('PATCH /api/config/users/:id — editar', () => {
  beforeEach(async () => {
    await semear(env, { id: 'usr_ana', email: 'ana@exemplo.pt', name: 'Ana Silva', initials: 'AS', permissions: ['painel'] });
  });

  it('altera o nome e recalcula as iniciais', async () => {
    const body = await json(await chamar('PATCH', '/api/config/users/usr_ana', { body: { name: 'Maria João Costa' } }));
    expect(body.user).toMatchObject({ name: 'Maria João Costa', initials: 'MJ' });
  });

  it('ignora nome só com espaços', async () => {
    const body = await json(await chamar('PATCH', '/api/config/users/usr_ana', { body: { name: '  ' } }));
    expect(body.user.name).toBe('Ana Silva');
  });

  it('normaliza o e-mail para minúsculas', async () => {
    const body = await json(await chamar('PATCH', '/api/config/users/usr_ana', { body: { email: '  ANA2@Exemplo.PT ' } }));
    expect(body.user.email).toBe('ana2@exemplo.pt');
  });

  it('recusa e-mail inválido', async () => {
    const r = await chamar('PATCH', '/api/config/users/usr_ana', { body: { email: 'nao-e-email' } });
    expect(r.status).toBe(400);
  });

  it('recusa e-mail já usado por outro utilizador com 409', async () => {
    const r = await chamar('PATCH', '/api/config/users/usr_ana', { body: { email: 'dra@exemplo.pt' } });
    expect(r.status).toBe(409);
  });

  it('aceita gravar o próprio e-mail sem se queixar de duplicado', async () => {
    const r = await chamar('PATCH', '/api/config/users/usr_ana', { body: { email: 'ana@exemplo.pt' } });
    expect(r.status).toBe(200);
  });

  it('limpa cargo e telefone quando recebe strings vazias', async () => {
    await chamar('PATCH', '/api/config/users/usr_ana', { body: { cargo: 'X', phone: '9' } });
    const body = await json(await chamar('PATCH', '/api/config/users/usr_ana', { body: { cargo: '', phone: '' } }));
    expect(body.user.cargo).toBe(null);
    expect(body.user.phone).toBe(null);
  });

  it('filtra permissões desconhecidas', async () => {
    const body = await json(await chamar('PATCH', '/api/config/users/usr_ana', { body: { permissions: ['clientes', 'teletransporte'] } }));
    expect(body.user.permissions).toEqual(['clientes']);
  });

  it('aceita "*" e colapsa tudo para acesso total', async () => {
    const body = await json(await chamar('PATCH', '/api/config/users/usr_ana', { body: { permissions: ['*', 'painel'] } }));
    expect(body.user.permissions).toEqual(['*']);
  });

  it('recusa lista de permissões vazia', async () => {
    const r = await chamar('PATCH', '/api/config/users/usr_ana', { body: { permissions: [] } });
    expect(r.status).toBe(400);
    expect((await json(r)).error).toMatch(/pelo menos uma aba/);
  });

  it('recusa lista só com permissões desconhecidas', async () => {
    const r = await chamar('PATCH', '/api/config/users/usr_ana', { body: { permissions: ['voar'] } });
    expect(r.status).toBe(400);
  });

  it('ignora permissions que não seja lista', async () => {
    const body = await json(await chamar('PATCH', '/api/config/users/usr_ana', { body: { permissions: 'clientes' } }));
    expect(body.user.permissions).toEqual(['painel']);
  });

  it('não deixa o único gestor tirar-se a si próprio a gestão', async () => {
    const r = await chamar('PATCH', '/api/config/users/usr_dra', { body: { permissions: ['painel'] } });
    expect(r.status).toBe(400);
    expect((await json(r)).error).toMatch(/único gestor/);
    expect(JSON.parse(env.DB.linha(`SELECT permissions FROM users WHERE id = 'usr_dra'`).permissions)).toEqual(['*']);
  });

  it('deixa tirar a gestão havendo outro gestor', async () => {
    await semear(env, { id: 'usr_g2', email: 'g2@exemplo.pt', permissions: ['gerir_utilizadores'] });
    const r = await chamar('PATCH', '/api/config/users/usr_g2', { body: { permissions: ['painel'] } });
    expect(r.status).toBe(200);
  });

  it('deixa promover alguém a gestor', async () => {
    const body = await json(await chamar('PATCH', '/api/config/users/usr_ana', { body: { permissions: ['painel', 'gerir_utilizadores'] } }));
    expect(body.user.permissions).toContain('gerir_utilizadores');
  });

  it('corpo vazio devolve o utilizador sem tocar em nada', async () => {
    const r = await chamar('PATCH', '/api/config/users/usr_ana', { body: {} });
    expect(r.status).toBe(200);
    expect((await json(r)).user).toMatchObject({ name: 'Ana Silva', permissions: ['painel'] });
  });

  it('corpo JSON inválido comporta-se como corpo vazio', async () => {
    const r = await chamar('PATCH', '/api/config/users/usr_ana', { body: 'xpto' });
    expect(r.status).toBe(200);
  });

  it('devolve 404 para utilizador inexistente', async () => {
    const r = await chamar('PATCH', '/api/config/users/usr_nao_existe', { body: { name: 'X' } });
    expect(r.status).toBe(404);
    expect((await json(r)).error).toBe('Utilizador não encontrado.');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('DELETE /api/config/users/:id', () => {
  beforeEach(async () => {
    await semear(env, { id: 'usr_ana', email: 'ana@exemplo.pt', permissions: ['painel'] });
  });

  it('apaga o utilizador', async () => {
    const r = await chamar('DELETE', '/api/config/users/usr_ana');
    expect(r.status).toBe(200);
    expect(env.DB.conta('users')).toBe(1);
  });

  it('não deixa apagar o próprio utilizador da sessão', async () => {
    const r = await chamar('DELETE', '/api/config/users/usr_dra');
    expect(r.status).toBe(400);
    expect((await json(r)).error).toMatch(/próprio utilizador/);
    expect(env.DB.conta('users')).toBe(2);
  });

  // A guarda do «único gestor» é inalcançável no DELETE: quem chama já tem de ser
  // gestor, por isso um alvo gestor diferente de si implica sempre ≥ 2 gestores.
  it('permite apagar um gestor desde que reste outro', async () => {
    await semear(env, { id: 'usr_g2', email: 'g2@exemplo.pt', permissions: ['gerir_utilizadores'] });
    expect((await chamar('DELETE', '/api/config/users/usr_g2')).status).toBe(200);
  });

  it('apaga também a foto guardada no R2', async () => {
    await env.RECIBOS.put('users/usr_ana/foto-1', new Uint8Array([1, 2, 3]).buffer);
    await env.DB.prepare(`UPDATE users SET photo_key = 'users/usr_ana/foto-1' WHERE id = 'usr_ana'`).run();
    await chamar('DELETE', '/api/config/users/usr_ana');
    expect(await env.RECIBOS.get('users/usr_ana/foto-1')).toBe(null);
  });

  it('devolve 404 para utilizador inexistente', async () => {
    expect((await chamar('DELETE', '/api/config/users/usr_zzz')).status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/config/users/:id/convite — reenviar', () => {
  beforeEach(async () => {
    await semear(env, {
      id: 'usr_ana', email: 'ana@exemplo.pt', status: 'convidado',
      invite_token: TOKEN_A, invite_expires: daqui(1),
    });
  });

  it('gera um token novo e volta a enviar o e-mail', async () => {
    const r = await chamar('POST', '/api/config/users/usr_ana/convite');
    expect(r.status).toBe(200);
    expect((await json(r)).ok).toBe(true);
    const u = env.DB.linha(`SELECT invite_token, invite_expires FROM users WHERE id = 'usr_ana'`);
    expect(u.invite_token).not.toBe(TOKEN_A);
    expect(u.invite_token).toMatch(/^[a-f0-9]{48}$/);
    expect(new Date(u.invite_expires).getTime()).toBeGreaterThan(Date.now() + 6 * 86400000);
    expect(fetch.chamadas).toHaveLength(1);
  });

  it('invalida o token anterior', async () => {
    await chamar('POST', '/api/config/users/usr_ana/convite');
    const r = await publico('GET', `/api/public/convite/${TOKEN_A}`);
    expect(r.status).toBe(404);
  });

  it('recusa reenviar a quem já concluiu o registo', async () => {
    const r = await chamar('POST', '/api/config/users/usr_dra/convite');
    expect(r.status).toBe(400);
    expect((await json(r)).error).toMatch(/já concluiu/);
  });

  it('devolve ok:false quando o envio falha, mas guarda o token novo', async () => {
    vi.stubGlobal('fetch', mockFetch({ status: 500, json: { message: 'boom' } }));
    const body = await json(await chamar('POST', '/api/config/users/usr_ana/convite'));
    expect(body.ok).toBe(false);
    expect(body.envio.error).toBe('boom');
    expect(env.DB.linha(`SELECT invite_token FROM users WHERE id = 'usr_ana'`).invite_token).not.toBe(TOKEN_A);
  });

  it('devolve 404 para utilizador inexistente', async () => {
    expect((await chamar('POST', '/api/config/users/usr_zzz/convite')).status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('/api/config/users/:id/foto', () => {
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  beforeEach(async () => {
    await semear(env, { id: 'usr_ana', email: 'ana@exemplo.pt' });
  });

  it('guarda a foto no R2 e marca has_photo', async () => {
    const r = await chamar('POST', '/api/config/users/usr_ana/foto', { binario: png, headers: { 'Content-Type': 'image/png' } });
    expect(r.status).toBe(200);
    const key = env.DB.linha(`SELECT photo_key FROM users WHERE id = 'usr_ana'`).photo_key;
    expect(key).toMatch(/^users\/usr_ana\/foto-\d+$/);
    expect(new Uint8Array(await (await env.RECIBOS.get(key)).arrayBuffer())).toEqual(png);
  });

  it('recusa o que não for imagem', async () => {
    const r = await chamar('POST', '/api/config/users/usr_ana/foto', { binario: png, headers: { 'Content-Type': 'application/pdf' } });
    expect(r.status).toBe(400);
    expect((await json(r)).error).toBe('Envie uma imagem.');
  });

  it('recusa corpo vazio', async () => {
    const r = await chamar('POST', '/api/config/users/usr_ana/foto', { binario: new Uint8Array(0), headers: { 'Content-Type': 'image/png' } });
    expect(r.status).toBe(400);
  });

  it('recusa imagens acima de 5 MB', async () => {
    const grande = new Uint8Array(5 * 1024 * 1024 + 1);
    const r = await chamar('POST', '/api/config/users/usr_ana/foto', { binario: grande, headers: { 'Content-Type': 'image/jpeg' } });
    expect(r.status).toBe(400);
    expect((await json(r)).error).toMatch(/5 MB/);
  });

  it('apaga a foto anterior ao substituir', async () => {
    await env.RECIBOS.put('users/usr_ana/antiga', new Uint8Array([9]).buffer);
    await env.DB.prepare(`UPDATE users SET photo_key = 'users/usr_ana/antiga' WHERE id = 'usr_ana'`).run();
    await chamar('POST', '/api/config/users/usr_ana/foto', { binario: png, headers: { 'Content-Type': 'image/png' } });
    expect(await env.RECIBOS.get('users/usr_ana/antiga')).toBe(null);
    expect(env.RECIBOS.store.size).toBe(1);
  });

  it('serve a foto com o content-type guardado e cache privada', async () => {
    await chamar('POST', '/api/config/users/usr_ana/foto', { binario: png, headers: { 'Content-Type': 'image/webp' } });
    const r = await chamar('GET', '/api/config/users/usr_ana/foto');
    expect(r.status).toBe(200);
    expect(r.headers.get('Content-Type')).toBe('image/webp');
    expect(r.headers.get('Cache-Control')).toMatch(/private/);
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(png);
  });

  it('devolve 404 quando o utilizador não tem foto', async () => {
    const r = await chamar('GET', '/api/config/users/usr_ana/foto');
    expect(r.status).toBe(404);
    expect((await json(r)).error).toBe('Sem foto.');
  });

  it('devolve 404 quando a chave existe mas o objeto desapareceu do R2', async () => {
    await env.DB.prepare(`UPDATE users SET photo_key = 'users/usr_ana/orfa' WHERE id = 'usr_ana'`).run();
    expect((await chamar('GET', '/api/config/users/usr_ana/foto')).status).toBe(404);
  });

  it('DELETE limpa a chave e o objeto', async () => {
    await chamar('POST', '/api/config/users/usr_ana/foto', { binario: png, headers: { 'Content-Type': 'image/png' } });
    const r = await chamar('DELETE', '/api/config/users/usr_ana/foto');
    expect(r.status).toBe(200);
    expect(env.DB.linha(`SELECT photo_key FROM users WHERE id = 'usr_ana'`).photo_key).toBe(null);
    expect(env.RECIBOS.store.size).toBe(0);
  });

  it('DELETE sem foto não se queixa', async () => {
    expect((await chamar('DELETE', '/api/config/users/usr_ana/foto')).status).toBe(200);
  });

  it('método não suportado na foto cai em 404', async () => {
    expect((await chamar('PATCH', '/api/config/users/usr_ana/foto', { body: {} })).status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('handleConfig — caminhos desconhecidos', () => {
  it('devolve 404 para uma secção de configurações que não existe', async () => {
    const r = await chamar('GET', '/api/config/definicoes');
    expect(r.status).toBe(404);
    expect((await json(r)).error).toBe('Not found');
  });

  it('não há GET de um utilizador só — devolve 404', async () => {
    await semear(env, { id: 'usr_ana', email: 'ana@exemplo.pt' });
    expect((await chamar('GET', '/api/config/users/usr_ana')).status).toBe(404);
  });

  it('devolve 404 para sub-ação desconhecida', async () => {
    await semear(env, { id: 'usr_ana', email: 'ana@exemplo.pt' });
    expect((await chamar('POST', '/api/config/users/usr_ana/password', { body: {} })).status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('handlePublicConvite — registo pelo link do e-mail', () => {
  beforeEach(async () => {
    await semear(env, {
      id: 'usr_ana', email: 'ana@exemplo.pt', name: 'Ana Silva', initials: 'AS',
      cargo: 'Advogada', phone: '911111111', status: 'convidado',
      invite_token: TOKEN_A, invite_expires: daqui(3),
    });
  });

  it.each(['abc', 'A'.repeat(48), 'a'.repeat(47), 'a'.repeat(49), 'g'.repeat(48)])(
    'devolve 404 para o token mal formado «%s»', async (t) => {
      const r = await publico('GET', `/api/public/convite/${t}`);
      expect(r.status).toBe(404);
      expect((await json(r)).error).toBe('Not found');
    });

  it('devolve 404 para token bem formado mas inexistente', async () => {
    const r = await publico('GET', `/api/public/convite/${TOKEN_B}`);
    expect(r.status).toBe(404);
    expect((await json(r)).error).toMatch(/Convite inválido/);
  });

  it('devolve 404 se o utilizador já está ativo', async () => {
    await env.DB.prepare(`UPDATE users SET status = 'ativo' WHERE id = 'usr_ana'`).run();
    expect((await publico('GET', `/api/public/convite/${TOKEN_A}`)).status).toBe(404);
  });

  it('devolve 410 quando o convite expirou', async () => {
    await env.DB.prepare(`UPDATE users SET invite_expires = ? WHERE id = 'usr_ana'`).bind(daqui(-1)).run();
    const r = await publico('GET', `/api/public/convite/${TOKEN_A}`);
    expect(r.status).toBe(410);
    expect((await json(r)).error).toMatch(/expirou/);
  });

  it('GET devolve os dados para pré-preencher o registo', async () => {
    const body = await json(await publico('GET', `/api/public/convite/${TOKEN_A}`));
    expect(body).toEqual({ name: 'Ana Silva', email: 'ana@exemplo.pt', cargo: 'Advogada', phone: '911111111', has_photo: false });
  });

  it('conclui o registo: ativa, limpa o token e a password passa a servir', async () => {
    const r = await publico('POST', `/api/public/convite/${TOKEN_A}`, { body: { password: 'segredo-forte-1' } });
    expect(r.status).toBe(200);
    const u = env.DB.linha(`SELECT * FROM users WHERE id = 'usr_ana'`);
    expect(u.status).toBe('ativo');
    expect(u.invite_token).toBe(null);
    expect(u.invite_expires).toBe(null);
    expect(await verifyPassword('segredo-forte-1', u.password_hash)).toBe(true);
    expect(await verifyPassword('outra-coisa', u.password_hash)).toBe(false);
  });

  it('atualiza nome, iniciais, cargo e telefone no registo', async () => {
    await publico('POST', `/api/public/convite/${TOKEN_A}`, {
      body: { password: '12345678', name: 'Ana Rita Silva', cargo: 'Sócia', phone: '922222222' },
    });
    const u = env.DB.linha(`SELECT name, initials, cargo, phone FROM users WHERE id = 'usr_ana'`);
    expect(u).toMatchObject({ name: 'Ana Rita Silva', initials: 'AR', cargo: 'Sócia', phone: '922222222' });
  });

  it('mantém o nome do convite quando o registo não manda nome', async () => {
    await publico('POST', `/api/public/convite/${TOKEN_A}`, { body: { password: '12345678', name: '   ' } });
    expect(env.DB.linha(`SELECT name FROM users WHERE id = 'usr_ana'`).name).toBe('Ana Silva');
  });

  it.each(['', '1234567', 'curta'])('recusa a password fraca «%s»', async (password) => {
    const r = await publico('POST', `/api/public/convite/${TOKEN_A}`, { body: { password } });
    expect(r.status).toBe(400);
    expect((await json(r)).error).toMatch(/pelo menos 8 caracteres/);
  });

  it('aceita exatamente 8 caracteres', async () => {
    expect((await publico('POST', `/api/public/convite/${TOKEN_A}`, { body: { password: '12345678' } })).status).toBe(200);
  });

  it('recusa corpo vazio ou JSON inválido', async () => {
    expect((await publico('POST', `/api/public/convite/${TOKEN_A}`)).status).toBe(400);
    expect((await publico('POST', `/api/public/convite/${TOKEN_A}`, { body: '{{' })).status).toBe(400);
  });

  it('o convite só serve uma vez', async () => {
    await publico('POST', `/api/public/convite/${TOKEN_A}`, { body: { password: '12345678' } });
    expect((await publico('POST', `/api/public/convite/${TOKEN_A}`, { body: { password: '12345678' } })).status).toBe(404);
  });

  it('aceita a foto de perfil durante o registo', async () => {
    const png = new Uint8Array([137, 80, 78, 71]);
    const r = await publico('POST', `/api/public/convite/${TOKEN_A}/foto`, { binario: png, headers: { 'Content-Type': 'image/png' } });
    expect(r.status).toBe(200);
    const key = env.DB.linha(`SELECT photo_key FROM users WHERE id = 'usr_ana'`).photo_key;
    expect(key).toMatch(/^users\/usr_ana\/foto-/);
    expect((await json(await publico('GET', `/api/public/convite/${TOKEN_A}`))).has_photo).toBe(true);
  });

  it('recusa foto que não seja imagem ou esteja vazia', async () => {
    const r1 = await publico('POST', `/api/public/convite/${TOKEN_A}/foto`, { binario: new Uint8Array([1]), headers: { 'Content-Type': 'text/plain' } });
    expect(r1.status).toBe(400);
    const r2 = await publico('POST', `/api/public/convite/${TOKEN_A}/foto`, { binario: new Uint8Array(0), headers: { 'Content-Type': 'image/png' } });
    expect(r2.status).toBe(400);
  });

  it.each([['PUT', ''], ['DELETE', ''], ['GET', '/foto']])(
    'responde 405 a %s %s', async (metodo, sufixo) => {
      const r = await publico(metodo, `/api/public/convite/${TOKEN_A}${sufixo}`, metodo === 'PUT' ? { body: {} } : {});
      expect(r.status).toBe(405);
      expect((await json(r)).error).toBe('Método não suportado.');
    });
});
