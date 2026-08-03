// tests/worker/senders.test.js — envio de e-mail (Resend), WhatsApp (Z-API) e templates.
//
// Regra de ouro destes três utilitários: NUNCA lançam exceção. O cron percorre
// dezenas de notificações e um canal em baixo não pode partir os restantes.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { sendEmail, sendWhatsApp, renderTemplate } from '../../worker/lib/senders.js';
import { mockFetch } from '../helpers/env.js';

afterEach(() => vi.unstubAllGlobals());

// Corpo JSON enviado na chamada `i` ao fetch.
const corpoDe = (f, i = 0) => JSON.parse(f.chamadas[i].init.body);

const envEmail = (extra = {}) => ({ RESEND_API_KEY: 'chave-resend-de-teste', ...extra });
const envZap = (extra = {}) => ({
  ZAPI_INSTANCE_ID: 'INST123',
  ZAPI_INSTANCE_TOKEN: 'TOK456',
  ...extra,
});

// ─────────────────────────────────────────────────────────────────────────────
describe('sendEmail — guardas antes de gastar uma chamada', () => {
  it('sem RESEND_API_KEY devolve skipped e não chega a chamar o fetch', async () => {
    const espia = vi.fn();
    vi.stubGlobal('fetch', espia);
    const r = await sendEmail({}, { to: 'cliente@exemplo.pt', subject: 'Olá' });
    expect(r).toEqual({ channel: 'email', skipped: true, reason: 'RESEND_API_KEY não definido' });
    expect(espia).not.toHaveBeenCalled();
  });

  it('RESEND_API_KEY vazia conta como ausente', async () => {
    const espia = vi.fn();
    vi.stubGlobal('fetch', espia);
    expect((await sendEmail({ RESEND_API_KEY: '' }, { to: 'a@b.pt' })).skipped).toBe(true);
    expect(espia).not.toHaveBeenCalled();
  });

  it('sem destinatário devolve skipped e não chama o fetch', async () => {
    const espia = vi.fn();
    vi.stubGlobal('fetch', espia);
    const r = await sendEmail(envEmail(), { subject: 'Olá' });
    expect(r).toEqual({ channel: 'email', skipped: true, reason: 'sem destinatário' });
    expect(espia).not.toHaveBeenCalled();
  });

  it('destinatário vazio também é skipped', async () => {
    const espia = vi.fn();
    vi.stubGlobal('fetch', espia);
    expect((await sendEmail(envEmail(), { to: '' })).skipped).toBe(true);
    expect(espia).not.toHaveBeenCalled();
  });
});

describe('sendEmail — chamada à Resend', () => {
  it('faz POST autenticado para a API da Resend', async () => {
    const f = mockFetch({ json: { id: 'msg_1' } });
    vi.stubGlobal('fetch', f);
    await sendEmail(envEmail(), { to: 'cliente@exemplo.pt', subject: 'Recibo' });
    expect(f.chamadas[0].url).toBe('https://api.resend.com/emails');
    expect(f.chamadas[0].init.method).toBe('POST');
    expect(f.chamadas[0].init.headers.Authorization).toBe('Bearer chave-resend-de-teste');
    expect(f.chamadas[0].init.headers['Content-Type']).toBe('application/json');
  });

  it('devolve ok e o external_id da resposta', async () => {
    vi.stubGlobal('fetch', mockFetch({ json: { id: 'msg_abc123' } }));
    const r = await sendEmail(envEmail(), { to: 'cliente@exemplo.pt' });
    expect(r).toEqual({ channel: 'email', ok: true, external_id: 'msg_abc123' });
  });

  it('sucesso sem id devolve external_id nulo', async () => {
    vi.stubGlobal('fetch', mockFetch({ json: {} }));
    expect(await sendEmail(envEmail(), { to: 'a@b.pt' })).toEqual({
      channel: 'email', ok: true, external_id: null,
    });
  });

  it('envolve o destinatário num array', async () => {
    const f = mockFetch({ json: {} });
    vi.stubGlobal('fetch', f);
    await sendEmail(envEmail(), { to: 'cliente@exemplo.pt' });
    expect(corpoDe(f).to).toEqual(['cliente@exemplo.pt']);
  });

  // Armadilha conhecida: a assinatura assume UM destinatário. Passar um array
  // produz um array aninhado, que a Resend recusa.
  it('um array em `to` fica aninhado (documenta a armadilha)', async () => {
    const f = mockFetch({ json: {} });
    vi.stubGlobal('fetch', f);
    await sendEmail(envEmail(), { to: ['a@b.pt', 'c@d.pt'] });
    expect(corpoDe(f).to).toEqual([['a@b.pt', 'c@d.pt']]);
  });

  it('usa o remetente por omissão da Dra.', async () => {
    const f = mockFetch({ json: {} });
    vi.stubGlobal('fetch', f);
    await sendEmail(envEmail(), { to: 'a@b.pt' });
    expect(corpoDe(f).from).toBe('Vyvian Avena Advogada <no-reply@vyavenaadv.com>');
  });

  it('RESEND_FROM configurado substitui o remetente', async () => {
    const f = mockFetch({ json: {} });
    vi.stubGlobal('fetch', f);
    await sendEmail(envEmail({ RESEND_FROM: 'Escritório <geral@vyavenaadv.com>' }), { to: 'a@b.pt' });
    expect(corpoDe(f).from).toBe('Escritório <geral@vyavenaadv.com>');
  });

  it('sem RESEND_REPLY_TO o campo reply_to nem sequer é enviado', async () => {
    const f = mockFetch({ json: {} });
    vi.stubGlobal('fetch', f);
    await sendEmail(envEmail(), { to: 'a@b.pt' });
    expect('reply_to' in corpoDe(f)).toBe(false);
  });

  it('RESEND_REPLY_TO configurado é enviado', async () => {
    const f = mockFetch({ json: {} });
    vi.stubGlobal('fetch', f);
    await sendEmail(envEmail({ RESEND_REPLY_TO: 'dra@vyavenaadv.com' }), { to: 'a@b.pt' });
    expect(corpoDe(f).reply_to).toBe('dra@vyavenaadv.com');
  });

  it('assunto por omissão quando não é indicado', async () => {
    const f = mockFetch({ json: {} });
    vi.stubGlobal('fetch', f);
    await sendEmail(envEmail(), { to: 'a@b.pt' });
    expect(corpoDe(f).subject).toBe('Vyvian Avena Advogada');
  });

  it('assunto vazio cai no assunto por omissão', async () => {
    const f = mockFetch({ json: {} });
    vi.stubGlobal('fetch', f);
    await sendEmail(envEmail(), { to: 'a@b.pt', subject: '' });
    expect(corpoDe(f).subject).toBe('Vyvian Avena Advogada');
  });

  it('deriva o html a partir do texto quando só há texto', async () => {
    const f = mockFetch({ json: {} });
    vi.stubGlobal('fetch', f);
    await sendEmail(envEmail(), { to: 'a@b.pt', text: 'A sua parcela vence amanhã.' });
    const c = corpoDe(f);
    expect(c.html).toBe('<p>A sua parcela vence amanhã.</p>');
    expect(c.text).toBe('A sua parcela vence amanhã.');
  });

  it('html indicado tem prioridade sobre o texto', async () => {
    const f = mockFetch({ json: {} });
    vi.stubGlobal('fetch', f);
    await sendEmail(envEmail(), { to: 'a@b.pt', html: '<b>Olá</b>', text: 'Olá' });
    expect(corpoDe(f).html).toBe('<b>Olá</b>');
  });

  it('sem html nem texto envia html vazio e omite o text', async () => {
    const f = mockFetch({ json: {} });
    vi.stubGlobal('fetch', f);
    await sendEmail(envEmail(), { to: 'a@b.pt' });
    const c = corpoDe(f);
    expect(c.html).toBe('');
    expect('text' in c).toBe(false);
  });

  // BUG: o texto é interpolado no HTML sem escape — um «<» ou «&» vindo do nome
  // do cliente ou da descrição da parcela produz HTML partido (ou injetado).
  it.fails('devia escapar o texto ao derivar o html', async () => {
    const f = mockFetch({ json: {} });
    vi.stubGlobal('fetch', f);
    await sendEmail(envEmail(), { to: 'a@b.pt', text: 'Dívida <100€ & juros' });
    expect(corpoDe(f).html).toContain('&lt;100');
  });

  it('sem anexos o campo attachments é omitido', async () => {
    const f = mockFetch({ json: {} });
    vi.stubGlobal('fetch', f);
    await sendEmail(envEmail(), { to: 'a@b.pt' });
    expect('attachments' in corpoDe(f)).toBe(false);
  });

  it('lista de anexos vazia também é omitida', async () => {
    const f = mockFetch({ json: {} });
    vi.stubGlobal('fetch', f);
    await sendEmail(envEmail(), { to: 'a@b.pt', attachments: [] });
    expect('attachments' in corpoDe(f)).toBe(false);
  });

  it('anexos com itens são enviados tal e qual', async () => {
    const f = mockFetch({ json: {} });
    vi.stubGlobal('fetch', f);
    const anexos = [{ filename: 'recibo.pdf', content: 'JVBERi0=' }];
    await sendEmail(envEmail(), { to: 'a@b.pt', attachments: anexos });
    expect(corpoDe(f).attachments).toEqual(anexos);
  });
});

describe('sendEmail — falhas', () => {
  it('HTTP 422 devolve ok:false com a mensagem da API', async () => {
    vi.stubGlobal('fetch', mockFetch({ status: 422, json: { message: 'Domínio não verificado' } }));
    expect(await sendEmail(envEmail(), { to: 'a@b.pt' })).toEqual({
      channel: 'email', ok: false, error: 'Domínio não verificado',
    });
  });

  it('HTTP 401 sem mensagem cai no «HTTP <status>»', async () => {
    vi.stubGlobal('fetch', mockFetch({ status: 401, json: {} }));
    expect((await sendEmail(envEmail(), { to: 'a@b.pt' })).error).toBe('HTTP 401');
  });

  it('HTTP 500 com corpo não-JSON devolve «HTTP 500»', async () => {
    vi.stubGlobal('fetch', mockFetch({ status: 500, texto: '<html>Bad Gateway</html>' }));
    expect((await sendEmail(envEmail(), { to: 'a@b.pt' })).error).toBe('HTTP 500');
  });

  it('200 com corpo ilegível ainda conta como sucesso (external_id nulo)', async () => {
    vi.stubGlobal('fetch', mockFetch({ texto: 'isto não é json' }));
    expect(await sendEmail(envEmail(), { to: 'a@b.pt' })).toEqual({
      channel: 'email', ok: true, external_id: null,
    });
  });

  it('200 com corpo vazio não rebenta', async () => {
    vi.stubGlobal('fetch', mockFetch({ texto: '' }));
    expect((await sendEmail(envEmail(), { to: 'a@b.pt' })).ok).toBe(true);
  });

  it('fetch que rebenta devolve ok:false com a mensagem do erro', async () => {
    vi.stubGlobal('fetch', mockFetch({ erro: 'a rede caiu' }));
    expect(await sendEmail(envEmail(), { to: 'a@b.pt' })).toEqual({
      channel: 'email', ok: false, error: 'a rede caiu',
    });
  });

  it('nunca lança — mesmo com o fetch a explodir', async () => {
    vi.stubGlobal('fetch', () => { throw new Error('boom síncrono'); });
    await expect(sendEmail(envEmail(), { to: 'a@b.pt' })).resolves.toMatchObject({ ok: false });
  });

  it('identifica sempre o canal como email', async () => {
    vi.stubGlobal('fetch', mockFetch({ status: 500, json: {} }));
    expect((await sendEmail(envEmail(), { to: 'a@b.pt' })).channel).toBe('email');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('sendWhatsApp — guardas', () => {
  it('sem ZAPI_INSTANCE_ID devolve skipped', async () => {
    const espia = vi.fn();
    vi.stubGlobal('fetch', espia);
    const r = await sendWhatsApp({ ZAPI_INSTANCE_TOKEN: 'TOK' }, { phone: '351912345678', message: 'x' });
    expect(r).toEqual({ channel: 'whatsapp', skipped: true, reason: 'credenciais Z-API não definidas' });
    expect(espia).not.toHaveBeenCalled();
  });

  it('sem ZAPI_INSTANCE_TOKEN devolve skipped', async () => {
    const espia = vi.fn();
    vi.stubGlobal('fetch', espia);
    expect((await sendWhatsApp({ ZAPI_INSTANCE_ID: 'INST' }, { phone: '351912345678' })).skipped).toBe(true);
    expect(espia).not.toHaveBeenCalled();
  });

  it('sem nenhuma credencial devolve skipped', async () => {
    expect((await sendWhatsApp({}, { phone: '351912345678' })).skipped).toBe(true);
  });

  it('credenciais vazias contam como ausentes', async () => {
    const r = await sendWhatsApp({ ZAPI_INSTANCE_ID: '', ZAPI_INSTANCE_TOKEN: '' }, { phone: '351912345678' });
    expect(r.skipped).toBe(true);
  });

  it('sem telefone devolve skipped', async () => {
    const espia = vi.fn();
    vi.stubGlobal('fetch', espia);
    const r = await sendWhatsApp(envZap(), { message: 'Olá' });
    expect(r).toEqual({ channel: 'whatsapp', skipped: true, reason: 'sem telefone' });
    expect(espia).not.toHaveBeenCalled();
  });

  it('telefone vazio devolve skipped', async () => {
    expect((await sendWhatsApp(envZap(), { phone: '', message: 'x' })).skipped).toBe(true);
  });

  // BUG: `!phone` só apanha o vazio. Um telefone só com letras/símbolos passa a
  // guarda e é enviado à Z-API como string vazia em vez de ser ignorado.
  it.fails('telefone sem um único dígito devia ser skipped', async () => {
    vi.stubGlobal('fetch', mockFetch({ json: { messageId: 'm1' } }));
    const r = await sendWhatsApp(envZap(), { phone: 'sem-numero', message: 'x' });
    expect(r.skipped).toBe(true);
  });
});

describe('sendWhatsApp — chamada à Z-API', () => {
  it('monta o URL com a instância e o token', async () => {
    const f = mockFetch({ json: { messageId: 'm1' } });
    vi.stubGlobal('fetch', f);
    await sendWhatsApp(envZap(), { phone: '351912345678', message: 'Olá' });
    expect(f.chamadas[0].url).toBe('https://api.z-api.io/instances/INST123/token/TOK456/send-text');
    expect(f.chamadas[0].init.method).toBe('POST');
  });

  it.each([
    ['+351 912 345 678', '351912345678'],
    ['(11) 98765-4321', '11987654321'],
    ['351-912-345-678', '351912345678'],
    ['tel: 351912345678', '351912345678'],
    ['  351 912 345 678  ', '351912345678'],
    ['+55 (11) 9.8765-4321', '5511987654321'],
  ])('limpa o número %s → %s', async (entrada, esperado) => {
    const f = mockFetch({ json: {} });
    vi.stubGlobal('fetch', f);
    await sendWhatsApp(envZap(), { phone: entrada, message: 'x' });
    expect(corpoDe(f).phone).toBe(esperado);
  });

  it('aceita o telefone como número e converte-o para texto', async () => {
    const f = mockFetch({ json: {} });
    vi.stubGlobal('fetch', f);
    await sendWhatsApp(envZap(), { phone: 351912345678, message: 'x' });
    expect(corpoDe(f).phone).toBe('351912345678');
  });

  it('envia a mensagem no corpo', async () => {
    const f = mockFetch({ json: {} });
    vi.stubGlobal('fetch', f);
    await sendWhatsApp(envZap(), { phone: '351912345678', message: 'A sua parcela vence amanhã.' });
    expect(corpoDe(f).message).toBe('A sua parcela vence amanhã.');
  });

  it('sem Client-Token o cabeçalho não é enviado', async () => {
    const f = mockFetch({ json: {} });
    vi.stubGlobal('fetch', f);
    await sendWhatsApp(envZap(), { phone: '351912345678', message: 'x' });
    expect('Client-Token' in f.chamadas[0].init.headers).toBe(false);
  });

  it('com ZAPI_CLIENT_TOKEN o cabeçalho Client-Token é enviado', async () => {
    const f = mockFetch({ json: {} });
    vi.stubGlobal('fetch', f);
    await sendWhatsApp(envZap({ ZAPI_CLIENT_TOKEN: 'CT789' }), { phone: '351912345678', message: 'x' });
    expect(f.chamadas[0].init.headers['Client-Token']).toBe('CT789');
  });

  it('devolve ok com o messageId', async () => {
    vi.stubGlobal('fetch', mockFetch({ json: { messageId: 'wamid.123' } }));
    expect(await sendWhatsApp(envZap(), { phone: '351912345678', message: 'x' })).toEqual({
      channel: 'whatsapp', ok: true, external_id: 'wamid.123',
    });
  });

  it('aceita `id` quando não há messageId', async () => {
    vi.stubGlobal('fetch', mockFetch({ json: { id: 'zap-77' } }));
    expect((await sendWhatsApp(envZap(), { phone: '351912345678', message: 'x' })).external_id).toBe('zap-77');
  });

  it('messageId ganha ao id quando ambos vêm', async () => {
    vi.stubGlobal('fetch', mockFetch({ json: { messageId: 'A', id: 'B' } }));
    expect((await sendWhatsApp(envZap(), { phone: '351912345678', message: 'x' })).external_id).toBe('A');
  });

  it('sucesso sem identificador devolve external_id nulo', async () => {
    vi.stubGlobal('fetch', mockFetch({ json: {} }));
    expect((await sendWhatsApp(envZap(), { phone: '351912345678', message: 'x' })).external_id).toBe(null);
  });
});

describe('sendWhatsApp — falhas', () => {
  it('HTTP 401 devolve o erro da API', async () => {
    vi.stubGlobal('fetch', mockFetch({ status: 401, json: { error: 'Client-Token inválido' } }));
    expect(await sendWhatsApp(envZap(), { phone: '351912345678', message: 'x' })).toEqual({
      channel: 'whatsapp', ok: false, error: 'Client-Token inválido',
    });
  });

  it('HTTP 500 sem corpo útil cai no «HTTP <status>»', async () => {
    vi.stubGlobal('fetch', mockFetch({ status: 500, texto: 'oops' }));
    expect((await sendWhatsApp(envZap(), { phone: '351912345678', message: 'x' })).error).toBe('HTTP 500');
  });

  it('fetch que rebenta devolve ok:false sem lançar', async () => {
    vi.stubGlobal('fetch', mockFetch({ erro: 'ECONNRESET' }));
    expect(await sendWhatsApp(envZap(), { phone: '351912345678', message: 'x' })).toEqual({
      channel: 'whatsapp', ok: false, error: 'ECONNRESET',
    });
  });

  it('200 com corpo ilegível continua a ser sucesso', async () => {
    vi.stubGlobal('fetch', mockFetch({ texto: 'ok' }));
    expect((await sendWhatsApp(envZap(), { phone: '351912345678', message: 'x' })).ok).toBe(true);
  });

  it('identifica sempre o canal como whatsapp', async () => {
    vi.stubGlobal('fetch', mockFetch({ status: 500, json: {} }));
    expect((await sendWhatsApp(envZap(), { phone: '351912345678', message: 'x' })).channel).toBe('whatsapp');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('renderTemplate', () => {
  it('substitui uma variável simples', () => {
    expect(renderTemplate('Olá {{nome}},', { nome: 'Maria' })).toBe('Olá Maria,');
  });

  it('tolera espaços dentro das chavetas', () => {
    expect(renderTemplate('Olá {{ nome }}!', { nome: 'Maria' })).toBe('Olá Maria!');
    expect(renderTemplate('Olá {{  nome  }}!', { nome: 'Maria' })).toBe('Olá Maria!');
  });

  it('substitui todas as variáveis do template de cobrança', () => {
    const out = renderTemplate(
      'Cara {{nome}}, a parcela {{parcela}} de {{valor}} vence a {{vencimento}}.',
      { nome: 'Ana', parcela: '3/12', valor: '250,00 €', vencimento: '15/08/2026' }
    );
    expect(out).toBe('Cara Ana, a parcela 3/12 de 250,00 € vence a 15/08/2026.');
  });

  it('repete o valor em todas as ocorrências da mesma variável', () => {
    expect(renderTemplate('{{nome}} {{nome}} {{nome}}', { nome: 'Ana' })).toBe('Ana Ana Ana');
  });

  it('variável em falta vira string vazia', () => {
    expect(renderTemplate('Olá {{nome}}!', {})).toBe('Olá !');
  });

  it('variável null vira string vazia', () => {
    expect(renderTemplate('[{{v}}]', { v: null })).toBe('[]');
  });

  it('variável undefined vira string vazia', () => {
    expect(renderTemplate('[{{v}}]', { v: undefined })).toBe('[]');
  });

  it('zero NÃO vira vazio — é escrito como "0"', () => {
    expect(renderTemplate('Faltam {{n}} dias', { n: 0 })).toBe('Faltam 0 dias');
  });

  it('false NÃO vira vazio — é escrito como "false"', () => {
    expect(renderTemplate('[{{v}}]', { v: false })).toBe('[false]');
  });

  it('string vazia continua vazia', () => {
    expect(renderTemplate('[{{v}}]', { v: '' })).toBe('[]');
  });

  it('números e datas são convertidos para texto', () => {
    expect(renderTemplate('{{n}}', { n: 250.5 })).toBe('250.5');
  });

  it.each([
    [null, ''],
    [undefined, ''],
    [0, ''],
    ['', ''],
    [false, ''],
  ])('template %s devolve string vazia', (entrada, esperado) => {
    expect(renderTemplate(entrada, { nome: 'Ana' })).toBe(esperado);
  });

  it('template numérico é convertido para texto', () => {
    expect(renderTemplate(2026, {})).toBe('2026');
  });

  it('template sem variáveis passa intacto', () => {
    expect(renderTemplate('Bom dia.', { nome: 'Ana' })).toBe('Bom dia.');
  });

  it.each([
    '{{no-me}}',
    '{{nome completo}}',
    '{{nome.completo}}',
    '{ {nome} }',
    '{{}}',
    '{{{nome}}',
  ])('não substitui %s (chave fora de \\w+)', (tpl) => {
    const out = renderTemplate(tpl, { nome: 'Ana', 'no-me': 'X', '': 'Y' });
    expect(out).toContain('{');
  });

  it('chave com dígitos e underscore é substituída', () => {
    expect(renderTemplate('{{parcela_2}}', { parcela_2: 'ok' })).toBe('ok');
  });

  it('um valor que contém {{outra}} não volta a ser substituído', () => {
    const out = renderTemplate('{{a}}', { a: '{{b}}', b: 'BOOM' });
    expect(out).toBe('{{b}}');
  });

  it('um valor com $& não é interpretado como padrão de substituição', () => {
    expect(renderTemplate('[{{v}}]', { v: '$&$1' })).toBe('[$&$1]');
  });

  it('preserva quebras de linha e acentuação', () => {
    expect(renderTemplate('Olá {{n}}\nAté já.', { n: 'Inês' })).toBe('Olá Inês\nAté já.');
  });

  // BUG: `vars[k]` apanha as propriedades herdadas de Object.prototype — um
  // {{constructor}} ou {{toString}} no template escreve lixo em vez de vazio.
  it.fails('{{constructor}} devia ficar vazio e não escrever o Object nativo', () => {
    expect(renderTemplate('[{{constructor}}]', { nome: 'Ana' })).toBe('[]');
  });

  it.fails('{{toString}} devia ficar vazio', () => {
    expect(renderTemplate('[{{toString}}]', {})).toBe('[]');
  });

  // Armadilha: `vars` não tem valor por omissão. Sem segundo argumento só
  // sobrevive um template sem variáveis.
  it('sem o objeto de variáveis rebenta se houver alguma variável', () => {
    expect(() => renderTemplate('Olá {{nome}}')).toThrow(TypeError);
  });

  it('sem o objeto de variáveis um template literal passa na mesma', () => {
    expect(renderTemplate('Bom dia.')).toBe('Bom dia.');
  });
});
