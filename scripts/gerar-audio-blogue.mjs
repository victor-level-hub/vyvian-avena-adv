/**
 * Gera a narração de um artigo do blogue com a API da ElevenLabs
 * (com timestamps palavra a palavra, para a leitura acompanhada do site).
 *
 * Uso:
 *   ELEVENLABS_API_KEY=sk_... node scripts/gerar-audio-blogue.mjs --slug <slug> [--model turbo]
 *
 * Saída:
 *   public/blog-audio/<slug>.mp3   — introdução + corpo do artigo
 *   public/blog-audio/<slug>.json  — { duracao, intro_fim, palavras: [[ini,fim],...] }
 *
 * Modelos:
 *   (default) eleven_multilingual_v2 — melhor qualidade; textos longos são divididos
 *             em blocos com request stitching e concatenados com ffmpeg (obrigatório).
 *   --model turbo → eleven_turbo_v2_5 — 1 pedido único até 40k chars, sem ffmpeg
 *             (útil na máquina do Victor, onde pode não haver ffmpeg).
 *
 * A ordem das palavras na narração do corpo é EXATAMENTE a ordem dos text nodes
 * do HTML gerado pelo marked — a mesma que o AudioArtigo.jsx percorre no DOM.
 * Se editares o texto do artigo, tens de regenerar o áudio.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from "fs";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { marked } from "marked";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(__dirname, "..");

const args = process.argv.slice(2);
const opt = (nome, def) => {
  const i = args.indexOf(`--${nome}`);
  return i !== -1 ? args[i + 1] : def;
};
const SLUG = opt("slug");
const VOICE = opt("voice", "JGnWZj684pcXmK2SxYIv"); // Claudia - Friendly (pt-PT)
const MODEL = opt("model", "multilingual") === "turbo" ? "eleven_turbo_v2_5" : "eleven_multilingual_v2";
const KEY = process.env.ELEVENLABS_API_KEY;

if (!SLUG || !KEY) {
  console.error("Uso: ELEVENLABS_API_KEY=sk_... node scripts/gerar-audio-blogue.mjs --slug <slug> [--model turbo]");
  process.exit(1);
}

// ---------- extrair texto do artigo (mesma lógica de src/data/blog.js) ----------
const raw = readFileSync(join(RAIZ, "src", "content", "blog", `${SLUG}.md`), "utf-8");
const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
const meta = {};
if (fm) for (const l of fm[1].split(/\r?\n/)) { const i = l.indexOf(":"); if (i > -1) meta[l.slice(0, i).trim()] = l.slice(i + 1).trim(); }
const body = fm ? raw.slice(fm[0].length) : raw;
const html = marked.parse(body);

const limpar = (s) =>
  s.replace(/<[^>]+>/g, " ")
   .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
   .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");

// palavras exatamente como o DOM as apresenta (para validação)
const palavrasDom = limpar(html).split(/\s+/).filter(Boolean);

// narração do corpo: blocos de topo na ordem do documento (h2/h3/p/li/blockquote),
// sem duplicar o <p> dentro do blockquote
const blocos = [...html.matchAll(/<(h2|h3|p|li|blockquote)[^>]*>([\s\S]*?)<\/\1>/g)]
  .map((m) => limpar(m[2]).replace(/\s+/g, " ").trim())
  .filter(Boolean);
const vistos = new Set();
const corpoDom = blocos.filter((b) => !vistos.has(b) && vistos.add(b)).join("\n\n");
{
  const pc = corpoDom.split(/\s+/).filter(Boolean);
  if (pc.length !== palavrasDom.length || !pc.every((w, i) => w === palavrasDom[i])) {
    console.error("ERRO: a extração não coincide palavra a palavra com o DOM.");
    process.exit(1);
  }
}

// ---------- normalização falada (mantendo o mapeamento token→palavras) ----------
// Cada token do DOM pode corresponder a VÁRIAS palavras faladas; `grupos[i]`
// guarda quantas, para depois agregar os timestamps por token do ecrã.
const CARD = (n) => {
  const U = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez",
    "onze", "doze", "treze", "catorze", "quinze", "dezasseis", "dezassete", "dezoito", "dezanove"];
  const D = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
  const C = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];
  if (n === 100) return "cem";
  const c = Math.floor(n / 100), r = n % 100;
  const dz = r < 20 ? U[r] : D[Math.floor(r / 10)] + (r % 10 ? " e " + U[r % 10] : "");
  return [c ? C[c] : "", c && r ? "e" : "", dz].filter(Boolean).join(" ");
};
const ORD_M = ["", "primeiro", "segundo", "terceiro", "quarto", "quinto", "sexto", "sétimo", "oitavo", "nono", "décimo"];
const ORD = (n, fem) => {
  let s;
  if (n <= 10) s = ORD_M[n];
  else if (n < 20) s = "décimo " + ORD_M[n - 10];
  else if (n === 20) s = "vigésimo";
  else if (n < 30) s = "vigésimo " + ORD_M[n - 20];
  else s = String(n); // fora do esperado: deixa em dígitos
  return fem ? s.replace(/o( |$)/g, "a$1") : s;
};
function falar(token) {
  if (token === "*") return "Nota:"; // marcador visual; falado como "Nota:"
  // €175,00 (com eventual pontuação a seguir) → "cento e setenta e cinco euros"
  let m = token.match(/^€(\d+),(\d{2})([)\].,;:!?»"]*)$/);
  if (m) {
    const eur = parseInt(m[1], 10), cent = parseInt(m[2], 10);
    let f = CARD(eur) + (eur === 1 ? " euro" : " euros");
    if (cent) f += " e " + CARD(cent) + (cent === 1 ? " cêntimo" : " cêntimos");
    return f + m[3];
  }
  // 18.º / 11.ª (com pontuação à volta) → ordinal por extenso
  m = token.match(/^([([«"]*)(\d+)\.(º|ª)([)\].,;:!?»"]*)$/);
  if (m) return m[1] + ORD(parseInt(m[2], 10), m[3] === "ª") + m[4];
  return token;
}
const tokensDom = corpoDom.split(/(\s+)/); // preserva separadores (parágrafos!)
const grupos = [];
const corpo = tokensDom.map((t) => {
  if (/^\s*$/.test(t)) return t;
  const f = falar(t);
  grupos.push(f.split(/\s+/).filter(Boolean).length);
  return f;
}).join("");
const totalFaladasCorpo = grupos.reduce((a, b) => a + b, 0);
const normalizados = grupos.filter((g) => g > 1).length;
console.log(`normalização falada: ${normalizados} tokens expandidos (${palavrasDom.length} tokens → ${totalFaladasCorpo} palavras faladas)`);

// ---------- introdução falada ----------
const UNID = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez",
  "onze", "doze", "treze", "catorze", "quinze", "dezasseis", "dezassete", "dezoito", "dezanove"];
const DEZ = ["", "", "vinte", "trinta", "quarenta", "cinquenta"];
const ext = (n) => (n < 20 ? UNID[n] : DEZ[Math.floor(n / 10)] + (n % 10 ? " e " + UNID[n % 10] : ""));
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const [ano, mes, dia] = (meta.data || "").split("-").map(Number);
const dataExt = `${ext(dia)} de ${MESES[mes - 1]} de dois mil${ano % 2000 ? " e " + ext(ano % 2000) : ""}`;
const minutos = Math.max(1, Math.round(body.replace(/[#>*_`\-]/g, " ").split(/\s+/).filter(Boolean).length / 200));

const intro =
  `Neste artigo: ${meta.descricao.replace(/\.$/, "")}.\n\n` +
  `Escrito pela Doutora Vyvian Avena, no dia ${dataExt}.\n\n` +
  `Artigo com ${ext(minutos)} minutos de leitura.`;

const narracao = intro + "\n\n" + corpo;
console.log(`Narração: ${narracao.length} chars · ${palavrasDom.length} palavras no corpo · modelo ${MODEL}`);

// ---------- chamadas à ElevenLabs ----------
async function tts(text, previous_text, next_text) {
  const payload = { text, model_id: MODEL };
  if (previous_text) payload.previous_text = previous_text.slice(-500);
  if (next_text) payload.next_text = next_text.slice(0, 500);
  const r = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE}/with-timestamps?output_format=mp3_44100_128`,
    { method: "POST", headers: { "xi-api-key": KEY, "Content-Type": "application/json" }, body: JSON.stringify(payload) }
  );
  if (!r.ok) throw new Error(`ElevenLabs ${r.status}: ${await r.text()}`);
  return r.json();
}

// dividir em blocos por parágrafo (limite do multilingual v2: 10k chars)
const LIMITE = MODEL === "eleven_turbo_v2_5" ? 38000 : 8500;
const partes = [];
let atual = "";
for (const p of narracao.split("\n\n")) {
  if (atual && atual.length + 2 + p.length > LIMITE) { partes.push(atual); atual = p; }
  else atual = atual ? atual + "\n\n" + p : p;
}
if (atual) partes.push(atual);
console.log("blocos:", partes.map((p) => p.length).join(", "));

const outDir = join(RAIZ, "public", "blog-audio");
mkdirSync(outDir, { recursive: true });
const mp3Final = join(outDir, `${SLUG}.mp3`);

const respostas = [];
for (let i = 0; i < partes.length; i += 1) {
  process.stdout.write(`a gerar bloco ${i + 1}/${partes.length}… `);
  const d = await tts(partes[i], partes[i - 1], partes[i + 1]);
  respostas.push(d);
  writeFileSync(join(outDir, `.${SLUG}.parte${i}.mp3`), Buffer.from(d.audio_base64, "base64"));
  console.log("ok");
}

// duração real de cada bloco (ffprobe se houver; senão, fim do último carácter)
function duracaoBloco(i) {
  try {
    const out = execFileSync("ffprobe", ["-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", join(outDir, `.${SLUG}.parte${i}.mp3`)], { encoding: "utf-8" });
    return parseFloat(out.trim());
  } catch {
    const t = respostas[i].alignment.character_end_times_seconds;
    return t[t.length - 1];
  }
}

// concatenar
if (partes.length === 1) {
  writeFileSync(mp3Final, Buffer.from(respostas[0].audio_base64, "base64"));
} else {
  try {
    const lista = join(outDir, `.${SLUG}.lista.txt`);
    writeFileSync(lista, partes.map((_, i) => `file '.${SLUG}.parte${i}.mp3'`).join("\n"));
    execFileSync("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", lista, "-c", "copy", "-write_xing", "0", mp3Final], { cwd: outDir, stdio: "pipe" });
    unlinkSync(lista);
  } catch (e) {
    console.error("ffmpeg indisponível — em máquinas sem ffmpeg usa --model turbo (pedido único).");
    throw e;
  }
}

// ---------- timestamps por palavra ----------
const introPalavras = intro.split(/\s+/).filter(Boolean).length;
let offset = 0;
const todas = []; // [inicio, fim] de todas as palavras da narração
for (let i = 0; i < respostas.length; i += 1) {
  const { characters, character_start_times_seconds: ini, character_end_times_seconds: fim } = respostas[i].alignment;
  let w = null;
  for (let c = 0; c < characters.length; c += 1) {
    if (/\s/.test(characters[c])) {
      if (w) { todas.push(w); w = null; }
    } else {
      if (!w) w = [offset + ini[c], offset + fim[c]];
      else w[1] = offset + fim[c];
    }
  }
  if (w) todas.push(w);
  offset += duracaoBloco(i);
}
const esperado = introPalavras + totalFaladasCorpo;
if (todas.length !== esperado) {
  console.error(`ERRO: ${todas.length} palavras temporizadas ≠ ${esperado} esperadas.`);
  process.exit(1);
}
// agregar palavras faladas → tokens do DOM (um intervalo por token do ecrã)
const faladas = todas.slice(introPalavras);
const porToken = [];
let cursor = 0;
for (const g of grupos) {
  porToken.push([faladas[cursor][0], faladas[cursor + g - 1][1]]);
  cursor += g;
}
const arred = (x) => Math.round(x * 100) / 100;
const dados = {
  duracao: arred(offset),
  intro_fim: arred(todas[introPalavras - 1][1]),
  palavras: porToken.map(([a, b]) => [arred(a), arred(b)]),
};
writeFileSync(join(outDir, `${SLUG}.json`), JSON.stringify(dados));
for (let i = 0; i < partes.length; i += 1) { try { unlinkSync(join(outDir, `.${SLUG}.parte${i}.mp3`)); } catch { /* noop */ } }
console.log(`✅ ${SLUG}.mp3 (${(offset / 60).toFixed(1)} min) + ${SLUG}.json (${dados.palavras.length} palavras)`);
