/**
 * The default WebSocket upgrade attempts per client IP per window (decision D-A9, spec 5.3; no
 * FR/SEC ID covers it), defined once, in this gate-tier leaf that env.ts and ws/server.ts both
 * import (#574 G-G-m1, review G-M1). The deploy env may change it (WS_UPGRADE_LIMIT,
 * WS_UPGRADE_WINDOW_MS): the e2e harness raises it, since every signed-in page opens a feed socket
 * from one IP.
 */
export const WS_UPGRADE_LIMIT = { limit: 60, windowMs: 60_000 } as const;

/**
 * The client frames one socket may send per window (AW4 C1, M2 Manager 8 ruling 10-18-26). Every
 * frame (hello, ping, ackReceipt) spends one unit, and ping and ackReceipt each cost a DB read, so
 * an authenticated client cannot flood the server through one socket. The web client pings every
 * 20 s and sends one ackReceipt per acknowledged query, far below the limit. Past it the socket is
 * closed with WS_LOCAL_CLOSE.frameLimit (ws/server.ts).
 */
export const WS_CLIENT_FRAME_LIMIT = { limit: 120, windowMs: 60_000 } as const;
