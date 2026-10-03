import { NextResponse, type NextRequest } from "next/server";
import { AssignCustodiansInput, DeclineAssignmentInput, RequestHoldsInput, ForwardExternalRequestInput, ReviewAssignmentInput, SubmitCollegeInput, SubmitDepartmentInput, type ExternalRequestDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse, HttpError } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { prisma } from "@/lib/server/prisma";
import { assignCustodians, declineAssignment, requestHolds, forwardToDepartments, reviewAssignment, submitCollege, submitDepartment } from "@/lib/server/external/requests";

type Params = { params: Promise<{ id: string; action: string }> };

/**
 * One unit's part of an external request — a college (its dean) or a department (its
 * head). Authorization lives in the service:
 *  - forward — the dean sends the college's part to its departments;
 *  - book — the head books the department's places: hold requests to their custodians;
 *  - assign — the head asks custodians to hold rooms or machines (older requests);
 *  - submit — the head sends the department's answer to the dean, or the dean the
 *    college's to the AVP;
 *  - review — the dean on a department's answer, the AVP on a college's (approve / return);
 *  - decline — the dean or head declines their unit's part.
 */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { id, action } = await params;
    let result: ExternalRequestDto;
    switch (action) {
      case "forward":
        result = await forwardToDepartments(user.id, id, await parseBody(ForwardExternalRequestInput, request));
        break;
      case "book":
        result = await requestHolds(user.id, id, await parseBody(RequestHoldsInput, request));
        break;
      case "assign":
        result = await assignCustodians(user.id, id, await parseBody(AssignCustodiansInput, request));
        break;
      case "submit": {
        const level = (await prisma.externalRequestAssignment.findUnique({ where: { id }, select: { level: true } }))?.level;
        if (!level) throw new HttpError(404, "Assignment not found");
        result = level === "COLLEGE" ? await submitCollege(user.id, id, await parseBody(SubmitCollegeInput, request)) : await submitDepartment(user.id, id, await parseBody(SubmitDepartmentInput, request));
        break;
      }
      case "review":
        result = await reviewAssignment(user.id, id, await parseBody(ReviewAssignmentInput, request));
        break;
      case "decline":
        result = await declineAssignment(user.id, id, await parseBody(DeclineAssignmentInput, request));
        break;
      default:
        throw new HttpError(404, "Not found");
    }
    return NextResponse.json<ExternalRequestDto>(result, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
