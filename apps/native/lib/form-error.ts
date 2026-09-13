/**
 * Pull the first human-readable message out of whatever TanStack Form's
 * `errorMap` holds — a string, a zod issue array, or an object with `message`.
 *
 * Lives here because both auth forms need it and neither owns it.
 */
export function getFormErrorMessage(error: unknown): string | null {
  if (!error) return null;

  if (typeof error === "string") {
    return error;
  }

  if (Array.isArray(error)) {
    for (const issue of error) {
      const message = getFormErrorMessage(issue);
      if (message) {
        return message;
      }
    }
    return null;
  }

  if (typeof error === "object") {
    const maybeError = error as { message?: unknown };
    if (typeof maybeError.message === "string") {
      return maybeError.message;
    }
  }

  return null;
}
