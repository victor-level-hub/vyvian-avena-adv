// src/admin/perms.js — permissões por aba da Área Privada.
// Sessões antigas (sem `permissions` no sessionStorage) veem tudo; os logins
// novos trazem as permissões reais do utilizador (geridas em Configurações).
import { getSession } from './auth';

export const ROTA_PERM = {
  '/admin/painel': 'painel',
  '/admin/clientes': 'clientes',
  '/admin/parcelas': 'parcelas',
  '/admin/calendario': 'calendario',
  '/admin/notificacoes': 'notificacoes',
  '/admin/estatisticas': 'estatisticas',
  '/admin/apoio': 'apoio',
  '/admin/configuracoes': 'configuracoes',
};

export function podeAceder(permKey) {
  const perms = getSession()?.permissions;
  if (!Array.isArray(perms)) return true;
  return perms.includes('*') || perms.includes(permKey);
}

export function primeiraRotaPermitida() {
  for (const [rota, k] of Object.entries(ROTA_PERM)) if (podeAceder(k)) return rota;
  return '/admin/login';
}
