import type { ShortcutBinding, ShortcutContext } from "@querymodule/core/config";
import { SHORTCUT_CONTEXTS } from "@querymodule/core/config";
import {
  createContext,
  type JSX,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { createShortcutEngine, strokeOf } from "./engine.js";

type Handler = () => void;
interface HandlerRef {
  current: Handler;
}
interface Registry {
  register(action: string, ref: HandlerRef): () => void;
}

const ShortcutContextValue = createContext<Registry | null>(null);

const CONTEXT_ATTRIBUTE = "data-shortcut-context";
const NON_TEXT_INPUT_TYPES = new Set(["checkbox", "radio"]);

/** Spec 6.4: single keys are inert in text entry, in the terminal and in contenteditable. */
function inTextInput(target: Element): boolean {
  if (target.closest("[data-terminal]") !== null) return true;
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUT_TYPES.has(target.type);
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  // jsdom has no isContentEditable; the attribute (self or ancestor) is the source of truth there.
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  const editable = target.closest("[contenteditable]");
  return editable !== null && editable.getAttribute("contenteditable") !== "false";
}

function contextsOf(target: Element): ShortcutContext[] {
  const found = new Set<ShortcutContext>(["global"]);
  for (let el: Element | null = target; el !== null; el = el.parentElement) {
    const value = el.getAttribute(CONTEXT_ATTRIBUTE);
    if (value !== null && (SHORTCUT_CONTEXTS as readonly string[]).includes(value)) {
      found.add(value as ShortcutContext);
    }
  }
  return [...found];
}

/**
 * Listens for keydown on document, feeds the pure engine and calls the handler registered for the
 * action it returns (spec 6.4). Handlers come from useShortcutAction; an action with none does nothing.
 */
export function ShortcutProvider({
  bindings,
  children,
}: {
  bindings: Readonly<Record<string, readonly ShortcutBinding[]>>;
  children: ReactNode;
}): JSX.Element {
  const handlers = useRef(new Map<string, HandlerRef[]>());
  const registry = useMemo<Registry>(
    () => ({
      register(action, ref) {
        const stack = handlers.current.get(action) ?? [];
        stack.push(ref);
        handlers.current.set(action, stack);
        return () => {
          const list = handlers.current.get(action);
          if (list === undefined) return;
          const at = list.indexOf(ref);
          if (at >= 0) list.splice(at, 1);
        };
      },
    }),
    [],
  );
  const engine = useMemo(() => createShortcutEngine(bindings), [bindings]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target instanceof Element ? event.target : document.body;
      const result = engine.handle(
        strokeOf(event),
        { inTextInput: inTextInput(target), contexts: contextsOf(target) },
        performance.now(),
      );
      if (result.kind !== "action") return;
      // Spec 6.2: a modal dialog makes the page behind it inert, so only dismiss may fire.
      if (result.action !== "dismiss" && document.querySelector("dialog[open]") !== null) return;
      const stack = handlers.current.get(result.action);
      const handler = stack?.[stack.length - 1];
      if (handler === undefined) return;
      event.preventDefault();
      // A held key auto-repeats keydown; run the action once per press (no submit burst).
      if (event.repeat) return;
      handler.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      engine.reset();
    };
  }, [engine]);

  return <ShortcutContextValue.Provider value={registry}>{children}</ShortcutContextValue.Provider>;
}

/** Registers `handler` for `action`; the latest registration wins and the latest function is called. */
export function useShortcutAction(action: string, handler: Handler): void {
  const registry = useContext(ShortcutContextValue);
  const ref = useRef<HandlerRef>({ current: handler });
  ref.current.current = handler;
  useEffect(() => {
    if (registry === null) return;
    return registry.register(action, ref.current);
  }, [registry, action]);
}
