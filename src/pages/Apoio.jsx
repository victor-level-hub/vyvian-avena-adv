import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ChevronDown, MessageCircle } from "lucide-react";
import ScrollReveal from "../components/ScrollReveal";

const STEPS = [
  { num: "01", title: "Contacto", desc: "Entre em contacto via formulário, telefone ou WhatsApp para agendar a sua consulta." },
  { num: "02", title: "Consulta", desc: "Na primeira consulta, analisamos o seu caso, esclarecemos dúvidas e traçamos as opções disponíveis." },
  { num: "03", title: "Análise", desc: "Estudo aprofundado do caso com elaboração da estratégia jurídica mais adequada." },
  { num: "04", title: "Acompanhamento", desc: "Acompanhamento contínuo e próximo durante todo o processo, com comunicação regular." },
];

const FAQS = [
  { q: "Como decorre a primeira consulta?", a: "A primeira consulta tem uma duração aproximada de 45 a 60 minutos, durante a qual ouvimos com atenção a sua situação, esclarecemos as principais dúvidas e fazemos uma análise preliminar das opções disponíveis. No final, caso decida avançar, apresentamos uma proposta de honorários por escrito. Pode comparecer presencialmente em qualquer um dos nossos escritórios ou optar pela modalidade online." },
  { q: "A consulta pode ser feita por videochamada?", a: "Sim. Atendemos clientes por videochamada (Zoom, Google Meet ou WhatsApp) sempre que a presença física não seja necessária. Esta modalidade é particularmente útil para quem vive fora das zonas dos nossos escritórios ou em mobilidade internacional. A qualidade do acompanhamento é equivalente à do atendimento presencial." },
  { q: "Que documentos devo levar à primeira consulta?", a: "Sugerimos trazer todos os documentos relacionados com a sua situação: identificação pessoal, contratos, notificações, decisões anteriores, certidões e qualquer correspondência relevante. Em caso de dúvida, traga tudo o que tenha — preferimos analisar mais e descartar do que descobrir, mais tarde, que falta uma peça essencial. Em consulta online, pode partilhar os ficheiros digitalmente antes da reunião." },
  { q: "Em quanto tempo respondem ao primeiro contacto?", a: "Procuramos responder a todos os pedidos em 24 a 48 horas úteis. Caso a sua situação seja urgente, indique-o explicitamente no formulário ou na mensagem que nos enviar — anteciparemos a resposta sempre que possível." },
  { q: "Atendem clientes em Portugal e no Brasil?", a: "Sim. Mantemos escritórios em Cacilhas (Almada), Santa Maria da Feira e Tijuca (Rio de Janeiro), e a Dra. Vyvian Avena exerce regularmente nos dois países. Esta presença permite-nos acompanhar matérias que envolvam as duas jurisdições — como nacionalidade, reagrupamento familiar, heranças com bens em ambos os territórios e divórcios internacionais — sem ter de recorrer a correspondentes externos." },
  { q: "Sou brasileiro(a) a viver em Portugal — podem ajudar-me?", a: "Este é um dos perfis de clientes que mais acompanhamos. Conhecemos as especificidades de quem se mudou recentemente, as exigências dos serviços de imigração, o processo de obtenção da nacionalidade portuguesa, e as questões patrimoniais e familiares que muitas vezes mantêm uma ligação ao Brasil. Coordenamos diretamente entre as duas equipas, sem fragmentação." },
  { q: "Sou português(a) com bens ou família no Brasil — atendem este perfil?", a: "Sim. Acompanhamos portugueses e luso-descendentes com necessidades jurídicas no Brasil — heranças, regularização de imóveis, cidadania para descendentes, e disputas familiares com elementos de conexão com o Brasil. A articulação entre os escritórios garante continuidade e poupa o cliente da habitual fragmentação dos processos internacionais." },
  { q: "Lido diretamente com a Dra. Vyvian ou com a equipa?", a: "A Dra. Vyvian conduz pessoalmente as decisões estratégicas, as audiências e as reuniões com o cliente. A equipa de apoio trata do acompanhamento administrativo e do contacto operacional do dia-a-dia. O cliente conhece sempre quem é a sua interlocutora principal e mantém canal directo com a advogada para os momentos que o justifiquem." },
  { q: "Como é assegurada a confidencialidade do meu caso?", a: "O sigilo profissional é um dever fundamental da advocacia, em Portugal e no Brasil, e aplica-se a tudo o que é partilhado connosco — desde o primeiro contacto, mesmo que o cliente decida não avançar com os nossos serviços. Internamente, o acesso aos dados é restrito ao mínimo necessário, os documentos digitais ficam guardados em sistemas com cifragem e acessos controlados, e toda a equipa subscreve um compromisso formal de confidencialidade." },
  { q: "O que acontece à informação que partilho se decidir não contratar?", a: "Toda a informação partilhada na fase de primeira consulta está coberta pelo sigilo profissional, independentemente de o cliente avançar ou não com os nossos serviços. Caso opte por não contratar, os documentos podem ser devolvidos ou destruídos a seu pedido, e as notas internas são eliminadas de acordo com a nossa política de retenção de dados." },
  { q: "Posso pedir segunda opinião antes de contratar?", a: "Sim, e encorajamos a fazê-lo sempre que tenha dúvidas. Disponibilizamo-nos para discutir abertamente como nos posicionamos face a outras estratégias possíveis. A confiança é o alicerce da relação entre advogado e cliente — não queremos que avance com os nossos serviços com hesitações por esclarecer." },
];

const DOCS = [
  { title: "Direito de Família", items: ["Documento de identificação", "Certidão de casamento", "Acordo de regulação (se aplicável)", "Documentos de rendimentos"] },
  { title: "Nacionalidade", items: ["Passaporte válido", "Certidão de nascimento", "Registo criminal", "Comprovativo de residência"] },
  { title: "Cobrança de Dívida", items: ["Contrato/acordo original", "Comprovativos de pagamento", "Correspondência com devedor", "Documentos fiscais relevantes"] },
];

export default function Apoio() {
  const [openFaq, setOpenFaq] = useState(null);

  return (
    <div>
      {/* Hero */}
      <section className="bg-forest pt-32 pb-20 px-6 md:px-12">
        <div className="max-w-5xl mx-auto">
          <ScrollReveal>
            <div className="h-px w-16 bg-gold mb-6" />
            <h1 className="font-heading text-4xl md:text-5xl text-warmwhite mb-4">Apoio ao Cliente</h1>
            <p className="font-body text-warmwhite/60 max-w-2xl text-lg">
              Toda a informação que precisa para o seu processo jurídico, de forma clara e acessível.
            </p>
          </ScrollReveal>
        </div>
      </section>

      {/* Process Steps */}
      <section className="py-24 px-6 md:px-12 max-w-5xl mx-auto">
        <ScrollReveal>
          <div className="h-px w-16 bg-gold mb-8" />
          <h2 className="font-heading text-3xl md:text-4xl text-forest mb-12">Como funciona o processo</h2>
        </ScrollReveal>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {STEPS.map((step, i) => (
            <ScrollReveal key={step.num} delay={i * 100}>
              <div className="relative">
                <span className="font-heading text-7xl text-forest/5 absolute -top-4 -left-2">{step.num}</span>
                <div className="relative pt-8">
                  <h3 className="font-heading text-xl text-forest mb-2">{step.title}</h3>
                  <p className="font-body text-sm text-forest/60 leading-relaxed">{step.desc}</p>
                </div>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="py-24 px-6 md:px-12 bg-cream">
        <div className="max-w-3xl mx-auto">
          <ScrollReveal>
            <div className="text-center mb-12">
              <div className="h-px w-16 bg-gold mx-auto mb-6" />
              <h2 className="font-heading text-3xl md:text-4xl text-forest mb-4">Perguntas Frequentes</h2>
            </div>
          </ScrollReveal>
          <div className="space-y-0">
            {FAQS.map((faq, i) => (
              <ScrollReveal key={i} delay={i * 50}>
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full text-left py-5 border-b border-border group"
                >
                  <div className="flex items-center justify-between gap-4">
                    <span className="font-body text-forest font-medium">{faq.q}</span>
                    <ChevronDown
                      className={`w-5 h-5 text-gold shrink-0 transition-transform duration-300 ${
                        openFaq === i ? "rotate-180" : ""
                      }`}
                    />
                  </div>
                  <div
                    className={`overflow-hidden transition-all duration-300 ${
                      openFaq === i ? "max-h-[600px] mt-3" : "max-h-0"
                    }`}
                  >
                    <p className="font-body text-sm text-forest/60 leading-relaxed">{faq.a}</p>
                  </div>
                </button>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* Documents */}
      <section className="py-24 px-6 md:px-12 max-w-5xl mx-auto">
        <ScrollReveal>
          <div className="h-px w-16 bg-gold mb-8" />
          <h2 className="font-heading text-3xl md:text-4xl text-forest mb-12">Documentos necessários</h2>
        </ScrollReveal>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {DOCS.map((doc, i) => (
            <ScrollReveal key={doc.title} delay={i * 100}>
              <div className="p-8 border border-border bg-warmwhite">
                <h3 className="font-heading text-xl text-forest mb-4">{doc.title}</h3>
                <ul className="space-y-2">
                  {doc.items.map((item) => (
                    <li key={item} className="flex items-start gap-2 text-sm text-forest/60 font-body">
                      <div className="w-1.5 h-1.5 bg-gold rounded-full mt-2 shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 px-6 md:px-12 bg-forest text-center">
        <ScrollReveal>
          <div className="max-w-xl mx-auto">
            <div className="h-px w-16 bg-gold mx-auto mb-8" />
            <h2 className="font-heading text-3xl md:text-4xl text-warmwhite mb-6">Precisa de ajuda?</h2>
            <p className="font-body text-warmwhite/60 mb-8">
              Entre em contacto connosco para agendar a sua consulta ou esclarecer dúvidas.
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <Link
                to="/contacto"
                className="px-8 py-3 bg-gold text-warmwhite font-body text-sm tracking-wide hover:bg-gold/90 transition-all flex items-center gap-2"
              >
                Contacte-nos
                <ArrowRight className="w-4 h-4" />
              </Link>
              <a
                href="https://wa.me/351911831530"
                target="_blank"
                rel="noopener noreferrer"
                className="px-8 py-3 border border-gold text-gold font-body text-sm tracking-wide hover:bg-gold hover:text-warmwhite transition-all flex items-center gap-2"
              >
                <MessageCircle className="w-4 h-4" />
                WhatsApp
              </a>
            </div>
          </div>
        </ScrollReveal>
      </section>
    </div>
  );
}