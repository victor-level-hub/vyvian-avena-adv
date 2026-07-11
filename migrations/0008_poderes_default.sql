-- migrations/0008_poderes_default.sql
-- Move o bloco de poderes forenses do corpo fixo do modelo para o campo
-- editável (poderes_default), permitindo à Dra. editar tudo antes de gerar.
-- Executar via: wrangler d1 execute vyvian-avena-db --remote --file=migrations/0008_poderes_default.sql
--
-- NOTA (2026-07-11): a tabela procuracao_templates tinha sido criada fora das
-- migrações, diretamente no D1 de produção — numa BD limpa (demos a outros
-- advogados), este ficheiro falhava no ALTER. O CREATE + seed abaixo tornam a
-- migração auto-suficiente; em produção são no-ops (IF NOT EXISTS / OR IGNORE).
-- Conteúdo dos 3 templates extraído verbatim da produção via API a 2026-07-11.

CREATE TABLE IF NOT EXISTS procuracao_templates (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  country TEXT NOT NULL,
  categoria TEXT NOT NULL,
  corpo TEXT NOT NULL,
  campos_editaveis TEXT NOT NULL DEFAULT '[]',
  ativo INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO procuracao_templates (id, nome, country, categoria, corpo, campos_editaveis)
VALUES ('pt-injuncao', 'Injunção / Ação Executiva', 'PT', 'Forense',
  '{{nome}}, {{estado_civil}}, portador(a) do {{doc_tipo}} n.º {{doc_numero}}, emitido pela República Portuguesa, válido até {{doc_validade}}, contribuinte fiscal número {{nif}}, residente e domiciliado na {{morada}}, constitui seu bastante procurador, a Dra. Vyvian Avena, advogada, titular da cédula profissional 60987p, com escritório na Rua Comendador Sá Couto, 112, 4.º, Sala 2, 4520-192 SANTA MARIA DA FEIRA{{poderes}}',
  '["poderes"]');

INSERT OR IGNORE INTO procuracao_templates (id, nome, country, categoria, corpo, campos_editaveis)
VALUES ('pt-inventario', 'Inventário Judicial', 'PT', 'Forense',
  '{{nome}}, {{estado_civil}}, portador(a) do {{doc_tipo}} n.º {{doc_numero}}, emitido pela República Portuguesa, válido até {{doc_validade}}, contribuinte fiscal número {{nif}}, residente e domiciliada na {{morada}}, constitui seu bastante procurador, a Dra. Vyvian Avena, advogada, titular da cédula profissional 60987p, com escritório na Rua Comendador Sá Couto, 112, 4.°, Sala 2, 4520-192 SANTA MARIA DA FEIRA, a quem concede, com a faculdade de substabelecer, os mais amplos poderes em direito permitidos e, especialmente, {{poderes}}

Para esse efeito, a mandatária fica expressamente autorizada a praticar todos os atos necessários à tramitação do referido processo, incluindo a junção de documentos, apresentação de requerimentos, obtenção de legalizações e traduções, resposta a notificações judiciais, bem como recorrer, transigir, desistir ou acordar nos termos legais, agindo sempre em nome e representação do outorgante, com os poderes forenses gerais e especiais que ao caso couberem.',
  '["poderes"]');

INSERT OR IGNORE INTO procuracao_templates (id, nome, country, categoria, corpo, campos_editaveis)
VALUES ('pt-nacionalidade', 'Aquisição de Nacionalidade Portuguesa', 'PT', 'Nacionalidade',
  '{{nome}}, {{estado_civil}}, portador(a) do {{doc_tipo}} n.º {{doc_numero}}, válido até {{doc_validade}}, residente na {{morada}}, natural de {{naturalidade}}, de nacionalidade {{nacionalidade}}, constitui sua bastante procuradora a Dra. Vyvian Avena, advogada, titular da cédula profissional n.º 60987P, com escritório na Rua Comendador Sá Couto, n.º 112, 4.º, Sala 2, 4520-192 Santa Maria da Feira, a quem confere poderes especiais para a representar junto dos Balcões de Nacionalidade, das Conservatórias do Registo Civil, do Arquivo Central do Porto e da Conservatória dos Registos Centrais, para todos os efeitos necessários à aquisição da nacionalidade portuguesa, podendo para o efeito declarar, praticar e assinar tudo o que seja necessário ao indicado fim, nomeadamente a declaração para fins de inscrição de nascimento ou de atribuição da nacionalidade, bem como requerer informações, apresentar reclamações, interpor recursos hierárquicos ou contenciosos e intentar quaisquer atos administrativos ou judiciais contra agentes ou entidades públicas que causem atrasos ou omissões na tramitação do processo, podendo, se necessário, substabelecer, no todo ou em parte, os poderes que ora lhe são conferidos, com ou sem reserva de poderes.',
  '[]');

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
