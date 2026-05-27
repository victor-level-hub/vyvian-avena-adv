// src/admin/mockData.js
// Dados fixos para desenvolvimento do frontend.
// Quando o BD estiver pronto, substituir estas exportações por chamadas ao Supabase.

export const TODAY = new Date('2026-05-27'); // Data fixa para o mock

// ============================================================
// CLIENTES
// ============================================================
export const CLIENTS = [
  {
    id: 'maria-soares',
    name: 'Maria Soares Pereira',
    email: 'msoares@email.pt',
    phone: '+351 91 234 5678',
    taxId: '234 567 890',
    country: 'PT',
    currency: 'EUR',
    area: 'Família',
    process: '1284/26',
    location: 'Cacilhas',
    initials: 'MS',
    planType: 'monthly', // avença mensal
    planTotal: null,
    planInstallments: null,
    monthlyValue: 450,
    startDate: '2024-09-01',
    reminderDays: 5,
    reminderChannels: ['email', 'whatsapp'],
    notes: 'Cliente desde Setembro 2024. Pagamento sempre pontual.',
  },
  {
    id: 'joao-lopes',
    name: 'João Lopes',
    email: 'jlopes@email.pt',
    phone: '+351 92 845 6712',
    taxId: '345 678 901',
    country: 'PT',
    currency: 'EUR',
    area: 'Cível',
    process: '1285/26',
    location: 'Cacilhas',
    initials: 'JL',
    planType: 'installment',
    planTotal: 3840,
    planInstallments: 12,
    monthlyValue: 320,
    startDate: '2026-02-28',
    reminderDays: 5,
    reminderChannels: ['email', 'whatsapp'],
    notes: '',
  },
  {
    id: 'pedro-almeida',
    name: 'Pedro Almeida',
    email: 'palmeida@email.pt',
    phone: '+351 96 555 1212',
    taxId: '456 789 012',
    country: 'PT',
    currency: 'EUR',
    area: 'Cível',
    process: '1280/26',
    location: 'Santa Maria da Feira',
    initials: 'PA',
    planType: 'installment',
    planTotal: 3800,
    planInstallments: 10,
    monthlyValue: 380,
    startDate: '2025-11-19',
    reminderDays: 5,
    reminderChannels: ['email'],
    notes: 'Atenção: histórico de atrasos. Confirmar via telefone após D+3.',
  },
  {
    id: 'empresa-avena',
    name: 'Empresa Avena Ltda',
    email: 'financeiro@avenaltda.com.br',
    phone: '+55 21 99876 5432',
    taxId: '12.345.678/0001-90',
    country: 'BR',
    currency: 'BRL',
    area: 'Empresarial',
    process: '2026/0089',
    location: 'Tijuca',
    initials: 'EA',
    planType: 'monthly',
    planTotal: null,
    planInstallments: null,
    monthlyValue: 4500,
    startDate: '2025-01-30',
    reminderDays: 7,
    reminderChannels: ['email'],
    notes: 'Faturamento dia 30. Contacto financeiro: Sra. Beatriz.',
  },
  {
    id: 'carla-mendes',
    name: 'Carla Mendes',
    email: 'cmendes@gmail.com',
    phone: '+351 91 887 4521',
    taxId: '567 890 123',
    country: 'PT',
    currency: 'EUR',
    area: 'Família',
    process: '1289/26',
    location: 'Cacilhas',
    initials: 'CM',
    planType: 'installment',
    planTotal: 3120,
    planInstallments: 6,
    monthlyValue: 520,
    startDate: '2026-04-01',
    reminderDays: 3,
    reminderChannels: ['email', 'whatsapp'],
    notes: '',
  },
  {
    id: 'sofia-ribeiro',
    name: 'Sofia Ribeiro',
    email: 'sribeiro@empresa.pt',
    phone: '+351 92 111 9988',
    taxId: '678 901 234',
    country: 'PT',
    currency: 'EUR',
    area: 'Trabalhista',
    process: '1278/26',
    location: 'Cacilhas',
    initials: 'SR',
    planType: 'monthly',
    planTotal: null,
    planInstallments: null,
    monthlyValue: 300,
    startDate: '2025-06-24',
    reminderDays: 5,
    reminderChannels: ['email', 'whatsapp'],
    notes: '',
  },
  {
    id: 'hugo-tavares',
    name: 'Hugo Tavares',
    email: 'htavares@empresa.pt',
    phone: '+351 93 444 5566',
    taxId: '789 012 345',
    country: 'PT',
    currency: 'EUR',
    area: 'Cível',
    process: '1240/25',
    location: 'Santa Maria da Feira',
    initials: 'HT',
    planType: 'installment',
    planTotal: 4800,
    planInstallments: 12,
    monthlyValue: 400,
    startDate: '2025-05-15',
    reminderDays: 5,
    reminderChannels: ['email'],
    notes: 'Processo concluído com êxito. Plano de pagamento quitado em Abril/2026.',
  },
  {
    id: 'lucas-ferreira',
    name: 'Lucas Ferreira',
    email: 'lferreira@email.pt',
    phone: '+351 91 333 7788',
    taxId: '890 123 456',
    country: 'PT',
    currency: 'EUR',
    area: 'Cível',
    process: '1287/26',
    location: 'Cacilhas',
    initials: 'LF',
    planType: 'installment',
    planTotal: 3360,
    planInstallments: 8,
    monthlyValue: 420,
    startDate: '2026-03-05',
    reminderDays: 5,
    reminderChannels: ['email', 'whatsapp'],
    notes: '',
  },
  {
    id: 'ines-cardoso',
    name: 'Inês Cardoso',
    email: 'icardoso@gmail.com',
    phone: '+351 92 555 1234',
    taxId: '901 234 567',
    country: 'PT',
    currency: 'EUR',
    area: 'Empresarial',
    process: '1283/26',
    location: 'Cacilhas',
    initials: 'IC',
    planType: 'monthly',
    planTotal: null,
    planInstallments: null,
    monthlyValue: 350,
    startDate: '2025-12-05',
    reminderDays: 5,
    reminderChannels: ['email'],
    notes: '',
  },
];

// ============================================================
// PARCELAS — geradas para fluir com a data de hoje (27 Mai 2026)
// ============================================================
// Status possíveis: 'paid' | 'due_today' | 'pending' | 'late'
export const INSTALLMENTS = [
  // ---- MARIA SOARES (avença mensal €450) ----
  { id: 'i-001', clientId: 'maria-soares', label: 'Set/24', dueDate: '2024-09-01', amount: 450, status: 'paid', paidDate: '2024-09-01' },
  { id: 'i-002', clientId: 'maria-soares', label: 'Out/24', dueDate: '2024-10-01', amount: 450, status: 'paid', paidDate: '2024-10-01' },
  { id: 'i-003', clientId: 'maria-soares', label: 'Nov/24', dueDate: '2024-11-01', amount: 450, status: 'paid', paidDate: '2024-11-02' },
  { id: 'i-004', clientId: 'maria-soares', label: 'Dez/24', dueDate: '2024-12-01', amount: 450, status: 'paid', paidDate: '2024-12-01' },
  { id: 'i-005', clientId: 'maria-soares', label: 'Jan/25', dueDate: '2025-01-01', amount: 450, status: 'paid', paidDate: '2025-01-03' },
  { id: 'i-006', clientId: 'maria-soares', label: 'Fev/25', dueDate: '2025-02-01', amount: 450, status: 'paid', paidDate: '2025-02-01' },
  { id: 'i-mr1', clientId: 'maria-soares', label: 'Abr/26', dueDate: '2026-04-01', amount: 450, status: 'paid', paidDate: '2026-04-01' },
  { id: 'i-mr2', clientId: 'maria-soares', label: 'Mai/26', dueDate: '2026-05-01', amount: 450, status: 'paid', paidDate: '2026-05-01' },
  { id: 'i-mr3', clientId: 'maria-soares', label: 'Jun/26', dueDate: '2026-05-27', amount: 450, status: 'due_today', paidDate: null },
  { id: 'i-mr4', clientId: 'maria-soares', label: 'Jul/26', dueDate: '2026-06-27', amount: 450, status: 'pending', paidDate: null },

  // ---- JOÃO LOPES (parcelado 12x €320) ----
  { id: 'i-jl1', clientId: 'joao-lopes', label: '1/12', dueDate: '2026-02-28', amount: 320, status: 'paid', paidDate: '2026-02-27' },
  { id: 'i-jl2', clientId: 'joao-lopes', label: '2/12', dueDate: '2026-03-28', amount: 320, status: 'paid', paidDate: '2026-03-28' },
  { id: 'i-jl3', clientId: 'joao-lopes', label: '3/12', dueDate: '2026-04-28', amount: 320, status: 'paid', paidDate: '2026-04-29' },
  { id: 'i-jl4', clientId: 'joao-lopes', label: '4/12', dueDate: '2026-05-28', amount: 320, status: 'pending', paidDate: null },
  { id: 'i-jl5', clientId: 'joao-lopes', label: '5/12', dueDate: '2026-06-28', amount: 320, status: 'pending', paidDate: null },
  { id: 'i-jl6', clientId: 'joao-lopes', label: '6/12', dueDate: '2026-07-28', amount: 320, status: 'pending', paidDate: null },
  { id: 'i-jl7', clientId: 'joao-lopes', label: '7/12', dueDate: '2026-08-28', amount: 320, status: 'pending', paidDate: null },
  { id: 'i-jl8', clientId: 'joao-lopes', label: '8/12', dueDate: '2026-09-28', amount: 320, status: 'pending', paidDate: null },
  { id: 'i-jl9', clientId: 'joao-lopes', label: '9/12', dueDate: '2026-10-28', amount: 320, status: 'pending', paidDate: null },
  { id: 'i-jl10', clientId: 'joao-lopes', label: '10/12', dueDate: '2026-11-28', amount: 320, status: 'pending', paidDate: null },
  { id: 'i-jl11', clientId: 'joao-lopes', label: '11/12', dueDate: '2026-12-28', amount: 320, status: 'pending', paidDate: null },
  { id: 'i-jl12', clientId: 'joao-lopes', label: '12/12', dueDate: '2027-01-28', amount: 320, status: 'pending', paidDate: null },

  // ---- PEDRO ALMEIDA (parcelado 10x €380, em atraso) ----
  { id: 'i-pa1', clientId: 'pedro-almeida', label: '1/10', dueDate: '2025-11-19', amount: 380, status: 'paid', paidDate: '2025-11-19' },
  { id: 'i-pa2', clientId: 'pedro-almeida', label: '2/10', dueDate: '2025-12-19', amount: 380, status: 'paid', paidDate: '2025-12-22' },
  { id: 'i-pa3', clientId: 'pedro-almeida', label: '3/10', dueDate: '2026-01-19', amount: 380, status: 'paid', paidDate: '2026-01-20' },
  { id: 'i-pa4', clientId: 'pedro-almeida', label: '4/10', dueDate: '2026-02-19', amount: 380, status: 'paid', paidDate: '2026-02-25' },
  { id: 'i-pa5', clientId: 'pedro-almeida', label: '5/10', dueDate: '2026-03-19', amount: 380, status: 'paid', paidDate: '2026-03-23' },
  { id: 'i-pa6', clientId: 'pedro-almeida', label: '6/10', dueDate: '2026-04-19', amount: 380, status: 'paid', paidDate: '2026-04-21' },
  { id: 'i-pa7', clientId: 'pedro-almeida', label: '7/10', dueDate: '2026-05-19', amount: 380, status: 'late', paidDate: null },
  { id: 'i-pa8', clientId: 'pedro-almeida', label: '8/10', dueDate: '2026-06-19', amount: 380, status: 'pending', paidDate: null },
  { id: 'i-pa9', clientId: 'pedro-almeida', label: '9/10', dueDate: '2026-07-19', amount: 380, status: 'pending', paidDate: null },
  { id: 'i-pa10', clientId: 'pedro-almeida', label: '10/10', dueDate: '2026-08-19', amount: 380, status: 'pending', paidDate: null },

  // ---- EMPRESA AVENA LTDA (avença mensal R$ 4.500) ----
  { id: 'i-ea1', clientId: 'empresa-avena', label: 'Mar/26', dueDate: '2026-03-30', amount: 4500, status: 'paid', paidDate: '2026-03-30' },
  { id: 'i-ea2', clientId: 'empresa-avena', label: 'Abr/26', dueDate: '2026-04-30', amount: 4500, status: 'paid', paidDate: '2026-04-30' },
  { id: 'i-ea3', clientId: 'empresa-avena', label: 'Mai/26', dueDate: '2026-05-30', amount: 4500, status: 'pending', paidDate: null },
  { id: 'i-ea4', clientId: 'empresa-avena', label: 'Jun/26', dueDate: '2026-06-30', amount: 4500, status: 'pending', paidDate: null },

  // ---- CARLA MENDES (parcelado 6x €520) ----
  { id: 'i-cm1', clientId: 'carla-mendes', label: '1/6', dueDate: '2026-05-01', amount: 520, status: 'paid', paidDate: '2026-05-01' },
  { id: 'i-cm2', clientId: 'carla-mendes', label: '2/6', dueDate: '2026-06-01', amount: 520, status: 'pending', paidDate: null },
  { id: 'i-cm3', clientId: 'carla-mendes', label: '3/6', dueDate: '2026-07-01', amount: 520, status: 'pending', paidDate: null },
  { id: 'i-cm4', clientId: 'carla-mendes', label: '4/6', dueDate: '2026-08-01', amount: 520, status: 'pending', paidDate: null },
  { id: 'i-cm5', clientId: 'carla-mendes', label: '5/6', dueDate: '2026-09-01', amount: 520, status: 'pending', paidDate: null },
  { id: 'i-cm6', clientId: 'carla-mendes', label: '6/6', dueDate: '2026-10-01', amount: 520, status: 'pending', paidDate: null },

  // ---- SOFIA RIBEIRO (avença €300, em atraso) ----
  { id: 'i-sr1', clientId: 'sofia-ribeiro', label: 'Mar/26', dueDate: '2026-03-24', amount: 300, status: 'paid', paidDate: '2026-03-24' },
  { id: 'i-sr2', clientId: 'sofia-ribeiro', label: 'Abr/26', dueDate: '2026-04-24', amount: 300, status: 'paid', paidDate: '2026-04-26' },
  { id: 'i-sr3', clientId: 'sofia-ribeiro', label: 'Mai/26', dueDate: '2026-05-24', amount: 300, status: 'late', paidDate: null },
  { id: 'i-sr4', clientId: 'sofia-ribeiro', label: 'Jun/26', dueDate: '2026-06-24', amount: 300, status: 'pending', paidDate: null },

  // ---- HUGO TAVARES (parcelado 12x quitado) ----
  { id: 'i-ht1', clientId: 'hugo-tavares', label: '12/12', dueDate: '2026-04-15', amount: 400, status: 'paid', paidDate: '2026-04-15' },
  { id: 'i-ht2', clientId: 'hugo-tavares', label: '11/12', dueDate: '2026-03-15', amount: 400, status: 'paid', paidDate: '2026-03-15' },

  // ---- LUCAS FERREIRA (parcelado 8x €420) ----
  { id: 'i-lf1', clientId: 'lucas-ferreira', label: '1/8', dueDate: '2026-03-05', amount: 420, status: 'paid', paidDate: '2026-03-05' },
  { id: 'i-lf2', clientId: 'lucas-ferreira', label: '2/8', dueDate: '2026-04-05', amount: 420, status: 'paid', paidDate: '2026-04-06' },
  { id: 'i-lf3', clientId: 'lucas-ferreira', label: '3/8', dueDate: '2026-05-05', amount: 420, status: 'paid', paidDate: '2026-05-05' },
  { id: 'i-lf4', clientId: 'lucas-ferreira', label: '4/8', dueDate: '2026-06-05', amount: 420, status: 'pending', paidDate: null },
  { id: 'i-lf5', clientId: 'lucas-ferreira', label: '5/8', dueDate: '2026-07-05', amount: 420, status: 'pending', paidDate: null },
  { id: 'i-lf6', clientId: 'lucas-ferreira', label: '6/8', dueDate: '2026-08-05', amount: 420, status: 'pending', paidDate: null },
  { id: 'i-lf7', clientId: 'lucas-ferreira', label: '7/8', dueDate: '2026-09-05', amount: 420, status: 'pending', paidDate: null },
  { id: 'i-lf8', clientId: 'lucas-ferreira', label: '8/8', dueDate: '2026-10-05', amount: 420, status: 'pending', paidDate: null },

  // ---- INÊS CARDOSO (avença €350) ----
  { id: 'i-ic1', clientId: 'ines-cardoso', label: 'Abr/26', dueDate: '2026-04-05', amount: 350, status: 'paid', paidDate: '2026-04-05' },
  { id: 'i-ic2', clientId: 'ines-cardoso', label: 'Mai/26', dueDate: '2026-05-05', amount: 350, status: 'paid', paidDate: '2026-05-05' },
  { id: 'i-ic3', clientId: 'ines-cardoso', label: 'Jun/26', dueDate: '2026-06-05', amount: 350, status: 'pending', paidDate: null },
];

// ============================================================
// REGRAS DE NOTIFICAÇÃO
// ============================================================
export const NOTIFICATION_RULES = [
  {
    id: 'rule-1',
    title: 'Lembrete amigável — 5 dias antes do vencimento',
    description: 'Enviado por e-mail e WhatsApp · 09h00 local do cliente',
    badge: '5d',
    enabled: true,
  },
  {
    id: 'rule-2',
    title: 'Lembrete na véspera',
    description: 'Apenas WhatsApp · 18h00 local do cliente',
    badge: '1d',
    enabled: true,
  },
  {
    id: 'rule-3',
    title: 'Aviso interno de parcela vencida',
    description: 'No dia seguinte ao vencimento · só para a Dra. Vyvian',
    badge: '+1',
    enabled: true,
  },
  {
    id: 'rule-4',
    title: 'Lembrete cordial de atraso ao cliente — D+3',
    description: 'Por e-mail · após sua aprovação manual',
    badge: '+3',
    enabled: false,
  },
  {
    id: 'rule-5',
    title: 'Resumo mensal para a Dra. Vyvian',
    description: 'Todo dia 1 · receita prevista, pendências, alertas',
    badge: 'M',
    enabled: true,
  },
];

export const MESSAGE_TEMPLATES = {
  reminderBefore: {
    name: 'Lembrete 5 dias antes (pt-PT)',
    subject: 'Lembrete de pagamento — {{processo.referencia}}',
    body: `Cara/o {{cliente.nome}},

Por este meio relembro que se encontra agendado, para {{parcela.data}}, o pagamento referente à parcela {{parcela.numero}} no valor de {{parcela.valor}}, relativa ao processo {{processo.referencia}}.

Caso o pagamento já tenha sido efetuado, por favor desconsidere esta mensagem.

Com os melhores cumprimentos,
Dra. Vyvian Avena`,
  },
};

// ============================================================
// HELPERS
// ============================================================
export function getClientById(id) {
  return CLIENTS.find((c) => c.id === id);
}

export function getInstallmentsByClientId(clientId) {
  return INSTALLMENTS
    .filter((i) => i.clientId === clientId)
    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
}

export function getNextInstallmentByClientId(clientId) {
  const upcoming = INSTALLMENTS
    .filter((i) => i.clientId === clientId && i.status !== 'paid')
    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
  return upcoming[0] || null;
}

export function getInstallmentsByMonth(year, month) {
  // month: 0-11
  return INSTALLMENTS.filter((i) => {
    const d = new Date(i.dueDate);
    return d.getFullYear() === year && d.getMonth() === month;
  });
}
