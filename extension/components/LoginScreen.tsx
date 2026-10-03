import { useState } from 'react';
import { supabase } from '../utils/supabase';

interface LoginScreenProps {
  onLogin: () => void;
}

export default function LoginScreen({ onLogin }: LoginScreenProps) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);

  const handleGoogleLogin = async () => {
    setError('');
    setLoading(true);
    try {
      if (typeof chrome === 'undefined' || !chrome.identity) {
        throw new Error('Chrome Identity API is missing. Please reload the extension in chrome://extensions and ensure you are opening it as a popup.');
      }

      const redirectUrl = chrome.identity.getRedirectURL();

      // 1. Get the OAuth URL from Supabase without redirecting the popup
      const { data, error: authError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUrl,
          skipBrowserRedirect: true, // Don't close the popup!
          queryParams: { access_type: 'offline', prompt: 'consent' },
        },
      });

      if (authError) throw authError;
      if (!data?.url) throw new Error('Failed to get auth URL');

      // 2. Launch Chrome's native auth flow
      const responseUrl = await new Promise<string>((resolve, reject) => {
        chrome.identity.launchWebAuthFlow(
          { url: data.url, interactive: true },
          (callbackUrl) => {
            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError);
            } else if (callbackUrl) {
              resolve(callbackUrl);
            } else {
              reject(new Error('No callback URL received'));
            }
          }
        );
      });

      // 3. Parse the tokens from the callback URL and set the session
      // The URL looks like: https://<id>.chromiumapp.org/#access_token=...&refresh_token=...
      const hash = new URL(responseUrl).hash;
      const params = new URLSearchParams(hash.substring(1));
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');

      if (!accessToken || !refreshToken) {
        throw new Error('Missing tokens in auth response');
      }

      const { error: sessionError } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });

      if (sessionError) throw sessionError;

      onLogin(); // Success!
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed');
    } finally {
      setLoading(false);
    }
  };

  const handleEmailAuth = async () => {
    setError('');
    setInfo('');
    if (!email.trim() || !password.trim()) {
      setError('Please enter both email and password.');
      return;
    }
    setLoading(true);
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        onLogin();
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setInfo('✅ Check your email to confirm your account, then log in!');
        setMode('login');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      minHeight: '520px',
      padding: '32px 24px',
      background: 'var(--color-pc-bg)',
      gap: 0,
    }}>

      {/* Logo + Heading */}
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div style={{
          width: 52,
          height: 52,
          borderRadius: 14,
          background: 'linear-gradient(135deg, var(--color-pc-accent-start), var(--color-pc-accent-end))',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 26,
          margin: '0 auto 12px',
          boxShadow: '0 4px 16px rgba(0,212,255,0.3)',
        }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2L2 7L12 12L22 7L12 2Z" fill="#111116"/>
            <path d="M2 17L12 22L22 17M2 12L12 17L22 12" stroke="#111116" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <h1 style={{
          fontSize: '1.25rem',
          fontWeight: 700,
          color: 'var(--color-pc-text)',
          margin: 0,
          fontFamily: 'var(--font-sans)',
        }}>JobFill</h1>
        <p style={{
          fontSize: '0.78rem',
          color: 'var(--color-pc-text-muted)',
          margin: '6px 0 0',
        }}>Sign in to sync your data across devices</p>
      </div>

      {/* Google Sign In */}
      <button
        onClick={handleGoogleLogin}
        disabled={loading}
        style={{
          width: '100%',
          maxWidth: 320,
          padding: '10px 16px',
          borderRadius: 10,
          border: '1px solid var(--color-pc-border)',
          background: 'var(--color-pc-surface)',
          color: 'var(--color-pc-text)',
          fontSize: '0.85rem',
          fontWeight: 600,
          cursor: loading ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          fontFamily: 'var(--font-sans)',
          transition: 'all 0.2s',
          opacity: loading ? 0.6 : 1,
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        Continue with Google
      </button>

      {/* Divider */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        maxWidth: 320,
        margin: '18px 0',
      }}>
        <div style={{ flex: 1, height: 1, background: 'var(--color-pc-border)' }} />
        <span style={{ fontSize: '0.72rem', color: 'var(--color-pc-text-muted)' }}>or</span>
        <div style={{ flex: 1, height: 1, background: 'var(--color-pc-border)' }} />
      </div>

      {/* Email + Password */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', maxWidth: 320 }}>
        <input
          type="email"
          placeholder="Email address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleEmailAuth()}
          style={{
            padding: '10px 14px',
            borderRadius: 10,
            border: '1px solid var(--color-pc-border)',
            background: 'var(--color-pc-surface)',
            color: 'var(--color-pc-text)',
            fontSize: '0.83rem',
            fontFamily: 'var(--font-sans)',
            outline: 'none',
          }}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleEmailAuth()}
          style={{
            padding: '10px 14px',
            borderRadius: 10,
            border: '1px solid var(--color-pc-border)',
            background: 'var(--color-pc-surface)',
            color: 'var(--color-pc-text)',
            fontSize: '0.83rem',
            fontFamily: 'var(--font-sans)',
            outline: 'none',
          }}
        />

        {error && (
          <p style={{ color: '#ff6b6b', fontSize: '0.75rem', margin: 0, textAlign: 'center' }}>{error}</p>
        )}
        {info && (
          <p style={{ color: '#4ade80', fontSize: '0.75rem', margin: 0, textAlign: 'center' }}>{info}</p>
        )}

        <button
          onClick={handleEmailAuth}
          disabled={loading}
          style={{
            padding: '10px 16px',
            borderRadius: 10,
            border: 'none',
            background: 'linear-gradient(135deg, var(--color-pc-accent-start), var(--color-pc-accent-end))',
            color: '#000',
            fontSize: '0.85rem',
            fontWeight: 700,
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.6 : 1,
            fontFamily: 'var(--font-sans)',
            transition: 'all 0.2s',
          }}
        >
          {loading ? '...' : mode === 'login' ? '🔐 Sign In' : '✨ Create Account'}
        </button>

        <button
          onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); setInfo(''); }}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--color-pc-text-muted)',
            fontSize: '0.75rem',
            cursor: 'pointer',
            fontFamily: 'var(--font-sans)',
          }}
        >
          {mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
        </button>
      </div>

      <p style={{
        fontSize: '0.68rem',
        color: 'var(--color-pc-text-muted)',
        textAlign: 'center',
        marginTop: 24,
        lineHeight: 1.5,
        maxWidth: 280,
      }}>
        🔒 Your documents are encrypted and only accessible by you
      </p>
    </div>
  );
}
