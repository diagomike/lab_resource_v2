import "server-only";
import { instantToCivil } from "@/lib/domain/civil-time";
import type { PaymentProviderId } from "@/lib/domain/payment-receipt";
import type { Receipt, VerifierDriver, VerifyResult } from "./driver";
import { receiverConfig } from "../config";

/**
 * `VERIFIER_DRIVER=fake` — for tests and local dev; never reaches a bank.
 *
 * Tests register exact receipts with `registerFakeReceipt`. By hand, a reference spells
 * its own receipt: `FAKE-18750` (or `FAKE-18750.50`) is a payment of that many birr to
 * the university's configured account, made just now; `FAKE-18750-WRONG` paid someone
 * else; `FAKE-DOWN` behaves as if the verifier were unreachable. Anything else has no
 * receipt.
 */

const registry = new Map<string, Receipt | { down: true }>();

const keyOf = (provider: PaymentProviderId, reference: string) => `${provider}:${reference.trim().toUpperCase()}`;

export function registerFakeReceipt(provider: PaymentProviderId, receipt: Partial<Receipt> & { reference: string }): void {
  registry.set(keyOf(provider, receipt.reference), { payerName: "Fake Payer", receiverName: null, receiverAccount: null, amount: 0, date: null, status: null, raw: { fake: true }, ...receipt });
}

export function registerFakeOutage(provider: PaymentProviderId, reference: string): void {
  registry.set(keyOf(provider, reference), { down: true });
}

export function clearFakeReceipts(): void {
  registry.clear();
}

export const fakeVerifierDriver: VerifierDriver = {
  async verify(query): Promise<VerifyResult> {
    const known = registry.get(keyOf(query.provider, query.reference));
    if (known && "down" in known) return { ok: false, reason: "The payment verifier could not be reached.", unavailable: true };
    if (known) return { ok: true, receipt: known };

    const reference = query.reference.trim().toUpperCase();
    if (reference === "FAKE-DOWN") return { ok: false, reason: "The payment verifier could not be reached.", unavailable: true };
    const spelled = reference.match(/^FAKE-(\d+(?:\.\d{1,2})?)(-WRONG)?$/);
    if (!spelled) return { ok: false, reason: "The bank has no receipt matching these details.", unavailable: false };

    const config = receiverConfig(query.provider);
    const now = instantToCivil(new Date());
    const receipt: Receipt = {
      reference,
      payerName: "Fake Payer",
      receiverName: spelled[2] ? "Someone Else PLC" : config.name,
      receiverAccount: spelled[2] ? "9****0001" : config.account ? `${config.account.slice(0, 1)}****${config.account.slice(-4)}` : null,
      amount: `${spelled[1]} ETB`,
      date: `${now.date} ${now.time}:00`,
      status: "Completed",
      raw: { fake: true, reference },
    };
    return { ok: true, receipt };
  },
};
