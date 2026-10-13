import { useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowRight, LockKeyhole } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { validateAuth } from '../../utils/validation';
import { authErrorMessage } from '../../utils/authErrors';
import { Field } from '../ui/Field';
import { Button } from '../ui/Button';
import { Notice } from '../ui/Notice';

export function AuthForm({ mode }) {
  const register = mode === 'register';
  const auth = useAuth();
  const location = useLocation();
  const form = useRef(null);
  const [values, setValues] = useState({ name: '', email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [pending, setPending] = useState(false);

  function change(event) {
    const { name, value } = event.target;
    setValues((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: undefined }));
    setServerError('');
  }
  async function submit(event) {
    event.preventDefault();
    if (pending) return;
    const input = register ? values : { email: values.email, password: values.password };
    const result = validateAuth(mode, input);
    setErrors(result.errors);
    setServerError('');
    if (!result.data) {
      form.current.elements.namedItem(Object.keys(result.errors)[0])?.focus();
      return;
    }
    setPending(true);
    try {
      await auth[mode](result.data);
    } catch (error) {
      setServerError(authErrorMessage(error, mode));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="auth-form-panel">
      <span className="eyebrow">
        <span className="status-dot" /> YOUR NEXT CHAPTER
      </span>
      <h1>{register ? 'A fresh perspective.' : 'Welcome back.'}</h1>
      <p className="auth-subtitle">
        {register
          ? 'Create your account. Make space for a clearer financial life.'
          : 'Your space to see clearly and move confidently.'}
      </p>
      {location.state?.reason === 'expired' && (
        <Notice tone="info">Your session has ended. Please sign in again.</Notice>
      )}
      {serverError && <Notice>{serverError}</Notice>}
      <form
        ref={form}
        onSubmit={submit}
        noValidate
        aria-label={register ? 'Create account' : 'Sign in'}
      >
        {register && (
          <Field
            id="name"
            name="name"
            label="Full name"
            autoComplete="name"
            placeholder="Your name"
            value={values.name}
            onChange={change}
            error={errors.name}
            disabled={pending}
            required
          />
        )}
        <Field
          id="email"
          name="email"
          label="Email address"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          value={values.email}
          onChange={change}
          error={errors.email}
          disabled={pending}
          required
        />
        <Field
          id="password"
          name="password"
          label="Password"
          type="password"
          autoComplete={register ? 'new-password' : 'current-password'}
          placeholder={register ? 'At least 12 characters' : 'Enter your password'}
          value={values.password}
          onChange={change}
          error={errors.password}
          hint={register ? 'At least 12 characters. A memorable phrase works well.' : undefined}
          disabled={pending}
          required
        />
        <Button type="submit" loading={pending} className="auth-submit">
          {pending
            ? register
              ? 'Creating your account…'
              : 'Signing you in…'
            : register
              ? 'Create account'
              : 'Sign in'}
          {!pending && <ArrowRight size={18} aria-hidden="true" />}
        </Button>
      </form>
      <p className="auth-switch">
        {register ? 'Already have an account?' : 'New to TallyNest?'}{' '}
        <Link to={register ? '/login' : '/register'} state={location.state}>
          {register ? 'Sign in' : 'Create an account'}
        </Link>
      </p>
      <p className="privacy-note">
        <LockKeyhole size={14} aria-hidden="true" /> A private workspace. A calmer start.
      </p>
    </div>
  );
}
