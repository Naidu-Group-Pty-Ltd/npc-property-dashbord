import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { verifyAuth, createCorsHeaders as createAuthCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { logApiUsage } from '../_shared/logApiUsage.ts';
import { getBrandConfig } from '../_shared/brand-config.ts';
import { internalError } from '../_shared/errorResponse.ts';

const clientId = Deno.env.get('MICROSOFT_CLIENT_ID');
const clientSecret = Deno.env.get('MICROSOFT_CLIENT_SECRET');
const tenantId = Deno.env.get('MICROSOFT_TENANT_ID');
const mailboxEmail = Deno.env.get('MICROSOFT_MAILBOX_EMAIL');

interface SecondaryRecipient {
  financeContactId: string;
  name: string;
  email: string;
}

interface NotificationRequest {
  appointmentGhlId: string;
  appointmentTitle: string;
  appointmentStart: string; // ISO string
  appointmentEnd: string;   // ISO string
  appointmentType: string;
  appointmentNotes?: string;
  calendarName?: string;
  recipients: SecondaryRecipient[];
}

async function getAccessToken(): Promise<string> {
  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const params = new URLSearchParams({
    client_id: clientId!,
    client_secret: clientSecret!,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('[Appointment Notification] Token error:', error);
    throw new Error('Failed to get Microsoft access token');
  }

  const data = await response.json();
  return data.access_token;
}

/**
 * Generate a standard .ics calendar invite string
 */
function generateICS(params: {
  title: string;
  start: string;
  end: string;
  notes?: string;
  organizer: string;
  attendeeEmail: string;
  attendeeName: string;
  uid: string;
  brandName: string;
}): string {
  const formatICSDate = (iso: string): string => {
    const d = new Date(iso);
    return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  };

  const escapeICS = (text: string): string => {
    return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  };

  const now = formatICSDate(new Date().toISOString());
  const dtStart = formatICSDate(params.start);
  const dtEnd = formatICSDate(params.end);

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${params.brandName}//Command Centre//EN`,
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${params.uid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${escapeICS(params.title)}`,
    params.notes ? `DESCRIPTION:${escapeICS(params.notes)}` : '',
    `ORGANIZER;CN=${escapeICS(params.brandName)}:mailto:${params.organizer}`,
    `ATTENDEE;CN=${escapeICS(params.attendeeName)};RSVP=TRUE:mailto:${params.attendeeEmail}`,
    'STATUS:CONFIRMED',
    'SEQUENCE:0',
    'BEGIN:VALARM',
    'TRIGGER:-PT15M',
    'ACTION:DISPLAY',
    'DESCRIPTION:Reminder',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
}

/**
 * Build a professional HTML email body for the appointment notification
 */
function buildEmailBody(params: {
  recipientName: string;
  title: string;
  start: string;
  end: string;
  type: string;
  notes?: string;
  calendarName?: string;
  brandName: string;
}): string {
  const startDate = new Date(params.start);
  const endDate = new Date(params.end);
  
  const dateStr = startDate.toLocaleDateString('en-AU', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    timeZone: 'Australia/Sydney'
  });
  const startTimeStr = startDate.toLocaleTimeString('en-AU', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Australia/Sydney'
  });
  const endTimeStr = endDate.toLocaleTimeString('en-AU', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Australia/Sydney'
  });

  const typeLabels: Record<string, string> = {
    'call': '📞 Phone Call',
    'zoom': '💻 Zoom Meeting',
    'in-person': '🤝 In-Person Meeting',
  };
  const typeLabel = typeLabels[params.type] || params.type;

  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #1a1a2e; color: #d4a843; padding: 20px; border-radius: 8px 8px 0 0;">
        <h2 style="margin: 0; font-size: 20px;">📅 Meeting Invitation</h2>
        <p style="margin: 5px 0 0; opacity: 0.9; font-size: 14px;">${params.brandName} — Command Centre</p>
      </div>
      <div style="background: #ffffff; padding: 24px; border: 1px solid #e0e0e0; border-top: none;">
        <p style="color: #333; font-size: 15px;">Hi ${params.recipientName},</p>
        <p style="color: #555; font-size: 14px;">You have been added as a participant to the following appointment:</p>
        
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr>
            <td style="padding: 10px 12px; background: #f8f9fa; border: 1px solid #e0e0e0; font-weight: bold; color: #333; width: 130px;">Title</td>
            <td style="padding: 10px 12px; border: 1px solid #e0e0e0; color: #333;">${params.title}</td>
          </tr>
          <tr>
            <td style="padding: 10px 12px; background: #f8f9fa; border: 1px solid #e0e0e0; font-weight: bold; color: #333;">Date</td>
            <td style="padding: 10px 12px; border: 1px solid #e0e0e0; color: #333;">${dateStr}</td>
          </tr>
          <tr>
            <td style="padding: 10px 12px; background: #f8f9fa; border: 1px solid #e0e0e0; font-weight: bold; color: #333;">Time</td>
            <td style="padding: 10px 12px; border: 1px solid #e0e0e0; color: #333;">${startTimeStr} — ${endTimeStr} (AEST)</td>
          </tr>
          <tr>
            <td style="padding: 10px 12px; background: #f8f9fa; border: 1px solid #e0e0e0; font-weight: bold; color: #333;">Type</td>
            <td style="padding: 10px 12px; border: 1px solid #e0e0e0; color: #333;">${typeLabel}</td>
          </tr>
          ${params.calendarName ? `
          <tr>
            <td style="padding: 10px 12px; background: #f8f9fa; border: 1px solid #e0e0e0; font-weight: bold; color: #333;">Calendar</td>
            <td style="padding: 10px 12px; border: 1px solid #e0e0e0; color: #333;">${params.calendarName}</td>
          </tr>` : ''}
          ${params.notes ? `
          <tr>
            <td style="padding: 10px 12px; background: #f8f9fa; border: 1px solid #e0e0e0; font-weight: bold; color: #333;">Notes</td>
            <td style="padding: 10px 12px; border: 1px solid #e0e0e0; color: #333;">${params.notes}</td>
          </tr>` : ''}
        </table>

        <p style="color: #888; font-size: 12px; margin-top: 24px; border-top: 1px solid #eee; padding-top: 12px;">
          A calendar invite (.ics) is attached to this email. You can add it directly to your calendar application.
        </p>
      </div>
      <div style="background: #f4f4f4; padding: 12px 20px; border-radius: 0 0 8px 8px; border: 1px solid #e0e0e0; border-top: none;">
        <p style="color: #999; font-size: 11px; margin: 0; text-align: center;">
          This is an automated notification from ${params.brandName} Command Centre.
        </p>
      </div>
    </div>
  `;
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createAuthCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    if (!clientId || !clientSecret || !tenantId || !mailboxEmail) {
      throw new Error('Microsoft Graph API credentials not configured');
    }

    const body = await req.json();
    const {
      appointmentGhlId, appointmentTitle, appointmentStart, appointmentEnd,
      appointmentType, appointmentNotes, calendarName, recipients
    }: NotificationRequest = body;

    // Auth
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[Appointment Notification] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }

    if (!recipients || recipients.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'No recipients to notify' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Appointment Notification] Sending to ${recipients.length} recipients for: ${appointmentTitle}`);

    const brand = await getBrandConfig();
    const brandName = brand.companyName;
    // Derive a UID domain from the configured contact email (fallback to a stable placeholder)
    const uidDomain = (brand.contactEmail.split('@')[1] || 'command-centre.local').toLowerCase();

    const accessToken = await getAccessToken();
    const results: { email: string; success: boolean; error?: string }[] = [];

    for (const recipient of recipients) {
      try {
        // Generate unique .ics for this recipient
        const icsContent = generateICS({
          title: appointmentTitle,
          start: appointmentStart,
          end: appointmentEnd,
          notes: appointmentNotes,
          organizer: mailboxEmail!,
          attendeeEmail: recipient.email,
          attendeeName: recipient.name,
          uid: `${appointmentGhlId}-${recipient.financeContactId}@${uidDomain}`,
          brandName,
        });

        const icsBase64 = btoa(icsContent);

        const emailBody = buildEmailBody({
          recipientName: recipient.name.split(' ')[0],
          title: appointmentTitle,
          start: appointmentStart,
          end: appointmentEnd,
          type: appointmentType,
          notes: appointmentNotes,
          calendarName,
          brandName,
        });

        // Send via Microsoft Graph (always admin mailbox)
        const message = {
          message: {
            subject: `Meeting Invitation: ${appointmentTitle}`,
            body: { contentType: 'HTML', content: emailBody },
            toRecipients: [{ emailAddress: { address: recipient.email } }],
            attachments: [{
              '@odata.type': '#microsoft.graph.fileAttachment',
              name: 'invite.ics',
              contentType: 'text/calendar; method=REQUEST',
              contentBytes: icsBase64,
            }],
          },
          saveToSentItems: true,
        };

        const sendUrl = `https://graph.microsoft.com/v1.0/users/${mailboxEmail}/sendMail`;
        const sendResponse = await fetch(sendUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(message),
        });

        if (!sendResponse.ok) {
          const errorText = await sendResponse.text();
          throw new Error(`Graph API ${sendResponse.status}: ${errorText}`);
        }

        // Record success in DB
        await supabase
          .from('appointment_secondary_recipients')
          .insert({
            appointment_ghl_id: appointmentGhlId,
            finance_contact_id: recipient.financeContactId,
            contact_name: recipient.name,
            contact_email: recipient.email,
            notification_sent: true,
            notification_sent_at: new Date().toISOString(),
            appointment_title: appointmentTitle,
            appointment_start: appointmentStart,
            appointment_end: appointmentEnd,
            appointment_type: appointmentType,
            appointment_notes: appointmentNotes || null,
            calendar_name: calendarName || null,
          });

        results.push({ email: recipient.email, success: true });
        console.log(`[Appointment Notification] ✓ Sent to ${recipient.email}`);

      } catch (err: any) {
        console.error(`[Appointment Notification] ✗ Failed for ${recipient.email}:`, err.message);
        
        // Record failure in DB
        await supabase
          .from('appointment_secondary_recipients')
          .insert({
            appointment_ghl_id: appointmentGhlId,
            finance_contact_id: recipient.financeContactId,
            contact_name: recipient.name,
            contact_email: recipient.email,
            notification_sent: false,
            notification_error: err.message,
            appointment_title: appointmentTitle,
            appointment_start: appointmentStart,
            appointment_end: appointmentEnd,
            appointment_type: appointmentType,
            appointment_notes: appointmentNotes || null,
            calendar_name: calendarName || null,
          });

        results.push({ email: recipient.email, success: false, error: err.message });
      }
    }

    // Log API usage
    await logApiUsage(supabase, {
      service_name: 'microsoft-graph',
      endpoint: '/v1.0/users/sendMail',
      status: results.every(r => r.success) ? 'success' : 'error',
      model_used: 'graph-api',
      metadata: {
        function: 'send-appointment-notification',
        appointment_id: appointmentGhlId,
        recipients_total: recipients.length,
        recipients_success: results.filter(r => r.success).length,
        recipients_failed: results.filter(r => !r.success).length,
      },
    });

    const successCount = results.filter(r => r.success).length;
    return new Response(
      JSON.stringify({
        success: true,
        message: `Sent ${successCount}/${recipients.length} notifications`,
        results,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Appointment Notification] Error:', error);
    return new Response(
      JSON.stringify(internalError(error, 'send-appointment-notification')),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
