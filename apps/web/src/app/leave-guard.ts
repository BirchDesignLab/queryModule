import type { Services } from "./services.js";

/** Answers whether leaving is fine; may ask the user first. False keeps them where they are. */
export type LeaveGuard = () => boolean | Promise<boolean>;

export interface LeaveGuards {
  /** Adds a guard; the returned function removes it. */
  register(guard: LeaveGuard): () => void;
  /** Asks every guard in order; the first refusal stops the rest and answers false. */
  confirm(): Promise<boolean>;
}

const registries = new WeakMap<Services["reset"], LeaveGuards>();

/**
 * The seam sign-out asks before it wipes the device: a screen that holds work that the reset would
 * lose (the config builder's draft) registers a guard while it is mounted. One registry per app
 * instance. A guard that throws never blocks a sign-out: a user must always be able to leave.
 */
export function leaveGuards(services: Services): LeaveGuards {
  let guards = registries.get(services.reset);
  if (guards === undefined) {
    const list: LeaveGuard[] = [];
    guards = {
      register(guard) {
        list.push(guard);
        return () => {
          const at = list.indexOf(guard);
          if (at >= 0) list.splice(at, 1);
        };
      },
      async confirm() {
        for (const guard of [...list]) {
          try {
            if (!(await guard())) return false;
          } catch {
            // A broken guard is not a reason to keep someone signed in.
          }
        }
        return true;
      },
    };
    registries.set(services.reset, guards);
  }
  return guards;
}
