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
}: AccountMenuProps) {
  const t = useT();
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // The menu can unmount with focus inside it (the persona layout flips to the compact bar when a
  // config lands, sign-out): hand focus to the page's main landmark, never to <body> (spec 6.4).
  useLayoutEffect(
    () => () => {
      if (wrapRef.current?.contains(document.activeElement))
        document.getElementById(MAIN_LANDMARK.id)?.focus();
    },
    [],
  );

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
          <ThemeModeSeg value={themeMode} onChange={onThemeChange} t={t} />
          <button type="button" className="qm-button qm-button--ghost" onClick={onSignOut}>
            {t("home.signOut")}
          </button>
        </fieldset>
      ) : null}
    </div>
  );
}
