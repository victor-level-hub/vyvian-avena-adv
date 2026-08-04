// worker/lib/validar.js
// Guardas de entrada partilhadas pelas rotas. Existem porque o mesmo tipo de
// engano aparecia em varios sitios: um valor que nao e numero gravado numa
// coluna REAL, uma data que nao e data a fazer a linha desaparecer das consultas
// com date()/strftime(), e violacoes de chave a chegarem ao cliente como 500.

// Numero utilizavel (aceita "1200", "1200.50" e 1200.5; recusa "abc", objetos, NaN)
export function numeroOuNull(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const t = v.trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// Data ISO aaaa-mm-dd que existe mesmo no calendario (recusa 2026-13-45 e 2026-02-30)
export function dataISOValida(v) {
  if (typeof v !== 'string') return false;
  // aceita "aaaa-mm-dd" e tambem data-hora ("...T14:00:00+01:00"), que o
  // calendario guarda; valida-se sempre a parte da data.
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(v.trim());
  if (!m) return false;
  const [, a, mes, d] = m.map(Number);
  const dt = new Date(Date.UTC(a, mes - 1, d));
  return dt.getUTCFullYear() === a && dt.getUTCMonth() === mes - 1 && dt.getUTCDate() === d;
}

// Traduz violacoes de restricao do SQLite em respostas que se percebem.
export function erroDeRestricao(e) {
  const msg = String((e && e.message) || e);
  if (/UNIQUE constraint/i.test(msg)) return { status: 409, texto: 'Ja existe um registo com esse identificador.' };
  if (/FOREIGN KEY constraint/i.test(msg)) return { status: 400, texto: 'Referencia inexistente (o cliente ou o tipo indicado nao existe).' };
  if (/NOT NULL constraint/i.test(msg)) return { status: 400, texto: 'Faltam campos obrigatorios.' };
  return null;
}
