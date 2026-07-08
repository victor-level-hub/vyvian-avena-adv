-- migrations/0008_poderes_default.sql
-- Move o bloco de poderes forenses do corpo fixo do modelo para o campo
-- editável (poderes_default), permitindo à Dra. editar tudo antes de gerar.
-- Executar via: wrangler d1 execute vyvian-avena-db --remote --file=migrations/0008_poderes_default.sql

ALTER TABLE procuracao_templates ADD COLUMN poderes_default TEXT;

-- Injunção / Ação Executiva: corpo termina no escritório; todo o bloco de
-- poderes (incl. 2.º parágrafo) passa a ser editável
UPDATE procuracao_templates SET
  corpo = '{{nome}}, {{estado_civil}}, portador(a) do {{doc_tipo}} n.º {{doc_numero}}, emitido pela República Portuguesa, válido até {{doc_validade}}, contribuinte fiscal número {{nif}}, residente e domiciliado na {{morada}}, constitui seu bastante procurador, a Dra. Vyvian Avena, advogada, titular da cédula profissional 60987p, com escritório na Rua Comendador Sá Couto, 112, 4.º, Sala 2, 4520-192 SANTA MARIA DA FEIRA{{poderes}}',
  poderes_default = ', a quem confere, com faculdade de substabelecer, os mais amplos poderes forenses em Direito permitidos e, em especial, poderes para o representar no âmbito do processo n.º [INDICAR] e processos conexos, incluindo a junção de documentos, apresentação de requerimentos, resposta a notificações, interposição de recursos e prática de todos os demais atos processuais necessários à defesa dos seus direitos.

Para esse efeito, a mandatária fica expressamente autorizada a praticar todos os atos necessários à tramitação do referido processo, incluindo requerer certidões, obter legalizações e traduções, responder a notificações judiciais, recorrer, transigir, desistir ou acordar nos termos legais, bem como praticar todos os atos de representação forense geral e especial que ao caso couberem, agindo sempre em nome e representação do outorgante.',
  updated_at = datetime('now')
WHERE id = 'pt-injuncao';

-- Inventário: mantém a estrutura própria; default do bloco editável
UPDATE procuracao_templates SET
  poderes_default = 'poderes para o representar no âmbito do processo n.º [INDICAR] e processos conexos, incluindo a junção de documentos, apresentação de requerimentos, resposta a notificações, interposição de recursos e prática de todos os demais atos processuais necessários à defesa dos seus direitos.',
  updated_at = datetime('now')
WHERE id = 'pt-inventario';
