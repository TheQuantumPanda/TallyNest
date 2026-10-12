import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';

export function Field({ label, id, error, hint, type = 'text', ...props }) {
  const [visible, setVisible] = useState(false);
  const password = type === 'password';
  const description =
    [error && `${id}-error`, hint && `${id}-hint`].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className={`input-wrap ${error ? 'input-invalid' : ''}`}>
        <input
          id={id}
          type={password && visible ? 'text' : type}
          aria-invalid={Boolean(error)}
          aria-describedby={description}
          {...props}
        />
        {password && (
          <button
            type="button"
            className="password-toggle"
            onClick={() => setVisible(!visible)}
            aria-label={visible ? 'Hide password' : 'Show password'}
            aria-pressed={visible}
            disabled={props.disabled}
          >
            {visible ? (
              <EyeOff size={18} aria-hidden="true" />
            ) : (
              <Eye size={18} aria-hidden="true" />
            )}
          </button>
        )}
      </div>
      {hint && (
        <p id={`${id}-hint`} className="field-hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}
