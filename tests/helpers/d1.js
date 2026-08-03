// tests/helpers/d1.js
// Shim do Cloudflare D1 sobre o SQLite nativo do Node (node:sqlite).
// O SQL corre a sério — um erro de sintaxe, uma coluna que não existe ou uma
// restrição violada rebentam o teste, ao contrário de um mock que aceita tudo.

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS = join(process.cwd(), 'migrations');

// D1 aceita undefined/boolean; o node:sqlite não. Normalizar na fronteira.
function coerce(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number' && !Number.isInteger(v)) return v;
  return v;
}

class Stmt {
  constructor(db, sql, tracker) {
    this.db = db;
    this.sql = sql;
    this.args = [];
    this.tracker = tracker;
  }
  bind(...args) {
    this.args = args.map(coerce);
    return this;
  }
  _prep() {
    this.tracker?.push({ sql: this.sql, args: this.args });
    return this.db.prepare(this.sql);
  }
  async first(col) {
    const row = this._prep().get(...this.args) ?? null;
    if (row && col !== undefined) return row[col] ?? null;
    return row ? { ...row } : null;
  }
  async all() {
    const rows = this._prep().all(...this.args).map((r) => ({ ...r }));
    return { results: rows, success: true, meta: { rows_read: rows.length } };
  }
  async run() {
    const st = this._prep();
    // RETURNING obriga a usar get/all — o run() do node:sqlite recusa-o.
    if (/\bRETURNING\b/i.test(this.sql)) {
      const rows = st.all(...this.args).map((r) => ({ ...r }));
      return { success: true, results: rows, meta: { changes: rows.length } };
    }
    const out = st.run(...this.args);
    return {
      success: true,
      meta: { changes: out.changes, last_row_id: Number(out.lastInsertRowid) },
    };
  }
}

export class FakeD1 {
  constructor({ migrations = true } = {}) {
    this.db = new DatabaseSync(':memory:');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.queries = []; // histórico, para asserções sobre o SQL emitido
    if (migrations) this.aplicarMigracoes();
  }

  aplicarMigracoes() {
    const ficheiros = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
    for (const f of ficheiros) {
      const sql = readFileSync(join(MIGRATIONS, f), 'utf8');
      try {
        this.db.exec(sql);
      } catch (e) {
        throw new Error(`Migração ${f} falhou: ${e.message}`);
      }
    }
  }

  prepare(sql) {
    return new Stmt(this.db, sql, this.queries);
  }

  async batch(stmts) {
    const out = [];
    this.db.exec('BEGIN');
    try {
      for (const s of stmts) out.push(await s.run());
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    return out;
  }

  // atalhos para os testes (não fazem parte da API do D1)
  exec(sql) { this.db.exec(sql); }
  linhas(sql, ...args) { return this.db.prepare(sql).all(...args.map(coerce)).map((r) => ({ ...r })); }
  linha(sql, ...args) { const r = this.db.prepare(sql).get(...args.map(coerce)); return r ? { ...r } : null; }
  conta(tabela, where = '1=1') { return this.db.prepare(`SELECT COUNT(*) AS n FROM ${tabela} WHERE ${where}`).get().n; }
}
