import type { ReactNode } from "react";
import { VisuallyHidden } from "../visually-hidden.js";

export interface FieldIds {
  tagId: string | undefined;
  descriptionId: string | undefined;
  errorId: string | undefined;
  /** Space-separated ids for aria-describedby, or undefined when none. */
  describedBy: string | undefined;
}

function hasTag(tag: ReactNode): boolean {
  return tag !== undefined && tag !== null;
}

/** Ids for the tag, description and error, in reading order (spec 6.2). */
export function fieldIds(
  id: string,
  tag: ReactNode,
  description: string | undefined,
  error: string | undefined,
): FieldIds {
  const tagId = hasTag(tag) ? `${id}-tag` : undefined;
  const descriptionId = description === undefined ? undefined : `${id}-description`;
  const errorId = error === undefined ? undefined : `${id}-error`;
  const describedBy = [tagId, descriptionId, errorId].filter((x) => x !== undefined).join(" ");
  return {
    tagId,
    descriptionId,
    errorId,
    describedBy: describedBy === "" ? undefined : describedBy,
  };
}

/** Visible * (aria-hidden) plus hidden "required" text; renders nothing when not required. */
export function RequiredMark({
  required,
  requiredText,
}: {
  required: boolean;
  requiredText: string;
}) {
  if (!required) return null;
  return (
    <>
      <span aria-hidden="true" className="qm-field__required-mark">
        {" "}
        *
      </span>
      <VisuallyHidden> {requiredText}</VisuallyHidden>
    </>
  );
}

/** The default tag, description and error paragraphs, with the ids fieldIds computed. */
export function FieldMessages({
  ids,
  tag,
  description,
  error,
}: {
  ids: FieldIds;
  tag: ReactNode;
  description: string | undefined;
  error: string | undefined;
}) {
  return (
    <>
      {ids.tagId === undefined ? null : (
        <span id={ids.tagId} className="qm-field__tag">
          {tag}
        </span>
      )}
      {description === undefined ? null : (
        <p id={ids.descriptionId} className="qm-field__description">
          {description}
        </p>
      )}
      {error === undefined ? null : (
        <p id={ids.errorId} className="qm-field__error">
          {error}
        </p>
      )}
    </>
  );
}
