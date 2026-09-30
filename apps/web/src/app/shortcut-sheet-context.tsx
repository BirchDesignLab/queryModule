import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";

/** The page's keyboard shortcut sheet, for the account menu's "Keyboard shortcuts" item. */
export interface ShortcutSheetHandle {
  /** Opens the sheet; null while no page offers one (the item is then not shown). */
  open: (() => void) | null;
  /** The live query panel registers its opener on mount and clears it (null) on unmount. */
  register(open: (() => void) | null): void;
}

const ShortcutSheetContext = createContext<ShortcutSheetHandle>({
  open: null,
  register: () => undefined,
});

/** Held by AppShell: the header's account menu and the page's panel meet here (visual system). */
export function ShortcutSheetProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<(() => void) | null>(null);
  const register = useCallback((next: (() => void) | null) => setOpen(() => next), []);
  const value = useMemo(() => ({ open, register }), [open, register]);
  return <ShortcutSheetContext.Provider value={value}>{children}</ShortcutSheetContext.Provider>;
}

export function useShortcutSheet(): ShortcutSheetHandle {
  return useContext(ShortcutSheetContext);
}
