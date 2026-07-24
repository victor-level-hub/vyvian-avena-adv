// src/admin/AdminApp.jsx
import React from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { isAuthenticated } from './auth';
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
            <AuthenticatedLayout><Dashboard /></AuthenticatedLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="estatisticas"
        element={
          <ProtectedRoute>
            <AuthenticatedLayout><Statistics /></AuthenticatedLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="clientes"
        element={
          <ProtectedRoute>
            <AuthenticatedLayout><Clients /></AuthenticatedLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="clientes/novo"
        element={
          <ProtectedRoute>
            <AuthenticatedLayout><NewClient /></AuthenticatedLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="clientes/:clientId"
        element={
          <ProtectedRoute>
            <AuthenticatedLayout><ClientDetail /></AuthenticatedLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="calendario"
        element={
          <ProtectedRoute>
            <AuthenticatedLayout><Calendar /></AuthenticatedLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="parcelas"
        element={
          <ProtectedRoute>
            <AuthenticatedLayout><Installments /></AuthenticatedLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="notificacoes"
        element={
          <ProtectedRoute>
            <AuthenticatedLayout><Notifications /></AuthenticatedLayout>
          </ProtectedRoute>
        }
      />

      {/* /admin → /admin/painel */}
      <Route path="" element={<Navigate to="/admin/painel" replace />} />
      <Route path="*" element={<Navigate to="/admin/painel" replace />} />
    </Routes>
    </>
  );
}
