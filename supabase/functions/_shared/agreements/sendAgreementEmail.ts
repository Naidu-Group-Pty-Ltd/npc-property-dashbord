/**
 * Email an issued agreement to the partner — the thing issuing never did.
 *
 * ## What was missing
 *
 * `issue_to_partner` wrote one in-app notification and stopped. That is a fine
 * signal for a partner already working in the portal and no signal at all for
 * anybody else: a broker who has just been added, has not logged in, and is not
 * expecting anything, receives *nothing*. The Command Centre said "issued", the
 * agreement sat in Partner Review, and the only way the partner would find out
 * was if somebody rang them.
 *
 * ## Why the PDF is attached rather than linked
 *
 * A link into the portal is useless to a partner who has not activated yet, and
 * a signed storage URL expires in five minutes — long enough for a click, not
 * for an email that gets read tomorrow. The attachment is the document itself,
 * which is also what a broker's compliance team actually files. The portal link
 * still travels with it for review, change requests and execution, which are
 * the things the attachment cannot do.
 *
 * The bytes come from `resolveVersionArtefact`, so an email sent today carries
 * the current-revision render of the frozen version — the same document the
 * Issued PDF download hands over, never a re-render of the live row.
 */

import { getBrandConfig } from '../brand-config.ts';
import { meteredFetch } from '../meteredFetch.ts';

export interface AgreementEmailInput {
  to: string[];
  /** The template's own title. */
  title: string;
  partnerName: string | null;
  issuerName: string;
  versionLabel: string;
  /** Deep link into the partner's copy. */
  portalUrl: string;
  /** Optional note from the sender, shown above the fold. */
  note?: string | null;
  /** The rendered agreement. Omitted when the render was unavailable. */
  pdf?: { fileName: string; base64: string } | null;
  /** True when this is not the first send. */
  isResend?: boolean;
  /** True when the partner cannot sign in yet, which changes the ask. */
  awaitingActivation?: boolean;
}

export interface AgreementEmailResult {
  sent: boolean;
  error: string | null;
  messageId: string | null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export async function sendAgreementEmail(
  input: AgreementEmailInput,
): Promise<AgreementEmailResult> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) {
    return { sent: false, error: 'RESEND_API_KEY not configured', messageId: null };
  }
  if (input.to.length === 0) {
    return { sent: false, error: 'no recipients', messageId: null };
  }

  const brand = await getBrandConfig();
  const title = escapeHtml(input.title);
  const partner = escapeHtml(input.partnerName || 'your organisation');
  const issuer = escapeHtml(input.issuerName || brand.companyName);
  const version = escapeHtml(input.versionLabel);

  const subject = input.isResend
    ? `${input.title} — version ${input.versionLabel} (resent)`
    : `${input.title} for your review — ${input.issuerName || brand.companyName}`;

  // What the partner is being asked to do depends on whether they can get in.
  // Telling somebody with no login to "review it in the portal" is the single
  // most annoying thing this email could do.
  const action = input.awaitingActivation
    ? `<p style="margin:0 0 16px;color:#475569;font-size:15px;line-height:1.6;">
         The agreement is attached, and a copy is already waiting in your Finance Partner Portal.
         You will be able to review, request changes and execute it electronically as soon as your
         portal account is activated — we will send your invitation separately if you have not had
         one yet.
       </p>`
    : `<p style="margin:0 0 16px;color:#475569;font-size:15px;line-height:1.6;">
         Please review the agreement in your Finance Partner Portal, where you can request changes
         or execute it electronically. A copy is attached for your records.
       </p>`;

  const noteBlock = input.note
    ? `<div style="background:#F8F5EC;border-left:3px solid #BF9B50;padding:14px 18px;margin:0 0 24px;">
         <p style="margin:0;color:#0D264D;font-size:14px;line-height:1.6;white-space:pre-wrap;">${escapeHtml(input.note)}</p>
       </div>`
    : '';

  const htmlBody = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(subject)}</title></head>
  <body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f5f7;padding:32px 12px;">
      <tr><td align="center">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.06);">
          <tr><td style="background:#0D264D;padding:28px 32px;text-align:center;">
            <div style="font-family:Georgia,'Times New Roman',serif;color:#BF9B50;font-size:13px;letter-spacing:4px;text-transform:uppercase;font-weight:600;">${escapeHtml(brand.companyName)}</div>
            <div style="margin-top:6px;color:#ffffff;font-size:20px;font-weight:600;letter-spacing:0.3px;">${title}</div>
          </td></tr>
          <tr><td style="padding:32px;">
            <p style="margin:0 0 18px;color:#0D264D;font-size:16px;line-height:1.6;">Hi ${partner},</p>
            <p style="margin:0 0 16px;color:#475569;font-size:15px;line-height:1.6;">
              ${issuer} has ${input.isResend ? 'resent' : 'issued'} the <strong>${title}</strong>
              (version ${version}) to ${partner}.
            </p>
            ${noteBlock}
            ${action}
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:26px auto 20px;">
              <tr><td align="center" bgcolor="#0D264D" style="border-radius:8px;">
                <a href="${escapeHtml(input.portalUrl)}" style="display:inline-block;padding:14px 34px;font-family:Arial,sans-serif;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">Open in the Finance Portal</a>
              </td></tr>
            </table>
            <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.5;text-align:center;">
              Or paste this link into your browser:<br/>
              <span style="color:#475569;word-break:break-all;">${escapeHtml(input.portalUrl)}</span>
            </p>
          </td></tr>
          <tr><td style="padding:18px 32px 28px;border-top:1px solid #eef0f3;">
            <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.5;text-align:center;">
              This agreement is confidential and intended for ${partner}.<br/>
              ${escapeHtml(brand.companyName)}
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  const textBody = [
    `Hi ${input.partnerName || 'there'},`,
    '',
    `${input.issuerName || brand.companyName} has ${input.isResend ? 'resent' : 'issued'} the `
      + `${input.title} (version ${input.versionLabel}).`,
    input.note ? `\n${input.note}\n` : '',
    input.awaitingActivation
      ? 'The agreement is attached and a copy is waiting in your Finance Partner Portal. You will be '
        + 'able to review and execute it as soon as your portal account is activated.'
      : 'Please review it in your Finance Partner Portal, where you can request changes or execute '
        + 'it electronically. A copy is attached for your records.',
    '',
    input.portalUrl,
    '',
    `— ${brand.companyName}`,
  ].filter(Boolean).join('\n');

  try {
    const response = await meteredFetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from: brand.fromHeaderNotifications || brand.fromHeaderAdmin,
        to: input.to,
        subject,
        html: htmlBody,
        text: textBody,
        ...(input.pdf
          ? { attachments: [{ filename: input.pdf.fileName, content: input.pdf.base64 }] }
          : {}),
        tags: [
          { name: 'category', value: 'partner_agreement' },
          { name: 'mode', value: input.isResend ? 'resend' : 'issue' },
        ],
      }),
    });
    const raw = await response.text();
    if (!response.ok) {
      return { sent: false, error: `Resend ${response.status}: ${raw}`, messageId: null };
    }
    let messageId: string | null = null;
    try { messageId = JSON.parse(raw)?.id ?? null; } catch { messageId = null; }
    return { sent: true, error: null, messageId };
  } catch (error) {
    return {
      sent: false,
      error: error instanceof Error ? error.message : String(error),
      messageId: null,
    };
  }
}
