import { useState } from 'react';
import { useStore } from '../store/store';

export default function LoginScreen() {
  const knownUsers = useStore((s) => s.knownUsers);
  const loginUser = useStore((s) => s.loginUser);
  const [showForm, setShowForm] = useState(knownUsers.length === 0);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

  const canSubmit = name.trim().length > 0 && email.trim().length > 0;

  return (
    <div className="login-screen">
      <div className="login-card glass">
        <div className="loading-mark">◆</div>
        <div className="loading-name">SRS Lab Designer</div>
        <p className="login-sub">Sign in to identify your changes. This device will remember you.</p>

        {!showForm && knownUsers.length > 0 && (
          <div className="login-known-list">
            {knownUsers.map((u) => (
              <button key={u.id} className="login-known-row" onClick={() => loginUser(u.name, u.email)}>
                <span className="login-avatar">{u.name.trim().charAt(0).toUpperCase() || '?'}</span>
                <span className="login-known-info">
                  <span className="login-known-name">{u.name}</span>
                  <span className="login-known-email">{u.email}</span>
                </span>
              </button>
            ))}
            <button className="btn login-other-btn" onClick={() => setShowForm(true)}>
              Use a different account
            </button>
          </div>
        )}

        {showForm && (
          <form
            className="login-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (canSubmit) loginUser(name, email);
            }}
          >
            <label className="label">Name</label>
            <input
              autoFocus
              className="field"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
            />
            <label className="label">Email</label>
            <input
              className="field"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
            <button className="btn primary login-submit" type="submit" disabled={!canSubmit}>
              Continue
            </button>
            {knownUsers.length > 0 && (
              <button type="button" className="btn login-cancel" onClick={() => setShowForm(false)}>
                Back
              </button>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
