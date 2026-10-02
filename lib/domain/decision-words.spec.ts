import { describe, expect, it } from "vitest";
import { nextAfterCurrent, purchaseWords, sendBackWords, transferWords, type StepLike } from "./decision-words";

const step = (over: Partial<StepLike>): StepLike => ({ status: "WAITING", selector: "OWNER_HEAD", label: "Head: CSE", approverName: "Kebede", receipt: false, ...over });

describe("decision words", () => {
  it("names the next person, skipping skipped steps", () => {
    const steps = [step({ status: "PENDING" }), step({ status: "SKIPPED", approverName: "Twice" }), step({ label: "Dean: CoEEC", approverName: "Hana" })];
    expect(nextAfterCurrent(steps)?.approverName).toBe("Hana");
    expect(purchaseWords(steps).approve).toBe("Approve and send to Hana");
    expect(purchaseWords(steps).approveMeans).toContain("Hana (Dean: CoEEC)");
  });

  it("says a vacant next post is vacant", () => {
    const words = transferWords([step({ status: "PENDING" }), step({ label: "Property Administration", approverName: null, selector: "NODE_OCCUPANT" })]);
    expect(words.approveMeans).toContain("Property Administration (vacant)");
  });

  it("the last purchase step starts the purchase", () => {
    expect(purchaseWords([step({ status: "APPROVED" }), step({ status: "PENDING" })]).approve).toBe("Approve: start the purchase");
  });

  it("a transfer's receipt and acceptance read as what they are", () => {
    expect(transferWords([step({ status: "APPROVED" }), step({ status: "PENDING", receipt: true, selector: "REQUESTER_RECEIPT" })]).approve).toBe("Confirm I received it");
    expect(transferWords([step({ status: "PENDING", selector: "TARGET_CUSTODIAN" })]).approve).toBe("Accept into my care");
    expect(transferWords([step({ status: "PENDING" }), step({ receipt: true, selector: "REQUESTER_RECEIPT", approverName: "Ali" })]).approve).toBe("Approve, then Ali confirms receipt");
  });

  it("sending back names who revises", () => {
    expect(sendBackWords("Kebede").label).toBe("Return to Kebede to revise");
  });
});
