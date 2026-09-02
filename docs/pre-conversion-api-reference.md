# Pre-conversion API reference snapshot

Recorded 2026-09-02, immediately before the npm-workspace → single Next.js conversion
(see `C:\Users\pc\.claude\plans\act-as-the-principal-hazy-thompson.md`, Phase 0). This is
the **runtime** reference the conversion's Phase 4 diffs new Route Handler responses
against — status codes, exact body shapes, and cookie attributes — since reading the old
NestJS source can confirm intended behavior but not exact wire-format details (cookie
attribute serialization, NestJS's default exception-filter JSON shape).

Captured against the seeded dev database (`admin@astu.edu.et` / `astu1234`,
`head.se@astu.edu.et` / `astu1234`) via `curl -i` against the NestJS API on
`localhost:3001`, immediately before it was stopped for the last time under the old
architecture.

Pre-conversion baseline: `npm run build` succeeds (all three workspaces); `npm test`
passes 112 tests (18 api + 94 web).

## `POST /api/auth/login` — success (201)

```
HTTP/1.1 201 Created
Set-Cookie: lrms_session=<token>; Max-Age=604800; Path=/; Expires=<+7d>; HttpOnly; SameSite=Lax
Content-Type: application/json; charset=utf-8

{"id":"cmtjtip0e0000v5x0z1r7ojkd","email":"admin@astu.edu.et","name":"System Administrator","phone":null,"status":"ACTIVE","roles":["SYS_ADMIN"]}
```

Note: **201, not 200**, for a successful POST — NestJS's default. No `Secure` attribute
in dev (non-HTTPS). `Max-Age=604800` = `SESSION_TTL_DAYS=7` × 86400.

## `POST /api/auth/login` — wrong password (401)

```
HTTP/1.1 401 Unauthorized
{"message":"Invalid email or password","error":"Unauthorized","statusCode":401}
```

Same message for "no such user" — account-enumeration resistant, not tested here but
load-bearing: do not let the Route Handler port introduce a different message per case.

## `GET /api/auth/me` — authenticated (200)

```
HTTP/1.1 200 OK
{"user":{"id":"cmtjtip0e0000v5x0z1r7ojkd","email":"admin@astu.edu.et","name":"System Administrator","phone":null,"status":"ACTIVE","roles":["SYS_ADMIN"]},"scope":{"nodeId":null,"name":"Entire university","level":0,"kind":null,"isLeaf":false,"isGlobal":true,"isOccupant":false,"reachableNodeCount":5},"canSeeCost":true,"workspace":"admin","availableWorkspaces":["admin"]}
```

## `GET /api/auth/me` — unauthenticated (401)

```
HTTP/1.1 401 Unauthorized
{"message":"Not signed in","error":"Unauthorized","statusCode":401}
```

## `POST /api/org/nodes` — validation failure (400)

Body: `{"name":""}` (missing `level`/`kind`/`parentIds`, empty `name`).

```
HTTP/1.1 400 Bad Request
{"message":"Validation failed","issues":[{"code":"too_small","minimum":1,"type":"string","inclusive":true,"exact":false,"message":"String must contain at least 1 character(s)","path":["name"]},{"code":"invalid_type","expected":"number","received":"undefined","path":["level"],"message":"Required"},{"expected":"'UNIVERSITY' | 'COLLEGE' | 'DEPARTMENT' | 'OFFICE'","received":"undefined","code":"invalid_type","path":["kind"],"message":"Required"},{"code":"invalid_type","expected":"array","received":"undefined","path":["parentIds"],"message":"Required"}]}
```

This exact shape (`{message, issues}`, `issues` being raw Zod `ZodIssue[]`) is what
`parseBody()` must reproduce — it's what `apps/web/src/lib/api.ts`'s `ApiError.issues`
carries today.

## `POST /api/org/nodes` — role refusal (403)

Signed in as `head.se@astu.edu.et` (MANAGER, not SYS_ADMIN):

```
HTTP/1.1 403 Forbidden
{"message":"Requires one of: SYS_ADMIN","error":"Forbidden","statusCode":403}
```

Message format: `"Requires one of: " + allowedRoles.join(", ")` — reproduce exactly in
`requireRole()`.

## `GET /api/resources/items/:id` — unknown id (404)

```
HTTP/1.1 404 Not Found
{"message":"Resource not found","error":"Not Found","statusCode":404}
```

## `POST /api/auth/logout` (201)

```
HTTP/1.1 201 Created
Set-Cookie: lrms_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT
Content-Length: 0
```

Note: clearing sets `Expires` to the epoch with **no `Max-Age`, no `HttpOnly`/`SameSite`
attributes echoed back** — this is Express's `res.clearCookie()` default serialization.
`response.cookies.delete()` in the Route Handler port must produce an equivalent
clearing `Set-Cookie`; verify it does (Next's `.delete()` may serialize differently —
check the actual header in Phase 6, don't assume parity).

## `GET /api/resources/categories` (200)

```json
[{"id":"cmtjtip36000gv5x0l9p4kjhw","key":"lab","name":"Lab","iconKey":"Building2","groupId":"cmtjtip33000ev5x0qpyez82x","groupName":"Places","countingMode":"SERIALIZED","unit":null,"impairRule":"ANY_CRITICAL","defaultImageKey":null,"version":0,"active":true,"fields":[{"id":"cmtjtip36000hv5x0g5g3auvm","key":"room","label":"Room","type":"TEXT","options":[],"unit":null,"summary":true,"longText":false,"required":false,"sortOrder":0},{"id":"cmtjtip36000iv5x07mzelzsp","key":"seats","label":"Seats","type":"NUMBER","options":[],"unit":null,"summary":true,"longText":false,"required":false,"sortOrder":1},{"id":"cmtjtip36000jv5x0fzmouwna","key":"purpose","label":"Purpose","type":"TEXT","options":[],"unit":null,"summary":false,"longText":false,"required":false,"sortOrder":2},{"id":"cmtjtip36000kv5x0nvpc31kj","key":"source","label":"Source","type":"TEXT","options":[],"unit":null,"summary":false,"longText":false,"required":false,"sortOrder":3}]}]
```

## `GET /api/resources/search` — SYS_ADMIN, global scope (200)

Three items, spanning both seeded departments (confirms global reach — see the plan's
§9 role-based-scope check, which repeats this call as SE's department head and the
custodian and expects a strict subset):

```json
[{"id":"cmtjtip3e000nv5x0o2nm3pyi","parentId":null,"name":"Chemical Engineering Unit Operations Lab","categoryId":"cmtjtip36000gv5x0l9p4kjhw","categoryName":"Lab","countingMode":"SERIALIZED","qty":1,"status":"WORKING","critical":false,"ownerOrgNodeId":"cmtjtip250005v5x0ug9lvzqy","ownerOrgName":"Chemical Engineering","currentOrgNodeId":"cmtjtip250005v5x0ug9lvzqy","currentOrgName":"Chemical Engineering","custodianId":"cmtjtip2z000dv5x04pke66v1","custodianName":"Hanna Bekele","version":1,"updatedAt":"2026-09-02T08:12:16.394Z"},{"id":"cmtjtip3e000lv5x0anzvev1f","parentId":null,"name":"SE Lab X — Software Lab 3","categoryId":"cmtjtip36000gv5x0l9p4kjhw","categoryName":"Lab","countingMode":"SERIALIZED","qty":1,"status":"WORKING","critical":false,"ownerOrgNodeId":"cmtjtip230004v5x0ufxny9pt","ownerOrgName":"Software Engineering","currentOrgNodeId":"cmtjtip230004v5x0ufxny9pt","currentOrgName":"Software Engineering","custodianId":"cmtjtip2v000bv5x0cb7xmpjb","custodianName":"Girma Wolde","version":1,"updatedAt":"2026-09-02T08:12:16.394Z"},{"id":"cmtjtip3e000mv5x067jp4q2o","parentId":null,"name":"SE Networking Lab","categoryId":"cmtjtip36000gv5x0l9p4kjhw","categoryName":"Lab","countingMode":"SERIALIZED","qty":1,"status":"WORKING","critical":false,"ownerOrgNodeId":"cmtjtip230004v5x0ufxny9pt","ownerOrgName":"Software Engineering","currentOrgNodeId":"cmtjtip230004v5x0ufxny9pt","currentOrgName":"Software Engineering","custodianId":"cmtjtip2v000bv5x0cb7xmpjb","custodianName":"Girma Wolde","version":1,"updatedAt":"2026-09-02T08:12:16.394Z"}]
```

Note the ids above are stable (they come from the seed script's deterministic run order
against a fresh `prisma:seed`, not randomly assigned per-request) — if the dev database is
reseeded before Phase 4's comparison, re-run `prisma:seed` first and expect the same ids,
or re-capture this section if the seed itself changes.
