import { useEffect, useRef, useState } from "react";
import { ChevronDown, User } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/useAuth";

interface Props {
  onRequestSignIn: () => void;
  onOpenAccount: () => void;
}

export function AccountControl({ onRequestSignIn, onOpenAccount }: Props) {
  const { user, loading, enabled } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  if (!enabled || loading) return null;

  if (user) {
    const label = (user.user_metadata?.display_name as string | undefined) || user.email;
    return (
      <div className="account-menu" ref={menuRef}>
        <button
          className="btn btn-ghost account-trigger"
          onClick={() => setMenuOpen((open) => !open)}
          aria-haspopup="true"
          aria-expanded={menuOpen}
        >
          <User size={15} strokeWidth={2} aria-hidden="true" />
          {label}
          <ChevronDown size={13} strokeWidth={2} aria-hidden="true" />
        </button>
        {menuOpen && (
          <div className="account-dropdown">
            <button
              className="account-dropdown-item"
              onClick={() => {
                setMenuOpen(false);
                onOpenAccount();
              }}
            >
              User account
            </button>
            <button
              className="account-dropdown-item"
              onClick={() => {
                setMenuOpen(false);
                supabase?.auth.signOut();
              }}
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <button className="btn btn-ghost" onClick={onRequestSignIn}>
      Sign in
    </button>
  );
}
