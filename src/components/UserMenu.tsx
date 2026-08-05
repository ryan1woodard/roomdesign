import { LogOut } from 'lucide-react';
import { useStore } from '../store/store';

export default function UserMenu() {
  const currentUser = useStore((s) => s.currentUser);
  const logout = useStore((s) => s.logout);

  if (!currentUser) return null;

  return (
    <div className="user-menu">
      <button className="user-menu-btn" onClick={logout} title="Log out">
        <span className="login-avatar">{currentUser.name.trim().charAt(0).toUpperCase() || '?'}</span>
        <span className="user-menu-name">{currentUser.name}</span>
        <LogOut size={13} />
      </button>
    </div>
  );
}
