import { useForm, ValidationError } from "@formspree/react";
import { Phone, Mail, Clock, MessageCircle } from "lucide-react";
import ScrollReveal from "../components/ScrollReveal";
import ContactMap from "../components/ContactMap";

const AREAS_OPTIONS = [
  "Direito de Família",
  "Direito Civil",
  "Direito Comercial",
  "Cobrança de Dívida",
  "Nacionalidade",
  "Direito Notarial",
  "Outro",
];

export default function Contacto() {
  const [state, handleSubmit] = useForm("mqewdklw");

  return (
    <div>
      {/* Hero */}
      <section className="bg-forest pt-32 pb-20 px-6 md:px-12">
        <div className="max-w-5xl mx-auto">
          <ScrollReveal>
            <div className="h-px w-16 bg-gold mb-6" />
            <h1 className="font-heading text-4xl md:text-5xl text-warmwhite mb-4">
              Contacto
            </h1>
            <p className="font-body text-warmwhite/60 max-w-2xl text-lg">
              Estamos disponíveis para esclarecer as suas dúvidas e agendar uma consulta.
            </p>
          </ScrollReveal>
        </div>
      </section>

      {/* Content */}
      <section className="py-24 px-6 md:px-12">
        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16">

          {/* Form */}
          <ScrollReveal>
            <div className="h-px w-16 bg-gold mb-8" />
            <h2 className="font-heading text-3xl text-forest mb-8">
              Envie-nos uma mensagem
            </h2>

            {state.succeeded ? (
              <div className="p-8 border border-gold bg-warmwhite text-center">
                <div className="font-heading text-2xl text-forest mb-2">
                  Mensagem enviada!
                </div>
                <p className="font-body text-forest/60 text-sm">
                  Entraremos em contacto brevemente. Obrigada pelo seu interesse.
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-6">
                {/* Nome + Email */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="font-body text-xs tracking-widest uppercase text-forest/60 mb-2 block">
                      Nome *
                    </label>
                    <input
                      type="text"
                      name="name"
                      required
                      className="w-full border border-border bg-warmwhite px-4 py-3 font-body text-sm text-forest focus:outline-none focus:border-gold transition-colors"
                    />
                    <ValidationError field="name" prefix="Nome" errors={state.errors} className="text-red-500 text-xs mt-1 font-body" />
                  </div>
                  <div>
                    <label className="font-body text-xs tracking-widest uppercase text-forest/60 mb-2 block">
                      Email *
                    </label>
                    <input
                      type="email"
                      name="email"
                      required
                      className="w-full border border-border bg-warmwhite px-4 py-3 font-body text-sm text-forest focus:outline-none focus:border-gold transition-colors"
                    />
                    <ValidationError field="email" prefix="Email" errors={state.errors} className="text-red-500 text-xs mt-1 font-body" />
                  </div>
                </div>

                {/* Telefone + Área */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="font-body text-xs tracking-widest uppercase text-forest/60 mb-2 block">
                      Telefone
                    </label>
                    <input
                      type="tel"
                      name="phone"
                      className="w-full border border-border bg-warmwhite px-4 py-3 font-body text-sm text-forest focus:outline-none focus:border-gold transition-colors"
                    />
                  </div>
                  <div>
                    <label className="font-body text-xs tracking-widest uppercase text-forest/60 mb-2 block">
                      Área de interesse
                    </label>
                    <select
                      name="area"
                      className="w-full border border-border bg-warmwhite px-4 py-3 font-body text-sm text-forest focus:outline-none focus:border-gold transition-colors"
                    >
                      <option value="">Selecione uma área</option>
                      {AREAS_OPTIONS.map((a) => (
                        <option key={a} value={a}>{a}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Mensagem */}
                <div>
                  <label className="font-body text-xs tracking-widest uppercase text-forest/60 mb-2 block">
                    Mensagem *
                  </label>
                  <textarea
                    name="message"
                    required
                    rows={5}
                    className="w-full border border-border bg-warmwhite px-4 py-3 font-body text-sm text-forest focus:outline-none focus:border-gold transition-colors resize-none"
                  />
                  <ValidationError field="message" prefix="Mensagem" errors={state.errors} className="text-red-500 text-xs mt-1 font-body" />
                </div>

                {/* Erro geral */}
                <ValidationError errors={state.errors} className="text-red-500 text-sm font-body" />

                <button
                  type="submit"
                  disabled={state.submitting}
                  className="w-full px-8 py-4 bg-gold text-warmwhite font-body text-sm tracking-widest uppercase hover:bg-gold/90 transition-all disabled:opacity-60"
                >
                  {state.submitting ? "A enviar..." : "Enviar mensagem"}
                </button>
              </form>
            )}
          </ScrollReveal>

          {/* Info + Mapa */}
          <ScrollReveal delay={200}>
            <div className="h-px w-16 bg-gold mb-8" />
            <h2 className="font-heading text-3xl text-forest mb-8">
              Informações de Contacto
            </h2>
            <div className="space-y-6 mb-8">
              <div className="flex items-start gap-4">
                <Phone className="w-5 h-5 text-gold mt-1 shrink-0" />
                <div>
                  <div className="font-body text-xs tracking-widest uppercase text-forest/40 mb-1">Telefone</div>
                  <a href="tel:+351911831530" className="font-body text-forest hover:text-gold transition-colors">
                    +351 911 831 530
                  </a>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <Mail className="w-5 h-5 text-gold mt-1 shrink-0" />
                <div>
                  <div className="font-body text-xs tracking-widest uppercase text-forest/40 mb-1">Email</div>
                  <a href="mailto:vyvianavena-60987P@adv.oa.pt" className="font-body text-forest hover:text-gold transition-colors">
                    vyvianavena-60987P@adv.oa.pt
                  </a>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <MessageCircle className="w-5 h-5 text-gold mt-1 shrink-0" />
                <div>
                  <div className="font-body text-xs tracking-widest uppercase text-forest/40 mb-1">WhatsApp</div>
                  <a href="https://wa.me/351911831530" target="_blank" rel="noopener noreferrer"
                    className="font-body text-forest hover:text-gold transition-colors">
                    +351 911 831 530
                  </a>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <Clock className="w-5 h-5 text-gold mt-1 shrink-0" />
                <div>
                  <div className="font-body text-xs tracking-widest uppercase text-forest/40 mb-1">Horário</div>
                  <p className="font-body text-forest text-sm">Segunda a Sexta: 9h00 — 18h00</p>
                </div>
              </div>
            </div>
            <ContactMap />
          </ScrollReveal>

        </div>
      </section>
    </div>
  );
}
