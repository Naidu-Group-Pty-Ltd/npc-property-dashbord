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
import { useBrand } from '@/branding/BrandProvider';
import AgreementTemplateResources from '@/components/agreement-templates/AgreementTemplateResources';
import { WORKFLOW_RETIRED_NOTICE, type AgreementTemplateKey } from '@/lib/agreements';
import {
  downloadAgreementTemplateDocx,
  templateBrand,
} from '@/lib/agreements/templateDownloads';

export default function AgreementTemplates() {
  const { settings: brandSettings } = useBrand();

  useEffect(() => {
    document.title = 'Agreement Templates | Command Centre';
  }, []);

  const handleDocx = async (key: AgreementTemplateKey) => {
    const brand = await templateBrand({
      brandColour: brandSettings?.brandColor ?? brandSettings?.primaryColor ?? null,
      logoSource: brandSettings?.reportLogo ?? brandSettings?.sidebarLogo ?? null,
    });
    await downloadAgreementTemplateDocx(key, brand);
  };

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-foreground">
          <FileSignature className="h-6 w-6 text-primary" />
          Agreement Templates
        </h1>
        <p className="text-sm text-muted-foreground">{WORKFLOW_RETIRED_NOTICE}</p>
      </header>

      <AgreementTemplateResources onDownloadDocx={handleDocx} />
    </div>
  );
}
