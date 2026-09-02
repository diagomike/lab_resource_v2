import "server-only";

const REASON_PHRASE: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  500: "Internal Server Error",
};

/**
 * Replaces every NestJS `HttpException` subclass (`BadRequestException`,
 * `UnauthorizedException`, `ForbiddenException`, `NotFoundException`, ...) thrown across
 * the ported services. Two modes, matching NestJS's own two constructor forms exactly
 * (verified against docs/pre-conversion-api-reference.md, the recorded runtime snapshot):
 *
 *  - `new HttpError(401, "Not signed in")` — a plain string message — produces
 *    `{message, error, statusCode}`, the shape NestJS builds automatically for a
 *    string-argument exception (e.g. `UnauthorizedException("Not signed in")`).
 *  - `new HttpError(400, "Validation failed", {message, issues})` — an explicit body —
 *    is returned AS-IS, no error/statusCode added. This is what
 *    `ZodValidationPipe`/`parseBody` needs: NestJS does not wrap an object-argument
 *    exception's body in the auto {error, statusCode} shape, only a string-argument one.
 */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    const body =
      err.body ?? { message: err.message, error: REASON_PHRASE[err.status] ?? "Error", statusCode: err.status };
    return Response.json(body, { status: err.status });
  }
  // eslint-disable-next-line no-console
  console.error(err);
  return Response.json(
    { message: "Internal server error", error: "Internal Server Error", statusCode: 500 },
    { status: 500 },
  );
}

/** Wraps a Route Handler body so every thrown HttpError (or unexpected error) becomes
 *  the right Response, without a try/catch repeated in every route.ts file. */
export function withErrorHandling(
  handler: (request: Request, context: unknown) => Promise<Response>,
): (request: Request, context: unknown) => Promise<Response> {
  return async (request, context) => {
    try {
      return await handler(request, context);
    } catch (err) {
      return errorResponse(err);
    }
  };
}
