import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { MotionConfig } from 'motion/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { AuthProvider } from '../context/AuthProvider';
import { authService } from '../services/auth';
import { api } from '../services/api';

vi.mock('../services/auth', () => ({
  authService: { me: vi.fn(), login: vi.fn(), register: vi.fn(), logout: vi.fn() },
}));
vi.mock('../services/api', () => ({ api: { onUnauthorized: vi.fn() } }));
const user = {
  id: 'test-user',
  name: 'Alex Rivera',
  email: 'alex@example.com',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
let unauthorized;
beforeEach(() => {
  vi.resetAllMocks();
  api.onUnauthorized.mockImplementation((listener) => {
    unauthorized = listener;
    return vi.fn();
  });
  authService.me.mockRejectedValue({ response: { status: 401 } });
  authService.login.mockResolvedValue(user);
  authService.register.mockResolvedValue(user);
  authService.logout.mockResolvedValue(undefined);
});
function renderApp(path = '/login') {
  return render(
    <MotionConfig reducedMotion="always">
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>
    </MotionConfig>,
  );
}
async function fillLogin() {
  const input = userEvent.setup();
  await input.type(await screen.findByLabelText('Email address'), user.email);
  await input.type(screen.getByLabelText('Password'), 'correct horse battery');
  return input;
}
const welcome = () => screen.findByRole('heading', { name: /Make yourself at home, Alex/ });

describe('authentication screens and protected routes', () => {
  it('validates forms accessibly and focuses the first invalid field', async () => {
    renderApp();
    await screen.findByRole('heading', { name: 'Welcome back.' });
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByText('Enter a valid email address.')).toBeVisible();
    expect(screen.getByLabelText('Email address')).toHaveFocus();
    expect(screen.getByLabelText('Email address')).toHaveAttribute('aria-invalid', 'true');
    expect(authService.login).not.toHaveBeenCalled();
  });
  it('signs in and navigates to the authenticated workspace', async () => {
    renderApp();
    const input = await fillLogin();
    await input.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await welcome()).toBeVisible();
    expect(authService.login).toHaveBeenCalledWith({
      email: user.email,
      password: 'correct horse battery',
    });
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
  it('registers a normalized user and enters the workspace', async () => {
    renderApp('/register');
    const input = userEvent.setup();
    await input.type(await screen.findByLabelText('Full name'), ' Alex Rivera ');
    await input.type(screen.getByLabelText('Email address'), ' ALEX@example.com ');
    await input.type(screen.getByLabelText('Password'), 'correct horse battery');
    await input.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await welcome()).toBeVisible();
    expect(authService.register).toHaveBeenCalledWith({
      name: user.name,
      email: user.email,
      password: 'correct horse battery',
    });
  });
  it('shows a safe generic login error and allows retry', async () => {
    authService.login.mockRejectedValue({
      response: { status: 401, data: { message: 'sensitive internals' } },
    });
    renderApp();
    const input = await fillLogin();
    await input.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect.');
    expect(screen.queryByText('sensitive internals')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });
  it('shows duplicate registration errors clearly', async () => {
    authService.register.mockRejectedValue({ response: { status: 409 } });
    renderApp('/register');
    const input = userEvent.setup();
    await input.type(await screen.findByLabelText('Full name'), user.name);
    await input.type(screen.getByLabelText('Email address'), user.email);
    await input.type(screen.getByLabelText('Password'), 'correct horse battery');
    await input.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'An account with this email already exists.',
    );
  });
  it('disables fields and duplicate submits while authentication is pending', async () => {
    let resolve;
    authService.login.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    renderApp();
    const input = await fillLogin();
    await input.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByRole('button', { name: 'Signing you in…' })).toBeDisabled();
    expect(screen.getByLabelText('Password')).toBeDisabled();
    await act(async () => resolve(user));
    expect(await welcome()).toBeVisible();
    expect(authService.login).toHaveBeenCalledTimes(1);
  });
  it('redirects anonymous users and returns them to the protected account route after login', async () => {
    renderApp('/app/account');
    const input = await fillLogin();
    expect(screen.queryByRole('heading', { name: 'Your account.' })).not.toBeInTheDocument();
    await input.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Your account.' })).toBeVisible();
  });
  it('does not flash protected content before initial session restoration resolves', async () => {
    let resolve;
    authService.me.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    renderApp('/app');
    expect(screen.getByRole('heading', { name: 'Opening your workspace…' })).toBeVisible();
    expect(screen.queryByText(/Make yourself at home/)).not.toBeInTheDocument();
    await act(async () => resolve(user));
    expect(await welcome()).toBeVisible();
  });
  it('restores an authenticated session and redirects away from login', async () => {
    authService.me.mockResolvedValue(user);
    renderApp();
    expect(await welcome()).toBeVisible();
    expect(authService.me).toHaveBeenCalledTimes(1);
  });
  it('offers retry on initial network failure instead of assuming the user is logged out', async () => {
    authService.me.mockRejectedValueOnce(new Error('network')).mockResolvedValue(user);
    renderApp('/app');
    expect(await screen.findByRole('heading', { name: 'Let’s reconnect.' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Welcome back.' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await welcome()).toBeVisible();
  });
  it('logs out and returns to login after the server clears the cookie', async () => {
    authService.me.mockResolvedValue(user);
    renderApp('/app');
    await welcome();
    await userEvent.click(screen.getAllByRole('button', { name: 'Sign out' })[0]);
    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeVisible();
    expect(authService.logout).toHaveBeenCalledTimes(1);
  });
  it('keeps the session visible if logout fails and gives a retryable error', async () => {
    authService.me.mockResolvedValue(user);
    authService.logout.mockRejectedValue(new Error('network'));
    renderApp('/app');
    await welcome();
    await userEvent.click(screen.getAllByRole('button', { name: 'Sign out' })[0]);
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not sign you out.');
    expect(await welcome()).toBeVisible();
  });
  it('ignores a stale session response that arrives after logout', async () => {
    let resolveStale;
    authService.me.mockResolvedValueOnce(user).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStale = resolve;
        }),
    );
    renderApp('/app');
    await welcome();
    await waitFor(() => {
      fireEvent(window, new Event('focus'));
      expect(resolveStale).toBeTypeOf('function');
    });
    await userEvent.click(screen.getAllByRole('button', { name: 'Sign out' })[0]);
    await screen.findByRole('heading', { name: 'Welcome back.' });
    await act(async () => resolveStale(user));
    expect(screen.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
    expect(screen.queryByText(/Make yourself at home/)).not.toBeInTheDocument();
  });
  it('handles a protected API 401 consistently and explains session expiry', async () => {
    authService.me.mockResolvedValue(user);
    renderApp('/app');
    await welcome();
    act(() => unauthorized());
    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Your session has ended.');
  });
  it('rechecks the session when the authenticated window regains focus', async () => {
    authService.me.mockResolvedValueOnce(user).mockRejectedValue({ response: { status: 401 } });
    renderApp('/app');
    await welcome();
    fireEvent(window, new Event('focus'));
    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeVisible();
    expect(authService.me).toHaveBeenCalledTimes(2);
  });
  it('supports mobile navigation and closes it when a destination is selected', async () => {
    authService.me.mockResolvedValue(user);
    renderApp('/app');
    await welcome();
    await userEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    expect(screen.getByRole('dialog')).toHaveAttribute('open');
    await userEvent.click(screen.getAllByRole('link', { name: /My account/ })[1]);
    expect(await screen.findByRole('heading', { name: 'Your account.' })).toBeVisible();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
  it('renders a useful not-found screen', async () => {
    renderApp('/does-not-exist');
    expect(await screen.findByRole('heading', { name: 'A little out of the way.' })).toBeVisible();
  });
});
