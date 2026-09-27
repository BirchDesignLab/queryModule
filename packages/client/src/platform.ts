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
