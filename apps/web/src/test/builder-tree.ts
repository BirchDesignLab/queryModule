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
 * The input of a generic-form setting, found by its config path. The path is not in the control's
 * name (B1): a visually hidden hint "Setting: <path>" describes it, so this looks the hint up and
 * returns the input it describes.
 */
export async function findSetting(path: string, root: HTMLElement = document.body) {
  const hint = await within(root).findByText(`Setting: ${path}`);
  const input = root.querySelector<HTMLInputElement>(
    `input[aria-describedby~="${CSS.escape(hint.id)}"]`,
  );
  if (input === null) throw new Error(`no input is described by "Setting: ${path}"`);
  return input;
}
