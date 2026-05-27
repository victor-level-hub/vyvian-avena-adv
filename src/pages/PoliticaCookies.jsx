import ScrollReveal from "../components/ScrollReveal";

const SECTIONS = [
  {
    title: "1. Introdução",
    content: "O nosso sítio web utiliza cookies e tecnologias semelhantes para garantir o seu correto funcionamento, melhorar a experiência de navegação e, mediante consentimento, personalizar conteúdos. O presente documento informa sobre a utilização de cookies no nosso sítio.",
  },
  {
    title: "2. O que são cookies?",
    content: "Um cookie é um pequeno ficheiro que é enviado juntamente com as páginas do nosso sítio e guardado pelo seu navegador no disco rígido do seu computador ou dispositivo. As informações guardadas podem ser enviadas de volta aos nossos servidores numa visita subsequente.",
  },
  {
    title: "3. Tipos de cookies que utilizamos",
    items: [
      { label: "Cookies técnicos/funcionais", text: "Necessários para o funcionamento correto do sítio. Não requerem consentimento." },
      { label: "Cookies estatísticos", text: "Utilizados exclusivamente para fins estatísticos anónimos, permitindo-nos compreender como os visitantes interagem com o sítio." },
      { label: "Cookies de marketing", text: "Utilizados para criar perfis de utilizador e apresentar publicidade relevante. Apenas ativados com o seu consentimento explícito." },
    ],
  },
  {
    title: "4. Os seus direitos",
    content: "Nos termos do Regulamento Geral sobre a Proteção de Dados (RGPD), tem direito a aceder, retificar, apagar, portar os seus dados pessoais, bem como a opor-se ao seu tratamento. Para exercer qualquer um destes direitos, pode contactar-nos através dos meios indicados abaixo.",
  },
  {
    title: "5. Gestão de cookies",
    content: "Pode desativar os cookies através das definições do seu navegador. No entanto, a desativação de determinados cookies pode afetar o funcionamento correto do sítio. Consulte a documentação do seu navegador para mais informações sobre como gerir as suas preferências de cookies.",
  },
  {
    title: "6. Contacto",
    contact: true,
  },
];

export default function PoliticaCookies() {
  return (
    <div>
      {/* Hero */}
      <section className="bg-forest pt-32 pb-20 px-6 md:px-12">
        <div className="max-w-3xl mx-auto">
          <ScrollReveal>
            <div className="h-px w-16 bg-gold mb-6" />
            <h1 className="font-heading text-4xl md:text-5xl text-warmwhite mb-4">Política de Cookies</h1>
            <p className="font-body text-warmwhite/50 text-sm">Última atualização: 18 de junho de 2025</p>
          </ScrollReveal>
        </div>
      </section>

      {/* Content */}
      <section className="py-20 px-6 md:px-12 max-w-3xl mx-auto">
        <div className="space-y-14">
          {SECTIONS.map((section, i) => (
            <ScrollReveal key={i} delay={i * 60}>
              <div>
                <div className="h-px w-12 bg-gold mb-5" />
                <h2 className="font-heading text-2xl text-forest mb-4">{section.title}</h2>
                {section.content && (
                  <p className="font-body text-forest/70 leading-relaxed">{section.content}</p>
                )}
                {section.items && (
                  <div className="space-y-4 mt-2">
                    {section.items.map((item) => (
                      <div key={item.label} className="pl-4 border-l-2 border-gold/40">
                        <p className="font-body text-forest font-medium text-sm mb-1">{item.label}</p>
                        <p className="font-body text-forest/60 text-sm leading-relaxed">{item.text}</p>
                      </div>
                    ))}
                  </div>
                )}
                {section.contact && (
                  <div className="space-y-2 font-body text-forest/70 text-sm leading-relaxed">
                    <p><strong className="text-forest">Vyvian Avena Advogada</strong></p>
                    <p>Rua António Nobre 1D 3.º DTO, Dream Offices — Cacilhas, 2800-260, Portugal</p>
                    <p>
                      Email:{" "}
                      <a href="mailto:vyvianavena-60987P@adv.oa.pt" className="text-gold hover:underline">
                        vyvianavena-60987P@adv.oa.pt
                      </a>
                    </p>
                    <p>
                      Telefone:{" "}
                      <a href="tel:+351911831530" className="text-gold hover:underline">
                        +351 911 831 530
                      </a>
                    </p>
                  </div>
                )}
              </div>
            </ScrollReveal>
          ))}
        </div>
      </section>
    </div>
  );
}