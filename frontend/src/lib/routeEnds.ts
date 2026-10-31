// How much of the route's start and end a search leaves out, as a share of
// its whole length: the first kilometres out of town and the last ones in
// are rarely where a rider stops. Stored on the account
// (user_metadata.skip_start_pct / skip_end_pct); without an account, or
// before it is set, the defaults apply. The backend takes at most
// MAX_SKIP_PCT on either end (MAX_SKIP_PCT in backend/randoo/main.py).
export const DEFAULT_SKIP_START_PCT = 10;
export const DEFAULT_SKIP_END_PCT = 5;
export const MAX_SKIP_PCT = 40;

export interface RouteEnds {
  startPct: number;
  endPct: number;
}

function validPct(value: unknown, fallback: number): number {
  return typeof value === "number" && value >= 0 && value <= MAX_SKIP_PCT ? value : fallback;
}

export function routeEndsFromUser(metadata: Record<string, unknown> | undefined): RouteEnds {
  return {
    startPct: validPct(metadata?.skip_start_pct, DEFAULT_SKIP_START_PCT),
    endPct: validPct(metadata?.skip_end_pct, DEFAULT_SKIP_END_PCT),
  };
}
