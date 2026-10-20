import type { ThemeModePreference } from "@querymodule/client";
import { ROLES } from "@querymodule/core/contracts";
import { ThemeModeSeg, VisuallyHidden } from "@querymodule/web-ui";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useT } from "./i18n-context.js";
import { MAIN_LANDMARK } from "./main-landmark.js";

export interface AccountMenuProps {
  email: string;
  role: string | null;
  themeMode: ThemeModePreference | null;
  onThemeChange(mode: ThemeModePreference): void;
  onSignOut(): void;
  /** The officer's bar carries the theme icons itself; the disclosure then omits the second control. */
  showTheme?: boolean;
  /** Opens the page's keyboard shortcut sheet; omitted where the page has none (no item). */
  onShowShortcuts?(): void;
  /** Where the terminal sits (UX-014 layout.terminal); an unset layout reads "toggle". */
  terminal?: "toggle" | "pane";
  /** Omitted where the layout has no terminal pane (the officer bar): no control. */
  onTerminalChange?(terminal: "toggle" | "pane"): void;
  /** The last save of the terminal layout failed: an alert says so and the control is reverted. */
  terminalSaveFailed?: boolean;
}

/**
 * The header's account disclosure (visual system, app shell): a button named by the signed-in
 * email that shows a panel with the user, role, theme choice and sign out. A disclosure, not a
 * menu: no aria-haspopup, the controls inside are ordinary Tab stops. Esc closes it and returns
 * focus to the button; a click or Tab outside closes it without moving focus.
 */
export function AccountMenu({
  email,
  role,
  themeMode,
  onThemeChange,
  onSignOut,
  showTheme = true,
  onShowShortcuts,
  terminal = "toggle",
  onTerminalChange,
  terminalSaveFailed = false,
}: AccountMenuProps) {
  const t = useT();
  const panelId = useId();
  const terminalHintId = useId();
  const [open, setOpen] = useState(false);
  // The failure alerts once (spec 6.6): after the menu has shown it and closed, the message stays as
  // plain text until the next pick clears it, and reopening the menu does not alert again.
  const [failureSpoken, setFailureSpoken] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const shortcutsRef = useRef<HTMLButtonElement>(null);
  // Focus repair B: the page's sheet can go away (the panel unmounts) while its item has focus. The
  // render that drops the item notes it, and the layout effect below finds focus on <body>, as the
  // panel's config-change repair does (QueryPanel T18-4).
  const shortcutsHadFocus = useRef(false);
  if (onShowShortcuts === undefined && typeof document !== "undefined") {
    const item = shortcutsRef.current;
    if (item !== null && item === document.activeElement) shortcutsHadFocus.current = true;
  }
  // Every commit: a ref flag makes it a no-op unless the render above noted the loss.
  useLayoutEffect(() => {
    if (!shortcutsHadFocus.current) return;
    shortcutsHadFocus.current = false;
    const active = document.activeElement;
    if (active === null || active === document.body) buttonRef.current?.focus();
  });

  // The menu can unmount with focus inside it (the persona layout flips to the compact bar when a
  // config lands, sign-out): hand focus to the page's main landmark, never to <body> (spec 6.4).
  useLayoutEffect(
    () => () => {
      if (wrapRef.current?.contains(document.activeElement))
        document.getElementById(MAIN_LANDMARK.id)?.focus();
    },
    [],
  );

  // The cleanup runs when the menu closes (or unmounts) after it showed the alert; a pick that
  // clears the failure starts the next one over.
  useEffect(() => {
    if (!terminalSaveFailed) {
      setFailureSpoken(false);
      return;
    }
    if (!open) return;
    return () => setFailureSpoken(true);
  }, [open, terminalSaveFailed]);

  // While open: Esc closes and returns focus to the button; a pointer press or focus moving
  // outside closes without touching focus.
  useEffect(() => {
    if (!open) return;
    const outside = (target: EventTarget | null) => !wrapRef.current?.contains(target as Node);
    const onPointerDown = (event: PointerEvent) => {
      if (outside(event.target)) setOpen(false);
    };
    const onFocusIn = (event: FocusEvent) => {
      if (outside(event.target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="qm-account">
      <button
        ref={buttonRef}
        type="button"
        className="qm-button qm-button--ghost qm-account__button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="qm-account__avatar" aria-hidden="true">
          {email.charAt(0).toUpperCase()}
        </span>
        <span className="qm-account__email">{email}</span>
      </button>
      {open ? (
        <fieldset id={panelId} className="qm-account__panel">
          <legend>
            <VisuallyHidden>{t("account.label")}</VisuallyHidden>
          </legend>
          <p className="qm-account__who">{t("home.signedInAs", { email })}</p>
          {role === null ? null : (
            <p className="qm-account__role">
              {t("account.role", {
                role: (ROLES as readonly string[]).includes(role) ? t(`role.${role}`) : role,
              })}
            </p>
          )}
          {showTheme ? <ThemeModeSeg value={themeMode} onChange={onThemeChange} t={t} /> : null}
          {onTerminalChange === undefined ? null : (
            <fieldset className="qm-account__terminal">
              <legend className="qm-account__terminal-label">{t("account.terminal.label")}</legend>
              <div className="qm-seg">
                {(["toggle", "pane"] as const).map((choice) => (
                  <button
                    key={choice}
                    type="button"
                    aria-pressed={terminal === choice}
                    aria-describedby={terminalHintId}
                    onClick={() => {
                      if (terminal !== choice) onTerminalChange(choice);
                    }}
                  >
                    {t(`account.terminal.${choice}`)}
                  </button>
                ))}
              </div>
              <p id={terminalHintId} className="qm-account__hint">
                {t("account.terminal.hint")}
              </p>
              {terminalSaveFailed ? (
                <p role={failureSpoken ? undefined : "alert"} className="qm-form-error">
                  {t(
                    terminal === "pane"
                      ? "account.terminal.saveFailedPane"
                      : "account.terminal.saveFailed",
                  )}
                </p>
              ) : null}
            </fieldset>
          )}
          {onShowShortcuts === undefined ? null : (
            <button
              ref={shortcutsRef}
              type="button"
              className="qm-button qm-button--ghost"
              onClick={() => {
                // Closed first, with focus on the account button: the sheet takes that as its
                // opener, so closing the sheet puts focus back on the button (spec 6.2 dialogs).
                setOpen(false);
                buttonRef.current?.focus();
                onShowShortcuts();
              }}
            >
              {t("shortcut.sheetTitle")}
            </button>
          )}
          <button type="button" className="qm-button qm-button--ghost" onClick={onSignOut}>
            {t("home.signOut")}
          </button>
        </fieldset>
      ) : null}
    </div>
  );
}
