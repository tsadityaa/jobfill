import { useState } from 'react';
import type { VaultState } from '../types/vault';

interface VaultLockProps {
  vaultState: VaultState;
  onUnlock: (password: string) => Promise<void>;
  onSetup: (password: string) => Promise<void>;
}

export default function VaultLock({ vaultState, onUnlock, onSetup }: VaultLockProps) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isSetup = vaultState === 'uninitialized';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!password) {
      setError('Please enter a password');
      return;
    }

    if (isSetup) {
      if (password.length < 4) {
        setError('Password must be at least 4 characters');
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match');
        return;
      }
    }

    setLoading(true);
    try {
      if (isSetup) {
        await onSetup(password);
      } else {
        await onUnlock(password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="vault-lock animate-fade-in">
      {/* Floating particles background */}
      <div className="vault-particles">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="vault-particle"
            style={{
              '--particle-delay': `${i * 0.8}s`,
              '--particle-x': `${20 + Math.random() * 60}%`,
              '--particle-size': `${3 + Math.random() * 4}px`,
            } as React.CSSProperties}
          />
        ))}
      </div>

      {/* Shield Icon */}
      <div className="vault-lock-icon">
        <svg width="56" height="56" viewBox="0 0 48 48" fill="none">
          <defs>
            <linearGradient id="shield-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#8b5cf6" />
              <stop offset="50%" stopColor="#a78bfa" />
              <stop offset="100%" stopColor="#06b6d4" />
            </linearGradient>
          </defs>
          <path
            d="M24 4L6 12v12c0 11.1 7.7 21.5 18 24 10.3-2.5 18-12.9 18-24V12L24 4z"
            fill="url(#shield-grad)"
            opacity="0.15"
            stroke="url(#shield-grad)"
            strokeWidth="2"
          />
          {isSetup ? (
            <path
              d="M24 22v4m-4-4a4 4 0 1 1 8 0v4h-8v-4z M18 26h12v8H18v-8z"
              stroke="url(#shield-grad)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          ) : (
            <path
              d="M20 26h8m-8 0a4 4 0 1 1 8 0m-8 0v-4a4 4 0 1 1 8 0v4 M18 26h12v8H18v-8z"
              stroke="url(#shield-grad)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          )}
        </svg>
      </div>

      {/* Title */}
      <h2 className="vault-lock-title">
        {isSetup ? 'Secure Your Vault' : 'Vault Locked'}
      </h2>
      <p className="vault-lock-desc">
        {isSetup
          ? 'Create a password to encrypt your personal data. This password never leaves your device.'
          : 'Enter your password to unlock your encrypted data.'}
      </p>

      {/* Form */}
      <form className="vault-lock-form" onSubmit={handleSubmit}>
        <div className="form-group">
          <label className="form-label">
            {isSetup ? 'Create Password' : 'Password'}
          </label>
          <div className="vault-password-wrapper">
            <input
              id="vault-password"
              type={showPassword ? 'text' : 'password'}
              className="form-input"
              placeholder={isSetup ? 'Create a secure password' : 'Enter your password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              autoComplete="off"
            />
            <button
              type="button"
              className="vault-toggle-visibility"
              onClick={() => setShowPassword(!showPassword)}
              tabIndex={-1}
            >
              {showPassword ? '🙈' : '👁️'}
            </button>
          </div>
        </div>

        {isSetup && (
          <div className="form-group">
            <label className="form-label">Confirm Password</label>
            <input
              id="vault-confirm-password"
              type={showPassword ? 'text' : 'password'}
              className="form-input"
              placeholder="Re-enter your password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="off"
            />
          </div>
        )}

        {error && (
          <div className="vault-error animate-fade-in">
            ⚠ {error}
          </div>
        )}

        <button
          id="vault-submit"
          type="submit"
          className={`btn btn-primary btn-full vault-submit-btn ${loading ? 'vault-submit-loading' : ''}`}
          disabled={loading}
          style={{ marginTop: '16px' }}
        >
          {loading ? (
            <span className="vault-submit-content">
              <span className="spinner" />
              {isSetup ? 'Encrypting…' : 'Decrypting…'}
            </span>
          ) : (
            <span className="vault-submit-content">
              {isSetup ? '🔒 Create Vault' : '🔓 Unlock'}
            </span>
          )}
        </button>
      </form>

      {isSetup && (
        <p className="vault-lock-warning">
          ⚠ If you forget this password, your data cannot be recovered.
        </p>
      )}
    </div>
  );
}
