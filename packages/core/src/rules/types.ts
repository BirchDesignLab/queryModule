import type { FieldDef, Literal, Picklist, QueryType } from "../config/index.js";
import type { ValidationError } from "../contracts/index.js";

/** Canonical field value; dates are ISO YYYY-MM-DD strings (spec 4.3). */
export type CanonicalValue = string | number | boolean;

/** A value as typed or picked, before canonicalisation. */
export type RawValue = string | number | boolean | null | undefined;

/** Draft user values as entered (spec 4.3 `input`). */
export type FormInput = Readonly<Record<string, string | number | boolean | null>>;

/** The part of SiteConfig or ClientSiteConfig the rules engine reads. */
export interface RulesConfig {
  defaults: Readonly<Record<string, Literal>>;
  picklists: readonly Picklist[];
  queryTypes: readonly QueryType[];
}

export interface EvaluateOptions {
  /** Epoch ms; feeds century "past" (spec 4.3). */
  now: number;
}

export type FormMode = "normal" | "plateOnly";

export interface FieldOption {
  code: string;
  labelKey: string;
}

export interface FieldState {
  key: string;
  labelKey: string;
  dataType: FieldDef["dataType"];
  role?: "type";
  order: number;
  section: string;
  sectionLabelKey: string;
  visible: boolean;
  required: boolean;
  userValue: CanonicalValue | null;
  effectiveValue: CanonicalValue | null;
  isDefault: boolean;
  options?: FieldOption[];
}

export interface SectionState {
  key: string;
  labelKey: string;
  visible: boolean;
}

export interface SourceState {
  sourceId: string;
  selectedByDefault: boolean;
  plateOnly: boolean;
}

export interface FormState {
  queryType: string;
  mode: FormMode;
  sections: SectionState[];
  fields: FieldState[];
  sources: SourceState[];
  values: Record<string, CanonicalValue>;
  missingRequired: string[];
  hiddenWithValue: string[];
  errors: ValidationError[];
  valid: boolean;
}
