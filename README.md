# Vyvian Avena Advogada

Site institucional + área privada de gestão financeira.

## Stack

- Frontend: React 18 + Vite + Tailwind CSS
- Hosting: Cloudflare Pages
- Backend (em desenvolvimento): Cloudflare D1 (BD), Workers (API), KV (sessões), R2 (recibos)
- Email outbound: Resend
- WhatsApp: Z-API

## Estrutura

- `src/` — site público (Home, Sobre, Áreas, Apoio, Contacto, Política de Cookies)
- `src/admin/` — área privada de gestão financeira (Painel, Clientes, Parcelas, Calendário, Notificações)

## Desenvolvimento local