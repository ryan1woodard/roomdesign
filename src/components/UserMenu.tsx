import { useEffect, useRef, useState } from 'react';
import { LogOut, Users, ChevronDown } from 'lucide-react';
import { useStore } from '../store/store';

export default function UserMenu() {
  const currentUser = useStore((s) => s.currentUser);
  const logout = useStore((s) => s.logout);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  if (!currentUser) return null;

  return (
    <div className="user-menu" ref={ref}>
      <button className="user-menu-btn" onClick={() => setOpen((v) => !v)}>
        <span className="login-avatar">{currentUser.name.trim().charAt(0).toUpperCase() || '?'}</span>
        <span className="user-menu-name">{currentUser.name}</span>
        <ChevronDown size={13} />
      </button>
      {open && (
        <div className="user-menu-dropdown glass">
          <div className="user-menu-email">{currentUser.email}</div>
          <div className="context-sep" />
          <button className="context-item" onClick={() => { setOpen(false); logout(); }}>
            <Users size={14} /> Switch user
          </button>
          <button className="context-item danger" onClick={() => { setOpen(false); logout(); }}>
            <LogOut size={14} /> Log out
          </button>
        </div>
      )}
    </div>
  );
}
