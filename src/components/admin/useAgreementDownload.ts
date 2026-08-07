import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { invokeSecureFunction } from '@/lib/secureInvoke';

/**
 * Download a partner's executed agreement from wherever the Command Centre is
 * already looking at that partner.
 *
 * The dedicated Agreements section lists every executed agreement, which is the
 * right place to audit them — but it is the wrong place to be when a partner
 * rings up and asks for their copy. At that moment a staff user is looking at
 * the partner's row, and the answer should be one menu item away rather than a
 * tab away and a search away.
 *
 * So this asks by PORTAL USER, not by acceptance: a row knows who it is, not
 * which of that person's acceptances is current. The server resolves the most
 * recent acceptance for that user, generates the copy if it has not been
 * generated yet, and returns a short-lived signed URL.
 *
 * A partner who has not accepted anything has no copy, and the caller is told
 * that plainly rather than being handed an empty PDF.
 */
export function useAgreementDownload() {
  const [downloadingUserId, setDownloadingUserId] = useState<string | null>(null);

  const downloadForUser = useCallback(async (
    portal: 'solicitor' | 'builder' | 'finance',
    portalUserId: string,
    partnerLabel?: string,
  ) => {
    setDownloadingUserId(portalUserId);
    try {
      const { data, error } = await invokeSecureFunction('partner-agreement-records', {
        operation: 'download_record',
        portal,
        portal_user_id: portalUserId,
      });

      if ((data as any)?.code === 'NO_AGREEMENT_ON_RECORD') {
        toast.info(
          partnerLabel
            ? `${partnerLabel} has not accepted the agreement yet, so there is no copy to supply.`
            : 'This partner has not accepted the agreement yet, so there is no copy to supply.',
        );
        return;
      }
      if (error || !data?.success || !data?.url) {
        throw new Error((data as any)?.error || error?.message || 'The copy could not be produced');
      }

      // A popup opened after an await is no longer inside the user's gesture, so
      // `window.open` is silently swallowed by the blocker and the toast lies.
      // Fetch the bytes and hand them to an anchor instead, which always lands.
      const signedUrl = data.url as string;
      const suggestedName = (data as any)?.file_name
        || decodeURIComponent(signedUrl.split('download=')[1]?.split('&')[0] || '')
        || 'executed-agreement.pdf';

      let objectUrl: string | null = null;
      try {
        const res = await fetch(signedUrl, { credentials: 'omit' });
        if (!res.ok) throw new Error(`The stored copy could not be read (${res.status})`);
        objectUrl = URL.createObjectURL(await res.blob());
      } catch {
        objectUrl = null;
      }

      const anchor = document.createElement('a');
      anchor.href = objectUrl || signedUrl;
      anchor.download = suggestedName;
      anchor.rel = 'noopener noreferrer';
      if (!objectUrl) anchor.target = '_blank';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl as string), 60_000);

      toast.success('The executed agreement is downloading.');

    } catch (e: any) {
      toast.error(e?.message || 'The copy could not be produced');
    } finally {
      setDownloadingUserId(null);
    }
  }, []);

  return { downloadForUser, downloadingUserId };
}
