/**
 * Issued versions, newest first — the frozen record. Each entry shows what
 * changed against the version before it ("Updated in Version 1.1"), which is
 * UI metadata from the version row's diff, never a rewording of the document.
 */
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import type { AgreementIssuedVersion } from '@/hooks/useAgreementCentre';

const VERSION_BADGES: Record<AgreementIssuedVersion['status'], string> = {
  issued: 'bg-primary/15 text-primary border-primary/30',
  superseded: 'bg-muted text-muted-foreground border-border',
  executed: 'bg-success/15 text-success border-success/30',
  withdrawn: 'bg-muted text-muted-foreground border-border',
};

function formatValue(value: unknown): string {
  const text = String(value ?? '').trim();
  return text === '' ? '—' : text;
}

export default function VersionHistory({ versions }: { versions: AgreementIssuedVersion[] }) {
  if (!versions.length) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Not issued yet — versions are frozen at issue.</p>;
  }
  return (
    <div className="space-y-4">
      {versions.map((version) => (
        <div key={version.id} className="rounded-lg border border-border bg-card/50 p-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-serif text-base font-semibold text-foreground">Version {version.version_label}</span>
            <Badge variant="outline" className={VERSION_BADGES[version.status]}>
              {version.status === 'issued' ? 'Current' : version.status.charAt(0).toUpperCase() + version.status.slice(1)}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Issued {format(new Date(version.issued_at), 'd MMM yyyy · h:mm a')}
            {version.issued_by_label ? ` by ${version.issued_by_label}` : ''}
            {version.executed_at ? ` · executed ${format(new Date(version.executed_at), 'd MMM yyyy')}` : ''}
          </p>
          {version.changed_fields?.length ? (
            <div className="mt-2.5 space-y-1.5 border-t border-border/60 pt-2.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Updated in Version {version.version_label}
              </div>
              {version.changed_fields.map((change) => (
                <div key={change.field} className="text-xs">
                  <span className="font-medium text-foreground">{change.label}</span>
                  <span className="text-muted-foreground"> — previous: </span>
                  <span className="text-muted-foreground line-through">{formatValue(change.previous)}</span>
                  <span className="text-muted-foreground"> · updated: </span>
                  <span className="font-medium text-foreground">{formatValue(change.updated)}</span>
                </div>
              ))}
            </div>
          ) : null}
          <div className="mt-2 font-mono text-[10px] text-muted-foreground/70">
            Content fingerprint {version.template_content_hash}
          </div>
        </div>
      ))}
    </div>
  );
}
