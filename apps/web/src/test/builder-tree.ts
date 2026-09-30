import { screen, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";

/**
 * Selects a builder item in its tree (A-D1 A2): the editor shows only the selected item. `key`
 * is the config key the tree row shows in mono ("commands"), or "Label text" for the label overlay.
 * Rows read "<name> <key>[, <issues>]", so the key (a plain identifier) is matched at the end.
 */
export async function selectBuilderItem(user: UserEvent, key: string): Promise<void> {
  const nav = await screen.findByRole("navigation", { name: "Configuration items" });
  const name =
    key === "Label text" ? /^Labels and translations(,|$)/ : new RegExp(`(^| )${key}(,.*)?$`);
  await user.click(within(nav).getByRole("treeitem", { name }));
}

/**
 * The element of a generic-form setting, found by its config path. The path is not in the control's
 * name (B1): a visually hidden hint "Setting: <path>" describes it, so this looks the hint up and
 * returns the `selector` element it describes (the input by default).
 */
export async function findSetting<T extends HTMLElement = HTMLInputElement>(
  path: string,
  root: HTMLElement = document.body,
  selector = "input",
): Promise<T> {
  const hint = await within(root).findByText(`Setting: ${path}`);
  const el = root.querySelector<T>(`${selector}[aria-describedby~="${CSS.escape(hint.id)}"]`);
  if (el === null) throw new Error(`no ${selector} is described by "Setting: ${path}"`);
  return el;
}

/** The "Add item" button of the generic list at `path`. */
export const findAddItem = (path: string, root: HTMLElement = document.body) =>
  findSetting<HTMLButtonElement>(path, root, "button");
