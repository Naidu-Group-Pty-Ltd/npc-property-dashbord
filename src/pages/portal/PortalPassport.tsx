import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight, Loader2, ShieldCheck } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { amlPortalApi } from '@/lib/aml/amlPortalApi';
import type { PassportView } from '@/lib/aml/passport';
import { StampSeal } from '@/components/aml/passport/StampSeal';
import {
  formatPassportCurrency,
  formatPassportDate,
  formatPassportDateTime,
} from '@/components/aml/passport/format';
import { classifyPassportLoadFailure } from '@/components/aml/passport/loadState';

/**
 * The client's Compliance Passport — the premium booklet expression of the
 * SAME server projection the working views consume.
 *
 * Everything on these pages arrived from `get_passport` (the dedicated
 * client-sanitised projection): this component adds no data, derives no
 * state and holds no milestone flags of its own. The booklet is a deliberate
 * single-look print world (navy cover, cream paper) painted entirely from
 * the scoped passport tokens — a passport's paper stays paper in dark mode.
 *
 * While `aml_passport_client_view` is off the server answers 404
 * `passport_disabled` and this page shows only a quiet return path — the
 * portal behaves as though the page does not exist.
 */

type LoadState =
  | { kind: 'loading' }
  | { kind: 'disabled' }
  | { kind: 'none' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; view: PassportView };

type BookletPage = { id: string; title: string; kicker: string };

export default function PortalPassport() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [pageIdx, setPageIdx] = useState(0);

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const { passport } = await amlPortalApi.getPassport();
      setState(passport ? { kind: 'ready', view: passport } : { kind: 'none' });
    } catch (e: unknown) {
      const failure = classifyPassportLoadFailure(e);
      setState(failure.kind === 'disabled' ? { kind: 'disabled' } : { kind: 'error', message: failure.message });
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const view = state.kind === 'ready' ? state.view : null;

  const pages = useMemo<BookletPage[]>(() => {
    if (!view) return [];
    const list: BookletPage[] = [
      { id: 'cover', title: 'Cover', kicker: 'AML/CTF Compliance Passport' },
      { id: 'identity', title: 'Identity', kicker: 'Page I' },
      { id: 'verification', title: 'Verification', kicker: 'Page II' },
      { id: 'documents', title: 'Documents', kicker: 'Page III' },
    ];
    if (view.transactions.length > 0) list.push({ id: 'transactions', title: 'Transaction', kicker: 'Page IV' });
    list.push({ id: 'stamps', title: 'Stamps', kicker: 'Stamp register' });
    if (view.versions.length > 0) list.push({ id: 'versions', title: 'Versions', kicker: 'Version register' });
    list.push({ id: 'history', title: 'Record', kicker: 'Journey record' });
    return list;
  }, [view]);

  useEffect(() => {
    if (!view) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setPageIdx((i) => Math.min(i + 1, pages.length - 1));
      if (e.key === 'ArrowLeft') setPageIdx((i) => Math.max(i - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, pages.length]);

  if (state.kind === 'loading') {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Opening your Compliance Passport…
      </div>
    );
  }

  if (state.kind === 'disabled' || state.kind === 'none') {
    return (
      <div className="mx-auto max-w-lg py-10">
        <Card>
          <CardContent className="space-y-3 py-6 text-center">
            <ShieldCheck className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              {state.kind === 'none'
                ? 'Your Compliance Passport will appear here once your adviser opens your identity and compliance case.'
                : 'Your Compliance Passport is not available yet.'}
            </p>
            <Button asChild variant="outline" size="sm">
              <Link to="/client/aml"><ArrowLeft className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Back to Identity &amp; Compliance</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="mx-auto max-w-lg py-10">
        <Alert variant="destructive">
          <AlertTitle>Your Passport could not be opened</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>Please try again shortly.</span>
            <Button size="sm" variant="outline" onClick={() => void load()}>Retry</Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const v = view!;
  const page = pages[Math.min(pageIdx, pages.length - 1)];

  return (
    <div className="passport-scope mx-auto max-w-3xl space-y-4 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link to="/client/aml"><ArrowLeft className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Identity &amp; Compliance</Link>
        </Button>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono">{v.header.credential ?? 'In progress'}</span>
          <Badge variant="outline">{v.header.state.label}</Badge>
        </div>
      </div>

      {/* ── page chips ─────────────────────────────────────────────────── */}
      <nav aria-label="Passport pages" className="flex flex-wrap gap-1.5">
        {pages.map((p, i) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPageIdx(i)}
            aria-current={i === pageIdx ? 'page' : undefined}
            className={
              i === pageIdx
                ? 'rounded-full border border-primary/50 bg-primary/10 px-3 py-1 text-xs font-medium'
                : 'rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-muted'
            }
          >
            {p.title}
          </button>
        ))}
      </nav>

      {/* ── the open page ──────────────────────────────────────────────── */}
      {page.id === 'cover' ? (
        <CoverPage v={v} />
      ) : (
        <section
          aria-label={page.title}
          className="passport-page relative min-h-[420px] rounded-xl p-6 sm:p-8"
        >
          <header className="mb-4 text-center">
            <div className="passport-page__kicker text-[10px]">{page.kicker}</div>
            <h2 className="mt-1 font-serif text-xl font-semibold uppercase tracking-widest">{page.title}</h2>
            <div className="passport-cover__rule mx-auto mt-2 w-24" />
          </header>

          {page.id === 'identity' && <IdentityPage v={v} />}
          {page.id === 'verification' && <VerificationPage v={v} />}
          {page.id === 'documents' && <DocumentsPage v={v} />}
          {page.id === 'transactions' && <TransactionsPage v={v} />}
          {page.id === 'stamps' && <StampsPage v={v} />}
          {page.id === 'versions' && <VersionsPage v={v} />}
          {page.id === 'history' && <HistoryPage v={v} />}
        </section>
      )}

      {/* ── pagination ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-center gap-4">
        <Button
          variant="outline" size="sm" disabled={pageIdx === 0}
          onClick={() => setPageIdx((i) => Math.max(i - 1, 0))}
        >
          <ChevronLeft className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Previous
        </Button>
        <span className="min-w-24 text-center text-xs text-muted-foreground">
          {page.title} · {pageIdx + 1} of {pages.length}
        </span>
        <Button
          variant="outline" size="sm" disabled={pageIdx >= pages.length - 1}
          onClick={() => setPageIdx((i) => Math.min(i + 1, pages.length - 1))}
        >
          Next <ChevronRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

/* ── pages ─────────────────────────────────────────────────────────────── */

function CoverPage({ v }: { v: PassportView }) {
  return (
    <section aria-label="Passport cover" className="passport-cover relative rounded-xl px-6 py-10 text-center sm:px-10 sm:py-14">
      <span aria-hidden="true" className="passport-cover__frame rounded-xl" />
      <ShieldCheck className="mx-auto h-10 w-10" aria-hidden="true" />
      <div className="mt-4 font-serif text-2xl font-semibold uppercase tracking-[0.18em]">{v.header.issuer_org}</div>
      <div className="passport-cover__rule mx-auto my-4 w-32" />
      <div className="font-serif text-sm uppercase tracking-[0.3em]">AML/CTF Compliance Passport</div>

      <dl className="mx-auto mt-8 grid max-w-md grid-cols-1 gap-x-8 gap-y-3 text-left sm:grid-cols-2">
        <CoverFact k="Holder" v={v.header.subject ?? '—'} />
        <CoverFact k="Credential" v={v.header.credential ?? 'Not yet issued'} mono />
        <CoverFact k="Status" v={v.header.state.label} />
        <CoverFact k="Version" v={v.header.current_version_label ?? '—'} mono />
        <CoverFact k="First issued" v={v.header.first_issued_at ? formatPassportDate(v.header.first_issued_at) : 'Pending'} />
        <CoverFact k="Issued by" v={v.header.issuer_org} />
      </dl>

      {v.header.evidence_fingerprint_short ? (
        <div className="mx-auto mt-8 max-w-md rounded-md border border-current/20 px-4 py-2 font-mono text-[11px] tracking-wider opacity-90">
          {v.header.evidence_fingerprint_short} · SHA-256 EVIDENCE FINGERPRINT
        </div>
      ) : null}
    </section>
  );
}

function CoverFact({ k, v, mono = false }: { k: string; v: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[9px] font-bold uppercase tracking-[0.18em] opacity-70">{k}</dt>
      <dd className={mono ? 'mt-0.5 font-mono text-xs' : 'mt-0.5 text-sm'}>{v}</dd>
    </div>
  );
}

function PageRow({ k, v: value }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="passport-page__muted text-xs">{k}</span>
      <span className="text-right text-sm">{value}</span>
    </div>
  );
}

function EmptyPage({ text }: { text: string }) {
  return <p className="passport-page__muted py-6 text-center text-sm">{text}</p>;
}

function IdentityPage({ v }: { v: PassportView }) {
  if (v.identity.fields.length === 0) {
    return <EmptyPage text="Your identity page is added as you complete the Identity & Compliance steps." />;
  }
  return (
    <dl className="grid grid-cols-1 gap-x-10 gap-y-3 sm:grid-cols-2">
      {v.identity.fields.map((f) => (
        <div key={f.key} className="border-b border-current/10 pb-2">
          <dt className="text-[9px] font-bold uppercase tracking-[0.18em] opacity-60">{f.label}</dt>
          <dd className="mt-0.5 text-sm">{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function VerificationPage({ v }: { v: PassportView }) {
  if (v.verification.parties.length === 0) {
    return <EmptyPage text="Your verification result appears here once identity verification is complete." />;
  }
  return (
    <div className="space-y-5">
      {v.verification.parties.map((p) => (
        <div key={p.party}>
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-semibold">{p.party}</h3>
            <span className={p.verified ? 'text-xs font-bold uppercase tracking-wider' : 'passport-page__muted text-xs uppercase tracking-wider'}>
              {p.verified ? 'Verified' : 'In progress'}
            </span>
          </div>
          <div className="passport-page__rule my-2" />
          {p.components.map((c, i) => (
            <PageRow
              key={i}
              k={c.check_type.replaceAll('_', ' ')}
              v={`${c.status.replaceAll('_', ' ')}${c.completed_at ? ` · ${formatPassportDate(c.completed_at)}` : ''}`}
            />
          ))}
        </div>
      ))}
      <p className="passport-page__muted text-center text-[11px]">
        Verification detail beyond this page is held by your adviser's compliance team.
      </p>
    </div>
  );
}

function DocumentsPage({ v }: { v: PassportView }) {
  if (v.documents.length === 0) {
    return <EmptyPage text="Documents you provide are recorded here." />;
  }
  return (
    <div>
      {v.documents.map((d) => (
        <PageRow
          key={d.id}
          k={d.label + (d.version_number && d.version_number > 1 ? ` (v${d.version_number})` : '')}
          v={`${presentDocStatus(d.status)}${d.uploaded_at ? ` · ${formatPassportDate(d.uploaded_at)}` : ''}`}
        />
      ))}
      <p className="passport-page__muted mt-4 text-center text-[11px]">
        Files are opened securely from the Identity &amp; Compliance page — this register lists what is held.
      </p>
    </div>
  );
}

function presentDocStatus(status: string): string {
  const map: Record<string, string> = {
    uploaded: 'Received', accepted: 'Accepted', rejected: 'Needs attention', superseded: 'Replaced',
  };
  return map[status] ?? status.replaceAll('_', ' ');
}

function TransactionsPage({ v }: { v: PassportView }) {
  return (
    <div className="space-y-5">
      {v.transactions.map((t) => (
        <div key={t.id}>
          <h3 className="text-sm font-semibold">{t.property_address ?? 'Property transaction'}</h3>
          <div className="passport-page__rule my-2" />
          {t.kind ? <PageRow k="Type" v={t.kind} /> : null}
          {t.status ? <PageRow k="Status" v={t.status.replaceAll('_', ' ')} /> : null}
          {t.contract_date ? <PageRow k="Contract date" v={formatPassportDate(t.contract_date)} /> : null}
          {t.settlement_date ? <PageRow k="Settlement" v={formatPassportDate(t.settlement_date)} /> : null}
          {typeof t.purchase_price === 'number' ? <PageRow k="Purchase price" v={formatPassportCurrency(t.purchase_price)} /> : null}
        </div>
      ))}
    </div>
  );
}

function StampsPage({ v }: { v: PassportView }) {
  if (v.stamps.length === 0) {
    return <EmptyPage text="Stamps are added as each compliance milestone is completed — finish the journey to fill this page." />;
  }
  return (
    <div className="grid grid-cols-2 justify-items-center gap-4 sm:grid-cols-3">
      {v.stamps.map((s, i) => (
        <StampSeal key={`${s.code}-${s.at}-${i}`} stamp={s} size="sm" />
      ))}
    </div>
  );
}

function VersionsPage({ v }: { v: PassportView }) {
  return (
    <div>
      <p className="passport-page__muted mb-3 text-center text-[11px]">
        An issued version is never silently changed — updates issue a new version.
      </p>
      {[...v.versions].reverse().map((ver) => (
        <PageRow
          key={ver.version}
          k={`${ver.label}${ver.state === 'current' ? ' · current' : ''}`}
          v={ver.issued_at ? formatPassportDate(ver.issued_at) : '—'}
        />
      ))}
    </div>
  );
}

function HistoryPage({ v }: { v: PassportView }) {
  if (v.history.length === 0) {
    return <EmptyPage text="Your journey record grows as milestones are completed." />;
  }
  return (
    <ol>
      {v.history.map((h, i) => (
        <li key={h.id ?? `${h.at}-${i}`} className="flex items-baseline gap-3 border-b border-current/10 py-1.5 last:border-0">
          <span className="passport-page__muted w-24 shrink-0 font-mono text-[10px]">{formatPassportDateTime(h.at)}</span>
          <span className="min-w-0 flex-1 text-xs">{h.title}</span>
          <span className="passport-page__muted shrink-0 text-[10px]">{h.source}</span>
        </li>
      ))}
    </ol>
  );
}
