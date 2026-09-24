import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/useAuth";

interface Props {
  onRequestSignIn: () => void;
}

export function AccountControl({ onRequestSignIn }: Props) {
  const { user, loading, enabled } = useAuth();

  if (!enabled || loading) return null;

  if (user) {
    return (
      <button className="btn btn-ghost" onClick={() => supabase?.auth.signOut()}>
        {(user.user_metadata?.display_name as string | undefined) || user.email}
      </button>
    );
  }

  return (
    <button className="btn btn-ghost" onClick={onRequestSignIn}>
      Sign in
    </button>
  );
}
