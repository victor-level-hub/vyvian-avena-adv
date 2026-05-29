import { useState, useEffect } from "react";
import { X } from "lucide-react";

const STORAGE_KEY = "cookie_consent";

export default function CookieBanner() {
  const [visible, setVisible] = useState(false);
  const [showPrefs, setShowPrefs] = useState(false);
  const [prefs, setPrefs] = useState({ statistics: true, marketing: false });

  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) setVisible(true);
  }, []);

  const accept = (value) => {
    localStorage.setItem(STORAGE_KEY, value);
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 9999,
      background: '#12302a', borderTop: '1.5px solid #b8935a',
      boxShadow: '0 -4px 32px rgba(0,0,0,0.25)',
      fontFamily: 'Mulish, sans-serif',
    }}>
      <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '24px 32px' }}>
        {!showPrefs ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '24px', justifyContent: 'space-between' }}>
            <div style={{ flex: 1, minWidth: '260px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                <span style={{ fontSize: '20px' }}>🍪</span>
                <span style={{ fontFamily: 'Fraunces, serif', fontSize: '18px', fontWeight: 600, color: '#faf8f4', letterSpacing: '0.02em' }}>
                  Preferências de Privacidade
                </span>
              </div>
              <p style={{ color: 'rgba(250,248,244,0.65)', fontSize: '13px', lineHeight: 1.6, margin: 0, maxWidth: '640px' }}>
                Utilizamos cookies para garantir o funcionamento adequado do sítio e melhorar a sua experiência. Pode aceitar todos os cookies, apenas os essenciais, ou personalizar as suas preferências.{' '}
                <a href="/politica-cookies" target="_blank" rel="noopener noreferrer" style={{ color: '#b8935a', textDecoration: 'underline' }}>
                  Política de Cookies
                </a>
              </p>
            </div>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                onClick={() => accept('essential')}
                style={{ padding: '9px 20px', border: '1.5px solid #b8935a', background: 'transparent', color: '#b8935a', fontSize: '12px', letterSpacing: '0.12em', textTransform: 'uppercase', cursor: 'pointer', fontFamily: 'Mulish, sans-serif', fontWeight: 500 }}
              >
                Apenas Essenciais
              </button>
              <button
                onClick={() => setShowPrefs(true)}
                style={{ padding: '9px 20px', border: 'none', background: 'transparent', color: 'rgba(250,248,244,0.6)', fontSize: '12px', letterSpacing: '0.12em', textTransform: 'uppercase', cursor: 'pointer', fontFamily: 'Mulish, sans-serif', fontWeight: 500 }}
              >
                Personalizar
              </button>
              <button
                onClick={() => accept('accepted')}
                style={{ padding: '9px 22px', border: 'none', background: '#b8935a', color: '#faf8f4', fontSize: '12px', letterSpacing: '0.12em', textTransform: 'uppercase', cursor: 'pointer', fontFamily: 'Mulish, sans-serif', fontWeight: 500 }}
              >
                Aceitar Todos
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <span style={{ fontFamily: 'Fraunces, serif', fontSize: '18px', fontWeight: 600, color: '#faf8f4' }}>
                Personalizar Preferências
              </span>
              <button onClick={() => setShowPrefs(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'rgba(250,248,244,0.5)' }}>
                <X size={18} />
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '20px' }}>
              {[
                { key: 'functional', label: 'Cookies Funcionais', desc: 'Necessários para o funcionamento do sítio. Sempre ativos.', locked: true },
                { key: 'statistics', label: 'Cookies Estatísticos', desc: 'Permitem-nos compreender como os visitantes interagem com o sítio.', locked: false },
                { key: 'marketing', label: 'Cookies de Marketing', desc: 'Utilizados para apresentar publicidade relevante.', locked: false },
              ].map((item) => (
                <div key={item.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px' }}>
                  <div>
                    <p style={{ color: '#faf8f4', fontSize: '13px', fontWeight: 500, margin: '0 0 2px' }}>{item.label}</p>
                    <p style={{ color: 'rgba(250,248,244,0.5)', fontSize: '12px', margin: 0 }}>{item.desc}</p>
                  </div>
                  <div
                    onClick={() => !item.locked && setPrefs(p => ({ ...p, [item.key]: !p[item.key] }))}
                    style={{
                      width: '40px', height: '22px', borderRadius: '11px', flexShrink: 0,
                      background: (item.locked || prefs[item.key]) ? '#b8935a' : 'rgba(250,248,244,0.2)',
                      cursor: item.locked ? 'default' : 'pointer', position: 'relative', transition: 'background 0.2s',
                    }}
                  >
                    <div style={{
                      position: 'absolute', top: '3px',
                      left: (item.locked || prefs[item.key]) ? '21px' : '3px',
                      width: '16px', height: '16px', borderRadius: '50%', background: '#faf8f4', transition: 'left 0.2s',
                    }} />
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => accept('custom')}
                style={{ padding: '9px 22px', border: 'none', background: '#b8935a', color: '#faf8f4', fontSize: '12px', letterSpacing: '0.12em', textTransform: 'uppercase', cursor: 'pointer', fontFamily: 'Mulish, sans-serif', fontWeight: 500 }}
              >
                Guardar Preferências
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
