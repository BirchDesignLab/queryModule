import { createContext, type ReactNode, useContext } from "react";

const ClientSupportContext = createContext<boolean | null>(null);

/** Whether this client meets /meta's minClientVersion (NFR-001, spec 5.1), decided at boot. */
export function ClientSupportProvider({
  clientSupported,
  children,
}: {
  clientSupported: boolean;
  children: ReactNode;
}) {
  return (
    <ClientSupportContext.Provider value={clientSupported}>
      {children}
    </ClientSupportContext.Provider>
  );
}

export function useClientSupported(): boolean {
  const value = useContext(ClientSupportContext);
  if (value === null) throw new Error("ClientSupportProvider missing");
  return value;
}
