import type { ValidationError } from "@querymodule/core/contracts";

export type LoginField = "email" | "password";

export const LOGIN_LABEL_KEYS: Readonly<Record<LoginField, string>> = {
  email: "login.email",
  password: "login.password",
};

export function validateLogin(values: { email: string; password: string }): ValidationError[] {
  const errors: ValidationError[] = [];
  if (values.email.trim() === "")
    errors.push({ key: "validation.required", params: { field: "email" } });
  if (values.password === "")
    errors.push({ key: "validation.required", params: { field: "password" } });
  return errors;
}
