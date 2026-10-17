// Separate fixture entry. The normal frontend entry and production build never import this module.
import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { MotionConfig } from 'motion/react';
import { AuthProvider } from '../context/AuthProvider';
import { AppLayout } from '../layouts/AppLayout';
import { AuthLayout } from '../layouts/AuthLayout';
import { LoginPage } from '../pages/LoginPage';
import { RegisterPage } from '../pages/RegisterPage';
import { GroupsPage } from '../pages/GroupsPage';
import { CycleWorkspace } from '../pages/CycleWorkspace';
import { InvitationLanding } from '../pages/InvitationLanding';
import { NotFoundPage } from '../pages/NotFoundPage';
import '../styles/index.css';
import '../styles/cycles.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <AuthProvider>
        <BrowserRouter>
          <Suspense fallback={<p role="status">Opening cycles…</p>}>
            <Routes>
              <Route path="/" element={<Navigate to="/app/groups" replace />} />
              <Route element={<AuthLayout />}>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/register" element={<RegisterPage />} />
              </Route>
              <Route path="/app" element={<AppLayout />}>
                <Route index element={<Navigate to="groups" replace />} />
                <Route path="groups" element={<GroupsPage />} />
                <Route path="groups/:groupId" element={<CycleWorkspace />} />
                <Route path="groups/:groupId/cycles/:cycleId" element={<CycleWorkspace />} />
                <Route path="join" element={<InvitationLanding />} />
                <Route path="join/:token" element={<InvitationLanding />} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </AuthProvider>
    </MotionConfig>
  </StrictMode>,
);
