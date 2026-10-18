/**
 * The session ceiling (SEC-005, spec 5.6, AUD-1, D-M2P2-2): Better Auth's own fixed expiry. It sits
 * at or above every absolute limit config:validate allows, so the live limits and the sweeper
 * always expire a session first (with its sessionRevoked row) and Better Auth's expiry never
 * removes one unaudited. config:validate reads it here; Better Auth's expiresIn reads it from M2 P2
 * AW3 (Task 8), so the two cannot drift.
 */
export const SESSION_CEILING_MINUTES = 10_080;
