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

const BudgetsPage = lazy(() =>
  import('./pages/BudgetsPage').then((module) => ({ default: module.BudgetsPage })),
);

const RecurringPage = lazy(() =>
  import('./pages/RecurringPage').then((module) => ({ default: module.RecurringPage })),
);

const GroupsPage = lazy(() =>
  import('./pages/GroupsPage').then((module) => ({ default: module.GroupsPage })),
);
const CycleWorkspace = lazy(() =>
  import('./pages/CycleWorkspace').then((module) => ({ default: module.CycleWorkspace })),
);
const InvitationLanding = lazy(() =>
  import('./pages/InvitationLanding').then((module) => ({ default: module.InvitationLanding })),
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
        <Route
          path="budgets"
          element={
            <Suspense fallback={<p role="status">Opening your budgets…</p>}>
              <BudgetsPage />
            </Suspense>
          }
        />
        <Route
          path="recurring"
          element={
            <Suspense fallback={<p role="status">Opening your schedules…</p>}>
              <RecurringPage />
            </Suspense>
          }
        />
        <Route
          path="groups"
          element={
            <Suspense fallback={<p role="status">Opening groups…</p>}>
              <GroupsPage />
            </Suspense>
          }
        />
        <Route
          path="groups/:groupId"
          element={
            <Suspense fallback={<p role="status">Opening group…</p>}>
              <CycleWorkspace />
            </Suspense>
          }
        />
        <Route
          path="groups/:groupId/cycles/:cycleId"
          element={
            <Suspense fallback={<p role="status">Opening group cycle…</p>}>
              <CycleWorkspace />
            </Suspense>
          }
        />
        <Route
          path="join/:token?"
          element={
            <Suspense fallback={<p role="status">Reviewing invitation…</p>}>
              <InvitationLanding />
            </Suspense>
          }
        />
        <Route path="account" element={<AccountPage />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
