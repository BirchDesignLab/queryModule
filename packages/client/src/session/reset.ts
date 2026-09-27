export interface ResetController {
  register(reset: () => void): () => void;
  resetAll(): void;
}

/** Every store, the query cache, the socket and the announcer register here (spec 6.7). */
export function createResetController(): ResetController {
  const resets = new Set<() => void>();
  return {
    register(reset) {
      resets.add(reset);
      return () => {
        resets.delete(reset);
      };
    },
    resetAll() {
      for (const reset of [...resets]) reset();
    },
  };
}
