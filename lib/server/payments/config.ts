import "server-only";
import { PAYMENT_PROVIDERS, type PaymentProviderId, type ReceiverConfig } from "@/lib/domain/payment-receipt";

/**
 * Where the university gets paid, per provider, from env:
 *
 *   PAYMENT_PROVIDERS=CBE,TELEBIRR               which ones requesters may use
 *   PAYMENT_CBE_RECEIVER_ACCOUNT=1000123456789   the university's account / wallet number
 *   PAYMENT_CBE_RECEIVER_NAME="Adama Science…"   the holder's name as the bank prints it
 *
 * A provider is offered only when it is listed AND at least one receiver detail is set —
 * without one there is nothing to check a receipt against, and a receipt that paid
 * anyone at all would pass.
 */

export function receiverConfig(provider: PaymentProviderId): ReceiverConfig {
  const account = process.env[`PAYMENT_${provider}_RECEIVER_ACCOUNT`]?.trim() || null;
  const name = process.env[`PAYMENT_${provider}_RECEIVER_NAME`]?.trim() || null;
  return { account, name };
}

export function enabledProviders(): PaymentProviderId[] {
  const listed = (process.env.PAYMENT_PROVIDERS ?? "")
    .split(",")
    .map((p) => p.trim().toUpperCase())
    .filter((p): p is PaymentProviderId => (PAYMENT_PROVIDERS as readonly string[]).includes(p));
  return [...new Set(listed)].filter((p) => {
    const c = receiverConfig(p);
    return Boolean(c.account || c.name);
  });
}
