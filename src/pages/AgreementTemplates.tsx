/**
 * Command Centre — Agreement Templates.
 *
 * This route (`/partner-agreements`) used to be the Agreement Centre register:
 * a lifecycle workspace where staff drafted an agreement, ran it through
 * internal review, issued it into a partner's portal, answered their change
 * requests and counter-signed it.
 *
 * That workflow has been retired. The route is KEPT rather than removed so the
 * bookmarks and in-app links that point here land on an explanation and the
 * thing people actually still need, instead of a 404 that reads as a fault.
 *
 * What is left is a download desk. See `templateResource.pure.ts`.
 */
import { useEffect } from 'react';
import { FileSignature } from 'lucide-react';
import AgreementTemplateResources from '@/components/agreement-templates/AgreementTemplateResources';

import { downloadAgreementTemplateDocx } from '@/lib/agreements/templateDownloads';

export default function AgreementTemplates() {
  useEffect(() => {
    document.title = 'Agreement Templates | Command Centre';
  }, []);

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-foreground">
          <FileSignature className="h-6 w-6 text-primary" />
          Agreement Templates
        </h1>
        
      </header>

      {/* No brand is applied. The supplied cover is built around a
          `<<COMPANY NAME>>` placeholder, and both portals hand over the same
          bytes — see `templateDownloads.ts`. */}
      <AgreementTemplateResources onDownloadDocx={downloadAgreementTemplateDocx} />
    </div>
  );
}
