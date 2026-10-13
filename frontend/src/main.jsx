import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { MotionConfig } from 'motion/react';
import { AuthProvider } from './context/AuthProvider';
import App from './App';
import './styles/index.css';

const router = createBrowserRouter([{ path: '*', element: <App /> }]);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </MotionConfig>
  </StrictMode>,
);
