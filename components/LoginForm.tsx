'use client';

import { FormEvent, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) {
        setError(result.error ?? 'Login gagal.');
        return;
      }
      const requested = searchParams.get('next');
      router.replace(requested?.startsWith('/dashboard') ? requested : '/dashboard');
      router.refresh();
    } catch {
      setError('Tidak dapat terhubung ke server. Silakan coba lagi.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">
          <span className="auth-brand-mark">SM</span>
          <div>
            <h1>Satoria Mixing Monitor</h1>
            <p>Sistem Monitoring</p>
          </div>
        </div>
        <h2>Masuk ke akun Anda</h2>
        <label htmlFor="login-email">Email</label>
        <input
          id="login-email"
          type="email"
          autoComplete="username"
          required
          maxLength={254}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <label htmlFor="login-password">Password</label>
        <input
          id="login-password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={128}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Memeriksa...' : 'Masuk'}
        </button>
      </form>
    </main>
  );
}
