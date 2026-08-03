// tests/helpers/dom.jsx — utilitários dos testes de interface.
//
// Os ficheiros de componente têm de declarar o ambiente no topo:
//     // @vitest-environment jsdom
// (o resto da suíte corre em Node, que é mais rápido e não precisa de DOM).
//
// Aqui ficam: os matchers do jest-dom, a limpeza entre testes, e um `renderizar`
// que embrulha o componente no Router — quase toda a Área Privada usa
// useNavigate/Link e rebenta sem ele.
import React from 'react';
import { afterEach, expect, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as matchers from '@testing-library/jest-dom/matchers';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

expect.extend(matchers);
afterEach(() => { cleanup(); });

// Renderiza dentro de um MemoryRouter. `rota` e `caminho` servem para ecrãs que
// leem parâmetros do URL (ex.: /admin/clientes/:id).
export function renderizar(ui, { caminho = '/', rota = null } = {}) {
  const utilizador = userEvent.setup();
  const vista = render(
    <MemoryRouter
      initialEntries={[caminho]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      {rota ? <Routes><Route path={rota} element={ui} /></Routes> : ui}
    </MemoryRouter>
  );
  return { ...vista, utilizador };
}

// Espia o useNavigate para poder afirmar "navegou para X" sem montar a app toda.
// Usar com: vi.mock('react-router-dom', async () => ({ ...await vi.importActual('react-router-dom'), useNavigate: () => navegacoes.push }))
export function criarEspiaNavegacao() {
  const ir = vi.fn();
  return { ir, ultimoDestino: () => ir.mock.calls.at(-1)?.[0] ?? null };
}

// Componente controlado: React não deixa escrever num input com `value` sem
// onChange. Este embrulho guarda o estado para o teste poder escrever à vontade.
export function Controlado({ children, inicial = '' }) {
  const [valor, setValor] = React.useState(inicial);
  return children(valor, (e) => setValor(e?.target ? e.target.value : e));
}

export { userEvent };
export * from '@testing-library/react';
