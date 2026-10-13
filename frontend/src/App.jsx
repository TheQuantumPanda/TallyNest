import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthLayout } from './layouts/AuthLayout';
import { AppLayout } from './layouts/AppLayout';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { AccountPage } from './pages/AccountPage';
import { NotFoundPage } from './pages/NotFoundPage';

const DashboardPage = lazy(() =>
  import('./pages/DashboardPage').then((module) => ({ default: module.DashboardPage })),
);

const TransactionsPage = lazy(() =>
  import('./pages/TransactionsPage').then((module) => ({ default: module.TransactionsPage })),
);

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/app" replace />} />
      <Route element={<AuthLayout />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>
      <Route path="/app" element={<AppLayout />}>
        <Route
          index
          element={
            <Suspense fallback={<p role="status">Opening your overview…</p>}>
              <DashboardPage />
            </Suspense>
          }
        />
        <Route
          path="transactions"
          element={
            <Suspense fallback={<p role="status">Opening your ledger…</p>}>
              <TransactionsPage />
            </Suspense>
          }
        />
        <Route path="account" element={<AccountPage />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
