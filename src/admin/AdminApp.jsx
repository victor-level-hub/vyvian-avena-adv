// src/admin/AdminApp.jsx
import React from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { isAuthenticated } from './auth';
import { podeAceder, primeiraRotaPermitida } from './perms';
import Sidebar from './Sidebar';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Clients from './pages/Clients';
import ClientDetail from './pages/ClientDetail';
import NewClient from './pages/NewClient';
import Calendar from './pages/Calendar';
import Installments from './pages/Installments';
import Notifications from './pages/Notifications';
import Statistics from './pages/Statistics';
import Apoio from './pages/Apoio';
import Configuracoes from './pages/Configuracoes';
import Convite from './pages/Convite';
import { DialogHost } from './dialogs';
import { ToastHost } from './toasts';
import CommandPalette from './cmdk';
import './admin.css';

// ===== Auth gate =====
function ProtectedRoute({ children }) {
  const location = useLocation();
  if (!isAuthenticated()) {
    return <Navigate to="/admin/login" state={{ from: location }} replace />;
  }
  return children;
}

// ===== Gate de permissões por aba (ver perms.js) =====
function PermGate({ perm, children }) {
  if (!podeAceder(perm)) return <Navigate to={primeiraRotaPermitida()} replace />;
  return children;
}

// ===== Layout para páginas autenticadas =====
function AuthenticatedLayout({ children }) {
  const location = useLocation();
  return (
    <div className="adm-root">
      <div className="adm-layout">
        <Sidebar />
        {/* key na rota: reanima a entrada (fade + subida) a cada mudança de página */}
        <main key={location.pathname} className="adm-main adm-page-anim">{children}</main>
      </div>
    </div>
  );
}

// ===== Routing principal =====
export default function AdminApp() {
  return (
    <>
    <DialogHost />
    <ToastHost />
    <CommandPalette />
    <Routes>
      {/* Login — sem layout */}
      <Route path="login" element={<Login />} />

      {/* Tudo o resto exige sessão */}
      <Route
        path="painel"
        element={
          <ProtectedRoute>
            <PermGate perm="painel"><AuthenticatedLayout><Dashboard /></AuthenticatedLayout></PermGate>
          </ProtectedRoute>
        }
      />
      <Route
        path="estatisticas"
        element={
          <ProtectedRoute>
            <PermGate perm="estatisticas"><AuthenticatedLayout><Statistics /></AuthenticatedLayout></PermGate>
          </ProtectedRoute>
        }
      />
      <Route
        path="clientes"
        element={
          <ProtectedRoute>
            <PermGate perm="clientes"><AuthenticatedLayout><Clients /></AuthenticatedLayout></PermGate>
          </ProtectedRoute>
        }
      />
      <Route
        path="clientes/novo"
        element={
          <ProtectedRoute>
            <PermGate perm="clientes"><AuthenticatedLayout><NewClient /></AuthenticatedLayout></PermGate>
          </ProtectedRoute>
        }
      />
      <Route
        path="clientes/:clientId"
        element={
          <ProtectedRoute>
            <PermGate perm="clientes"><AuthenticatedLayout><ClientDetail /></AuthenticatedLayout></PermGate>
          </ProtectedRoute>
        }
      />
      <Route
        path="calendario"
        element={
          <ProtectedRoute>
            <PermGate perm="calendario"><AuthenticatedLayout><Calendar /></AuthenticatedLayout></PermGate>
          </ProtectedRoute>
        }
      />
      <Route
        path="parcelas"
        element={
          <ProtectedRoute>
            <PermGate perm="parcelas"><AuthenticatedLayout><Installments /></AuthenticatedLayout></PermGate>
          </ProtectedRoute>
        }
      />
      <Route
        path="apoio"
        element={
          <ProtectedRoute>
            <PermGate perm="apoio"><AuthenticatedLayout><Apoio /></AuthenticatedLayout></PermGate>
          </ProtectedRoute>
        }
      />
      <Route
        path="notificacoes"
        element={
          <ProtectedRoute>
            <PermGate perm="notificacoes"><AuthenticatedLayout><Notifications /></AuthenticatedLayout></PermGate>
          </ProtectedRoute>
        }
      />

      <Route
        path="configuracoes"
        element={
          <ProtectedRoute>
            <PermGate perm="configuracoes"><AuthenticatedLayout><Configuracoes /></AuthenticatedLayout></PermGate>
          </ProtectedRoute>
        }
      />
      {/* Registo por convite — público, sem sessão */}
      <Route path="convite/:token" element={<Convite />} />

      {/* /admin → /admin/painel */}
      <Route path="" element={<Navigate to="/admin/painel" replace />} />
      <Route path="*" element={<Navigate to="/admin/painel" replace />} />
    </Routes>
    </>
  );
}
