import "server-only";
import type { z, ZodSchema } from "zod";
import { HttpError } from "./http-error";
import { readableIssues } from "@/lib/shared/validation-message";

/**
 * Replaces `@Body(new ZodValidationPipe(Schema)) body: Input`. Validates a request body
 * against the same Zod schema the frontend imports from lib/shared — the schema is the
 * contract; there are no class-validator DTOs. Reproduces
 * `{message:"Validation failed", issues}` exactly (verified against
 * docs/pre-conversion-api-reference.md's recorded 400 body) — `ApiError.issues` in
 * lib/api.ts needs no change to keep reading it.
 *
 * Generic is bound to the SCHEMA (`T extends ZodSchema`), not to `T` directly as an
 * output type — binding to a bare `ZodSchema<T>` infers `T` against Zod's Input type
 * parameter whenever a schema's input and output diverge (any `.default(...)` field),
 * silently returning a type where defaulted fields still look optional. Every
 * resource-management input schema (lib/shared/resources/category.ts and others) uses
 * `.default(...)`; every schema before it happened not to.
 */
export async function parseBody<T extends ZodSchema>(schema: T, request: Request): Promise<z.output<T>> {
  const json = await request.json().catch(() => undefined);
  const result = schema.safeParse(json);
  if (!result.success) {
    // The message names each field and how to fix it (lib/shared/validation-message.ts);
    // `issues` stays in the body for anything that reads them field by field.
    const message = readableIssues(result.error.issues);
    throw new HttpError(400, message, { message, issues: result.error.issues });
  }
  return result.data;
}
