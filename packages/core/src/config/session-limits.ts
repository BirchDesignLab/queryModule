/**
 * The session ceiling (SEC-005, spec 5.6, AUD-1, D-M2P2-2): the largest absolute limit
 * config:validate allows. Better Auth's own fixed expiry is this ceiling plus one sweeper interval
 * (auth.ts, #716), so it is strictly later than every allowed limit: identity refuses a session
 * at its live limit and the sweeper expires it (with its sessionRevoked row) before Better Auth's
 * expiry could remove one unaudited. config:validate and Better Auth both read it, so the two
 * cannot drift.
 */
export const SESSION_CEILING_MINUTES = 10_080;
