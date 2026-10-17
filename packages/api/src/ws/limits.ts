/**
 * The default WebSocket upgrade attempts per client IP per window (decision D-A9, spec 5.3; no
 * FR/SEC ID covers it), defined once, in this gate-tier leaf that env.ts and ws/server.ts both
 * import (#574 G-G-m1, review G-M1). The deploy env may change it (WS_UPGRADE_LIMIT,
 * WS_UPGRADE_WINDOW_MS): the e2e harness raises it, since every signed-in page opens a feed socket
 * from one IP.
 */
export const WS_UPGRADE_LIMIT = { limit: 60, windowMs: 60_000 } as const;
