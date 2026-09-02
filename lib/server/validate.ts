import "server-only";
import type { ZodSchema } from "zod";
import { HttpError } from "./http-error";

/**
 * Replaces `@Body(new ZodValidationPipe(Schema)) body: Input`. Validates a request body
 * against the same Zod schema the frontend imports from lib/shared — the schema is the
 * contract; there are no class-validator DTOs. Reproduces
 * `{message:"Validation failed", issues}` exactly (verified against
 * docs/pre-conversion-api-reference.md's recorded 400 body) — `ApiError.issues` in
 * lib/api.ts needs no change to keep reading it.
 */
export async function parseBody<T>(schema: ZodSchema<T>, request: Request): Promise<T> {
  const json = await request.json().catch(() => undefined);
  const result = schema.safeParse(json);
  if (!result.success) {
    throw new HttpError(400, "Validation failed", {
      message: "Validation failed",
      issues: result.error.issues,
    });
  }
  return result.data;
}
