import type { Translator } from "@querymodule/client";
import { createContext, type ReactNode, useContext } from "react";

const I18nContext = createContext<Translator | null>(null);

export function I18nProvider({
  translator,
  children,
}: {
  translator: Translator;
  children: ReactNode;
}) {
  return <I18nContext.Provider value={translator}>{children}</I18nContext.Provider>;
}

export function useT(): Translator["t"] {
  const translator = useContext(I18nContext);
  if (translator === null) throw new Error("I18nProvider missing");
  return translator.t;
}
