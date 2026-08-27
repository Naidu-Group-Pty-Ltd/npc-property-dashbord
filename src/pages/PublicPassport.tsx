import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Loader2, ShieldCheck, XCircle, Clock, CheckCircle2, AlertTriangle, ScrollText,
} from "lucide-react";
import { BrandLockup } from "@/components/branding/BrandAssets";
import {
  passportPublicApi, type PassportRedemption,
} from "@/lib/aml/partnerAcknowledgementPublic";

/**
 * The Compliance Passport, opened from a link — no portal, no account.
 *
 * The bearer token in the URL is the same credential a system-to-system
 * integration uses, redeemed through the same `redeem_attestation`
 * operation. This page adds no disclosure of its own: what it renders is
 * exactly what the server chose to disclose, and the server intersects the
 * payload with the grant's manifest before sending it.
 *
 * Two things are given deliberate prominence rather than fine print:
 *
 *   1. THE RESPONSIBILITY NOTICE. Relying on another entity's
 *      identification does not transfer that entity's obligations. The
 *      server states this at the point of use and this page leads with it.
 *
 *   2. THE INDEPENDENT ASSESSMENT. A partner may make their OWN
 *      determination against the same records instead of relying — always
 *      available, at their prerogative, and it never moves the issuing
 *      organisation's case.
 */
export default function PublicPassport() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<PassportRedemption | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; code: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [requested, setRequested] = useState<string | null>(null);

  /* The partner's own determination. */
  const [assessOpen, setAssessOpen] = useState(false);
  const [assessorName, setAssessorName] = useState("");
  const [assessorRole, setAssessorRole] = useState("");
  const [assessStatus, setAssessStatus] =
    useState<"satisfied" | "not_satisfied" | "records_requested">("satisfied");
  const [assessNotes, setAssessNotes] = useState("");
  const [assessDone, setAssessDone] = useState<string | null>(null);
  const [assessError, setAssessError] = useState<string | null>(null);

  useEffect(() => { document.title = "Compliance Passport"; }, []);

  const load = useCallback(async () => {
    if (!token) { setError({ message: "This link is not valid.", code: null }); setLoading(false); return; }
    setLoading(true);
    try {
      const res = await passportPublicApi.redeem(token);
      setData(res);
      setError(null);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "This link is not valid.";
      // The server's own denial vocabulary decides what may be offered —
      // only an expiry may be self-renewed.
      const code = /expired/i.test(message) ? "expired"
        : /revoked/i.test(message) ? "revoked"
        : /superseded|refresh/i.test(message) ? "refresh_required"
        : null;
      setError({ message, code });
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const requestNewLink = async () => {
    if (!token) return;
    setBusy(true);
    try {
      const res = await passportPublicApi.requestNewLink(token);
      setRequested(res.message);
    } catch (e: unknown) {
      setRequested(e instanceof Error ? e.message : "The request could not be sent.");
    } finally {
      setBusy(false);
    }
  };

  const submitAssessment = async () => {
    if (!token) return;
    if (assessorName.trim().length < 2) {
      setAssessError("Enter the name of the person making the determination.");
      return;
    }
    if (assessNotes.trim().length < 10) {
      setAssessError("Record at least a brief rationale (10 characters or more).");
      return;
    }
    setAssessError(null);
    setBusy(true);
    try {
      const res = await passportPublicApi.recordIndependentAssessment(token, {
        assessor_name: assessorName.trim(),
        assessor_role: assessorRole.trim() || undefined,
        status: assessStatus,
        decision_notes: assessNotes.trim(),
      });
      setAssessDone(res.message);
      setAssessOpen(false);
    } catch (e: unknown) {
      setAssessError(e instanceof Error ? e.message : "The determination could not be recorded.");
    } finally {
      setBusy(false);
    }
  };

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <div className="flex justify-center">
          <BrandLockup slot="auth" meta="Compliance Passport" />
        </div>
        {children}
      </div>
    </div>
  );

  if (loading) {
    return shell(
      <div className="flex items-center justify-center py-20" role="status">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
        <span className="sr-only">Opening the Compliance Passport…</span>
      </div>,
    );
  }

  if (error || !data) {
    const expired = error?.code === "expired";
    return shell(
      <Card className="glass-panel">
        <CardContent className="space-y-3 py-8 text-center">
          {expired ? (
            <Clock className="mx-auto h-8 w-8 text-warning" aria-hidden />
          ) : (
            <XCircle className="mx-auto h-8 w-8 text-destructive" aria-hidden />
          )}
          <h1 className="text-base font-semibold">
            {expired ? "This access has expired" : "This link cannot be opened"}
          </h1>
          <p className="mx-auto max-w-prose text-sm text-muted-foreground">
            {error?.message ?? "The link may have been mistyped."}
          </p>
          {/* Only an expiry may be renewed from here. A revoked access is a
              decision by the issuing organisation, and this page never
              invites its subject to undo it. */}
          {expired && !requested && (
            <Button onClick={() => void requestNewLink()} disabled={busy}>
              {busy && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" aria-hidden />}
              Request a new link
            </Button>
          )}
          {requested && (
            <p className="mx-auto max-w-prose text-sm text-success" aria-live="polite">{requested}</p>
          )}
        </CardContent>
      </Card>,
    );
  }

  return shell(
    <>
      {/* 1 · What this is, and what it is not. */}
      <Alert>
        <ShieldCheck className="h-4 w-4" />
        <AlertTitle className="text-sm">
          Compliance Passport for {data.agreement.partner_org_name}
        </AlertTitle>
        <AlertDescription className="text-xs">{data.notice}</AlertDescription>
      </Alert>

      <Card className="glass-panel">
        <CardContent className="space-y-3 py-5 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ScrollText className="h-4 w-4 text-primary" aria-hidden />
              <h2 className="text-sm font-semibold">Customer identification procedures performed</h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="text-[11px]">
                Issued {new Date(data.issued_at).toLocaleDateString()}
              </Badge>
              <Badge variant="outline" className="font-mono text-[11px]">
                sha {data.attestation_sha256.slice(0, 12)}…
              </Badge>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Under arrangement {data.agreement.agreement_reference}. This record states what was
            performed — it does not contain the issuing organisation&apos;s risk assessment, screening
            match content or internal notes, and it never will.
          </p>
          {/* The disclosed payload, exactly as the server built it. The
              server intersects it with this grant's manifest first; nothing
              is filtered, expanded or relabelled here. */}
          <pre className="max-h-[26rem] overflow-auto rounded-md border border-border/60 bg-muted/40 p-3 text-[11px] leading-relaxed">
            {JSON.stringify(data.attestation, null, 2)}
          </pre>
        </CardContent>
      </Card>

      {/* 2 · Their own determination — always available, at their prerogative. */}
      <Card className="glass-panel">
        <CardContent className="space-y-3 py-5 text-sm">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
            <div className="space-y-1">
              <h2 className="text-sm font-semibold">Make your own determination</h2>
              <p className="text-xs text-muted-foreground">
                Relying on these procedures does not transfer your organisation&apos;s AML/CTF
                obligations. Safe practice is to satisfy yourself independently — you can record your
                own determination against these same records, without approaching the customer again.
                It is recorded against this access and never alters the issuing organisation&apos;s
                own case.
              </p>
            </div>
          </div>

          {assessDone && (
            <p className="rounded-md border border-success/40 bg-success/5 p-3 text-xs text-success"
              aria-live="polite">{assessDone}</p>
          )}

          {!assessDone && !assessOpen && (
            <Button variant="outline" size="sm" onClick={() => setAssessOpen(true)}>
              Record an independent assessment
            </Button>
          )}

          {!assessDone && assessOpen && (
            <div className="space-y-3 border-t border-border/50 pt-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="pp-name" className="text-xs">Your name</Label>
                  <Input id="pp-name" value={assessorName}
                    onChange={(e) => setAssessorName(e.target.value)} placeholder="e.g. Jordan Lee" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pp-role" className="text-xs">Your role (optional)</Label>
                  <Input id="pp-role" value={assessorRole}
                    onChange={(e) => setAssessorRole(e.target.value)} placeholder="e.g. Compliance Officer" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Your determination</Label>
                <div role="radiogroup" aria-label="Determination" className="grid gap-2 sm:grid-cols-3">
                  {([
                    { value: "satisfied", label: "Satisfied", meaning: "These procedures meet our requirements." },
                    { value: "not_satisfied", label: "Not satisfied", meaning: "We will complete our own CDD." },
                    { value: "records_requested", label: "Records requested", meaning: "We need more before deciding." },
                  ] as const).map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={assessStatus === option.value}
                      onClick={() => setAssessStatus(option.value)}
                      className={
                        assessStatus === option.value
                          ? "rounded-md border border-primary bg-primary/5 p-2.5 text-left"
                          : "rounded-md border border-border/60 p-2.5 text-left hover:border-primary/50"
                      }
                    >
                      <span className="block text-sm font-medium">{option.label}</span>
                      <span className="block text-xs text-muted-foreground">{option.meaning}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pp-notes" className="text-xs">Rationale</Label>
                <textarea
                  id="pp-notes"
                  className="min-h-[64px] w-full rounded-md border border-input bg-background p-2 text-sm"
                  value={assessNotes}
                  onChange={(e) => setAssessNotes(e.target.value)}
                  placeholder="What you reviewed and what you concluded…"
                />
              </div>
              {assessError && (
                <p className="flex items-start gap-1.5 text-xs text-destructive" aria-live="polite">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  {assessError}
                </p>
              )}
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setAssessOpen(false)} disabled={busy}>
                  Cancel
                </Button>
                <Button size="sm" onClick={() => void submitAssessment()} disabled={busy}>
                  {busy && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" aria-hidden />}
                  Record determination
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </>,
  );
}
