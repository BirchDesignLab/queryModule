export type AuthTransport = "cookie" | "bearer";

export interface TokenStore {
  get(): Promise<string | null>;
  set(token: string): Promise<void>;
  clear(): Promise<void>;
}

export interface PlatformSignal {
  current(): boolean;
  subscribe(listener: (value: boolean) => void): () => void;
}

/** Injected by apps/web and apps/mobile; packages/client imports nothing from the DOM or React Native (spec 3). */
export interface ClientPlatform {
  authTransport: AuthTransport;
  /** null for cookie transport; SecureStore-backed on native. */
  tokenStore: TokenStore | null;
  online: PlatformSignal;
  visible: PlatformSignal;
}

/** Web uses the `__Host-` cookie; there is no token to store. Holds nothing, so it stays in
 * platform.ts rather than a *token-store* file (W6 #85; a real SecureStore or web store
 * implementation would go in such a file, reserved at [critical] tier). */
export const noTokenStore: TokenStore = {
  get: async () => null,
  set: async () => undefined,
  clear: async () => undefined,
};
