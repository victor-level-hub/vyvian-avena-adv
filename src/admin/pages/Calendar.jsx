// src/admin/pages/Calendar.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { installments as installmentsApi } from '../apiClient';

const MONTHS_PT = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];
const DAYS_PT = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

function fmtMoney(amount, currency = 'EUR', compact = false) {
  const symbol = currency === 'BRL' ? 'R$' : '€';
  const n = Number(amount || 0);
  if (compact && n >= 1000) {
    return symbol + '\u00A0' + (n / 1000).toFixed(1).replace('.0', '') + 'k';
  }
  return symbol + '\u00A0' + n.toLocaleString('pt-PT', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('pt-PT', { day: '2-digit', month: 'long', year: 'numeric' });
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function dateKey(d) {
  return d.toISOString().slice(0, 10);
}

export default function Calendar() {
  const TODAY_REAL = new Date();
  TODAY_REAL.setHours(0, 0, 0, 0);

  const [currentDate, setCurrentDate] = useState(new Date(TODAY_REAL));
  const [selectedDate, setSelectedDate] = useState(null);
  const [allInstallments, setAllInstallments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    installmentsApi.list()
      .then((res) => setAllInstallments(res.installments || []))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const grid = useMemo(() => {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const firstWeekday = (firstDay.getDay() + 6) % 7;

    const cells = [];
    for (let i = firstWeekday - 1; i >= 0; i--) {
      const d = new Date(year, month, -i);
      cells.push({ date: d, current: false });
    }
    for (let i = 1; i <= lastDay.getDate(); i++) {
      cells.push({ date: new Date(year, month, i), current: true });
    }
    while (cells.length % 7 !== 0) {
      const last = cells[cells.length - 1].date;
      const next = new Date(last);
      next.setDate(next.getDate() + 1);
      cells.push({ date: next, current: false });
    }
    return cells;
  }, [year, month]);

  const installmentsByDate = useMemo(() => {
    const map = {};
    allInstallments.forEach((i) => {
      if (!map[i.due_date]) map[i.due_date] = [];
      map[i.due_date].push(i);
    });
    return map;
  }, [allInstallments]);

  const monthInstallments = allInstallments.filter((i) => {
    const d = new Date(i.due_date);
    return d.getFullYear() === year && d.getMonth() === month;
  });
  const totalEur = monthInstallments
    .filter((i) => i.currency === 'EUR')
    .reduce((s, i) => s + Number(i.amount), 0);

  const prevMonth = () => { setCurrentDate(new Date(year, month - 1, 1)); setSelectedDate(null); };
  const nextMonth = () => { setCurrentDate(new Date(year, month + 1, 1)); setSelectedDate(null); };
  const goToday = () => { setCurrentDate(new Date(TODAY_REAL)); setSelectedDate(null); };

  const selectedInstallments = selectedDate
    ? (installmentsByDate[dateKey(selectedDate)] || [])
    : [];

  if (loading) return <div className="adm-empty" style={{ padding: '3rem' }}>A carregar calendário…</div>;
  if (error) return <div className="adm-login-error">{error}</div>;

  return (
    <>
      <header className="adm-page-header">
        <div>
          <h1>Calendário</h1>
          <div className="adm-sub">Vencimentos do mês · pontos coloridos indicam estado</div>
        </div>
      </header>

      <div className="adm-cal-head">
        <div>
          <h2>{MONTHS_PT[month]} · {year}</h2>
          <div className="adm-sub">
            {monthInstallments.length} vencimentos · {fmtMoney(totalEur)} previstos (EUR)
          </div>
        </div>
        <div className="adm-cal-nav">
          <button onClick={prevMonth}>‹</button>
          <button onClick={goToday}>Hoje</button>
          <button onClick={nextMonth}>›</button>
        </div>
      </div>

      <div className="adm-cal-grid">
        {DAYS_PT.map((d) => (
          <div key={d} className="adm-cal-dh">{d}</div>
        ))}
        {grid.map((cell, idx) => {
          const inst = installmentsByDate[dateKey(cell.date)] || [];
          const isToday = isSameDay(cell.date, TODAY_REAL);
          const isSelected = selectedDate && isSameDay(cell.date, selectedDate);
          const dayTotalByCurrency = inst.reduce((acc, i) => {
            acc[i.currency] = (acc[i.currency] || 0) + Number(i.amount);
            return acc;
          }, {});
          const dayCurrency = inst[0]?.currency || 'EUR';
          const dayTotal = dayTotalByCurrency[dayCurrency] || 0;
          const hasLate = inst.some((i) => i.status === 'late');

          return (
            <div
              key={idx}
              className={
                'adm-cal-day' +
                (cell.current ? '' : ' adm-cal-day-muted') +
                (isToday ? ' adm-cal-day-today' : '') +
                (isSelected ? ' adm-row-highlight' : '')
              }
              onClick={() => cell.current && setSelectedDate(cell.date)}
              style={isSelected ? { background: 'var(--cream-soft)' } : {}}
            >
              <div className="adm-cal-day-num">{cell.date.getDate()}</div>
              {inst.length > 0 && (
                <>
                  <div className="adm-cal-dots">
                    {inst.map((i) => (
                      <span
                        key={i.id}
                        className={
                          'adm-cal-dot ' +
                          (i.status === 'paid' ? 'adm-cal-dot-paid' :
                           i.status === 'late' ? 'adm-cal-dot-late' :
                           'adm-cal-dot-pend')
                        }
                      />
                    ))}
                  </div>
                  <div className={'adm-cal-amount' + (hasLate ? ' adm-cal-amount-late' : '')}>
                    {fmtMoney(dayTotal, dayCurrency, true)}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="adm-cal-legend">
        <span><span className="adm-cal-legend-dot" style={{ background: 'var(--success)' }} />Pago</span>
        <span><span className="adm-cal-legend-dot" style={{ background: 'var(--gold)' }} />A vencer</span>
        <span><span className="adm-cal-legend-dot" style={{ background: 'var(--danger)' }} />Atrasado</span>
      </div>

      {selectedDate && (
        <div className="adm-day-detail">
          <h3>Vencimentos em {fmtDate(dateKey(selectedDate))}</h3>
          {selectedInstallments.length === 0 ? (
            <div className="adm-empty" style={{ padding: '1rem 0' }}>
              Sem vencimentos neste dia.
            </div>
          ) : (
            <table className="adm-table adm-table-small">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Parcela</th>
                  <th className="adm-text-right">Valor</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {selectedInstallments.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <Link to={`/admin/clientes/${i.client_id}`} style={{ color: 'inherit' }}>
                        <strong>{i.client_name}</strong>
                      </Link>
                    </td>
                    <td>{i.installment_number}/{i.total_installments}</td>
                    <td className="adm-text-right adm-val">{fmtMoney(i.amount, i.currency)}</td>
                    <td>
                      {i.status === 'paid' && <span className="adm-badge adm-badge-paid">Pago</span>}
                      {i.status === 'pending' && <span className="adm-badge adm-badge-pending">Pendente</span>}
                      {i.status === 'due_today' && <span className="adm-badge adm-badge-warn">Hoje</span>}
                      {i.status === 'late' && <span className="adm-badge adm-badge-late">Vencido</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </>
  );
}
