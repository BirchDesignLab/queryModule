import { useNavigate } from "react-router";
import { leaveGuards } from "./leave-guard.js";
import { useServices } from "./services-context.js";

/**
 * The one sign-out path for every screen (#242). A server failure still wipes this device and
 * rejects; the controller flags it and persists the marker (#235, #241), and the sign-in page
 * shows the notice with a retry, so there is nothing to render here.
 */
export function useSignOut(): () => Promise<void> {
  const services = useServices();
  const { session } = services;
  const navigate = useNavigate();
  return async () => {
    // A screen with unsaved work may ask first (the config builder's draft); a refusal stays put.
    if (!(await leaveGuards(services).confirm())) return;
    await session.signOut().catch(() => undefined);
    navigate("/login", { replace: true });
  };
}
