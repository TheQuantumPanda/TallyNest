import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AuthContext } from './AuthContext';
import { authService } from '../services/auth';
import { api } from '../services/api';

export function AuthProvider({ children }) {
  const [session, setSession] = useState({ status: 'loading', user: null, reason: null });
  const generation = useRef(0);

  const invalidatePending = useCallback(() => {
    ++generation.current;
  }, []);
  const loadSession = useCallback(({ silent = false } = {}) => {
    const current = ++generation.current;
    return authService.me().then(
      (user) => {
        if (current === generation.current)
          setSession({ status: 'authenticated', user, reason: null });
      },
      (error) => {
        if (current !== generation.current) return;
        setSession({
          status: error.response?.status === 401 ? 'anonymous' : 'error',
          user: null,
          reason: silent && error.response?.status === 401 ? 'expired' : null,
        });
      },
    );
  }, []);

  const restore = useCallback(() => {
    setSession({ status: 'loading', user: null, reason: null });
    return loadSession();
  }, [loadSession]);

  useEffect(() => {
    const unsubscribe = api.onUnauthorized(() => {
      invalidatePending();
      setSession({ status: 'anonymous', user: null, reason: 'expired' });
    });
    void loadSession();
    return () => {
      invalidatePending();
      unsubscribe();
    };
  }, [loadSession, invalidatePending]);

  useEffect(() => {
    if (session.status !== 'authenticated') return;
    const onFocus = () => {
      void loadSession({ silent: true });
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [loadSession, session.status]);

  const authenticate = useCallback(async (operation, values) => {
    const current = ++generation.current;
    const user = await authService[operation](values);
    if (current !== generation.current) throw new Error('Session changed during authentication');
    setSession({ status: 'authenticated', user, reason: null });
  }, []);
  const login = useCallback((values) => authenticate('login', values), [authenticate]);
  const register = useCallback((values) => authenticate('register', values), [authenticate]);
  const logout = useCallback(async () => {
    ++generation.current;
    await authService.logout();
    ++generation.current;
    setSession({ status: 'anonymous', user: null, reason: null });
  }, []);
  const value = useMemo(
    () => ({ ...session, login, register, logout, restore }),
    [session, login, register, logout, restore],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
