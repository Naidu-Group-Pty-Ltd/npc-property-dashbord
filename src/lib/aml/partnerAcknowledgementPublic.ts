/**
 * The DIRECT partner acknowledgement — public client.
 *
 * Deliberately NOT `invokeAmlFunction`: that wrapper is for staff calls and
 * attaches step-up credentials. This surface has no session at all. The
 * token in the link is the whole credential, matched by hash server-side,
 * and every rule — expiry, terminal state, the mandatory acknowledgements —
 * is enforced by `aml-reliance`, never here.
 */
import { invokeSecureFunction } from "@/lib/secureInvoke";

export interface PublicAcknowledgementView {
  status: "sent" | "viewed" | "accepted" | "declined" | "expired" | "superseded";
  organisation_name: string | null;
  recipient_name: string;
  recipient_email: string;
  expires_at: string;
  accepted_at: string | null;
  declined_at: string | null;
  issuer_name: string;
  /** The instrument itself, exactly as published. */
  terms: { version: string; title: string; content_markdown: string } | null;
  /** The mandatory acknowledgements, in the agreement's own order. */
  acknowledgements: ReadonlyArray<{ key: string; heading: string; statement: string }>;
}

async function call<T>(payload: Record<string, unknown>): Promise<T> {
  const { data, error } = await invokeSecureFunction<T>("aml-reliance", payload);
  if (error) throw new Error(error.message);
  if ((data as any)?.error) throw new Error(String((data as any).error));
  return data as T;
}

export const partnerAcknowledgementPublicApi = {
  view: (ack_token: string) =>
    call<{ acknowledgement: PublicAcknowledgementView }>({ op: "ack_view", ack_token }),
  accept: (ack_token: string, params: { accepted_by_name: string; acknowledgements: string[] }) =>
    call<{ acknowledgement: PublicAcknowledgementView }>({ op: "ack_accept", ack_token, ...params }),
  decline: (ack_token: string, reason?: string) =>
    call<{ acknowledgement: PublicAcknowledgementView }>({ op: "ack_decline", ack_token, reason }),
};
