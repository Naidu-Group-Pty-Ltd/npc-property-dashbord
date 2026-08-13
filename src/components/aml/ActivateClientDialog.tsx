import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle, CheckCircle2, Loader2, Mail, Phone, ShieldCheck,
} from "lucide-react";
import {
  amlCasesApi, type AmlActivationClient, type AmlCase,
} from "@/lib/aml/amlCasesApi";
import { amlTenantApi, type AmlActivationProgram } from "@/lib/aml/amlTenantApi";
import { toast } from "@/hooks/use-toast";

/**
 * Phase 3 — Activate Client for AML dialog.
 *
 * Enforces the "human-confirmed activation event" rule from AGENTS.md §2.
 * Model B is disabled in the UI until the tenant records legal approval +
 * a program version. Server enforces the same guardrail regardless.
 *
 * This form is the sanctioned place an authorised user confirms an existing
 * client is active and starts AML/CTF compliance: inactive clients are
 * searchable and selectable here, and confirming the form marks them active
 * atomically with case creation (server-side).
 */
export interface ActivateClientDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Optional preselection when launched for a specific client (route handoff
   * or client record). Only the ID is trusted — the display name, contact
   * details and active status are loaded server-side from this ID.
   */
  clientId?: string;
  /** Optional display-only fallback while the authoritative record loads. */
  clientName?: string;
  onActivated?: (aCase: AmlCase) => void;
}

function SectionHeading({ title }: { title: string }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
      {title}
    </h3>
  );
}

function StatusBadge({ active }: { active: boolean }) {
  return active ? (
    <Badge variant="outline" className="shrink-0 border-success/40 bg-success/10 text-success">
      Active
    </Badge>
  ) : (
    <Badge variant="outline" className="shrink-0 border-warning/40 bg-warning/10 text-warning">
      Inactive
    </Badge>
  );
}

export function ActivateClientDialog({
  open, onOpenChange, clientId, clientName, onActivated,
}: ActivateClientDialogProps) {
  const queryClient = useQueryClient();

  const [selected, setSelected] = useState<AmlActivationClient | null>(null);
  const [displayName, setDisplayName] = useState(clientName ?? "");
  const [nameDirty, setNameDirty] = useState(false);
  const [subjectType, setSubjectType] = useState<"individual" | "entity" | "trust">("individual");
  const [model, setModel] = useState<"A" | "B">("A");
  const [event, setEvent] = useState("");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  const [program, setProgram] = useState<AmlActivationProgram | null>(null);
  const [loadingProgram, setLoadingProgram] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Route/record handoff: the exact client is loaded and validated
  // server-side from its ID. The browser never supplies name or status.
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);

  // Client picker (no raw UUID entry in the ordinary workflow — directive §13.4).
  // Search runs server-side through the AML-role-gated `search_clients` op and
  // returns both active and inactive clients; inactive clients are selectable
  // and get marked active when this form is confirmed.
  const [clientSearch, setClientSearch] = useState("");
  const [clientMatches, setClientMatches] = useState<AmlActivationClient[]>([]);
  const [searchState, setSearchState] = useState<"idle" | "searching" | "ready" | "error">("idle");
  const [searchError, setSearchError] = useState<string | null>(null);

  const modelBReady = Boolean(program?.legal_approval && program?.program_version?.trim());

  useEffect(() => {
    if (!open) return;
    setSelected(null);
    setDisplayName(clientName ?? "");
    setNameDirty(false);
    setSubjectType("individual");
    setModel("A");
    setEvent("");
    setReason("");
    setConfirmed(false);
    setClientSearch("");
    setClientMatches([]);
    setSearchState("idle");
    setSearchError(null);
    setRouteError(null);

    let alive = true;

    if (clientId) {
      setRouteLoading(true);
      amlCasesApi.getClientForActivation(clientId)
        .then((res) => {
          if (!alive) return;
          setSelected(res.client);
          // The subject display name comes from the authoritative record, not
          // from the URL or any caller-supplied label.
          setDisplayName(res.client.label);
        })
        .catch((e: any) => {
          if (!alive) return;
          setRouteError(e?.message ?? "This client could not be loaded.");
        })
        .finally(() => { if (alive) setRouteLoading(false); });
    } else {
      setRouteLoading(false);
    }

    setLoadingProgram(true);
    amlTenantApi.getActivationProgram()
      .then((p) => { if (alive) setProgram(p); })
      .catch(() => { if (alive) setProgram(null); })
      .finally(() => { if (alive) setLoadingProgram(false); });

    return () => { alive = false; };
  }, [open, clientId, clientName]);

  // Debounced server-side lookup. Failures surface to the operator rather than
  // being swallowed into a silent "no matches".
  useEffect(() => {
    if (!open || selected) return;
    const q = clientSearch.trim();
    if (q.length < 2) {
      setClientMatches([]);
      setSearchState("idle");
      setSearchError(null);
      return;
    }
    let alive = true;
    setSearchState("searching");
    const timer = setTimeout(() => {
      amlCasesApi.searchClients(q)
        .then(({ clients: found }) => {
          if (!alive) return;
          setClientMatches(found ?? []);
          setSearchState("ready");
          setSearchError(null);
        })
        .catch((e: any) => {
          if (!alive) return;
          setClientMatches([]);
          setSearchState("error");
          setSearchError(e?.message ?? "Client search is unavailable.");
        });
    }, 250);
    return () => { alive = false; clearTimeout(timer); };
  }, [open, clientSearch, selected]);

  const selectClient = (c: AmlActivationClient) => {
    setSelected(c);
    if (!nameDirty || !displayName.trim()) setDisplayName(c.label);
    setClientSearch("");
    setClientMatches([]);
    setSearchState("idle");
  };

  const clearSelection = () => {
    setSelected(null);
    if (!nameDirty) setDisplayName("");
  };

  const canSubmit =
    !!selected &&
    !selected.has_open_case &&
    !routeError &&
    !routeLoading &&
    !!displayName.trim() &&
    event.trim().length >= 3 &&
    reason.trim().length >= 10 &&
    confirmed &&
    (model === "A" || modelBReady);

  const handleSubmit = async () => {
    if (!canSubmit || !selected) return;
    setSubmitting(true);
    try {
      const { case: created, client_activation, client_portal } =
        await amlCasesApi.activateClient({
          client_id: selected.id,
          subject_display_name: displayName.trim(),
          subject_type: subjectType,
          activation_model: model,
          activation_event: event.trim(),
          reason: reason.trim(),
          human_confirmed: true,
        });

      // The client record, its AML summary and the client list all changed —
      // refresh them without requiring a page reload.
      void queryClient.invalidateQueries({ queryKey: ["clients"] });
      void queryClient.invalidateQueries({ queryKey: ["aml-client-summary", selected.id] });
      void queryClient.invalidateQueries({ queryKey: ["secure-client-data", selected.id] });
      void queryClient.invalidateQueries({ queryKey: ["secure-client", selected.id] });

      // A client who cannot reach their portal will never complete screening,
      // so make that the headline rather than a quiet success toast.
      const activatedNote = client_activation?.marked_active
        ? "The client record has been marked active. " : "";
      toast({
        title: "Client activated for AML",
        description: client_portal?.note
          ? `${created.case_reference} opened. ${activatedNote}${client_portal.note}`
          : `${created.case_reference} opened. ${activatedNote}`.trim(),
        variant: client_portal && client_portal.has_portal_access === false
          ? "destructive" : undefined,
      });
      onActivated?.(created);
      onOpenChange(false);
    } catch (e: any) {
      toast({
        title: "Activation failed",
        description: e?.message ?? "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const formUsable = !routeError;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="activate-client-dialog"
        className="flex max-h-[92vh] w-full flex-col gap-0 overflow-hidden p-0 pb-0 sm:max-h-[min(88vh,53rem)] sm:w-[min(calc(100vw-2rem),780px)] sm:max-w-[780px] sm:p-0"
      >
        <DialogHeader className="shrink-0 border-b border-border/60 px-5 py-4 text-left sm:px-6">
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 shrink-0 text-primary" />
            Activate client for AML/CTF
          </DialogTitle>
          <DialogDescription>
            Cases open only for real clients after a human-confirmed activation
            event. Marketing leads never auto-generate a case.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overflow-x-hidden px-5 py-4 sm:px-6 sm:py-5">
          {routeError ? (
            <Alert variant="destructive" role="alert">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>This client could not be loaded</AlertTitle>
              <AlertDescription>
                {routeError} The activation form is unavailable until a valid,
                accessible client is selected. Close this dialog and try again
                from the client record.
              </AlertDescription>
            </Alert>
          ) : (
            <>
              {/* 1 — Selected client */}
              <section className="space-y-3" aria-label="Selected client">
                <SectionHeading title="1 · Selected client" />
                {routeLoading ? (
                  <div
                    className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-4 py-6 text-sm text-muted-foreground"
                    role="status"
                  >
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading client…
                  </div>
                ) : selected ? (
                  <div
                    className="space-y-2.5 rounded-lg border border-border/60 bg-muted/30 p-4"
                    data-testid="ac-selected-client"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 space-y-1">
                        <p className="break-words font-medium leading-tight">{selected.label}</p>
                        {selected.email && (
                          <p className="flex min-w-0 items-center gap-1.5 break-all text-xs text-muted-foreground">
                            <Mail className="h-3.5 w-3.5 shrink-0" /> {selected.email}
                          </p>
                        )}
                        {selected.mobile && (
                          <p className="flex min-w-0 items-center gap-1.5 break-words text-xs text-muted-foreground">
                            <Phone className="h-3.5 w-3.5 shrink-0" /> {selected.mobile}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <StatusBadge active={selected.is_active} />
                        {!clientId && (
                          <Button
                            type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs"
                            onClick={clearSelection}
                          >
                            Change
                          </Button>
                        )}
                      </div>
                    </div>

                    {selected.is_active ? (
                      <p className="flex items-center gap-1.5 text-xs text-success">
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> Active client
                      </p>
                    ) : (
                      <p className="flex items-start gap-1.5 text-xs text-warning">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        Inactive client — this client will be marked active when
                        AML/CTF activation is confirmed.
                      </p>
                    )}

                    {selected.has_open_case && (
                      <Alert variant="destructive" role="alert">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle>Open case exists</AlertTitle>
                        <AlertDescription>
                          An open AML/CTF case already exists for this client.
                          {selected.open_case?.case_reference
                            ? ` (${selected.open_case.case_reference})` : ""}{" "}
                          A second open case cannot be started.
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label htmlFor="ac-client-search">Find client</Label>
                    <Input
                      id="ac-client-search"
                      value={clientSearch}
                      onChange={(e) => setClientSearch(e.target.value)}
                      placeholder="Search clients by first name, surname or full name…"
                      autoComplete="off"
                    />
                    <p className="text-xs text-muted-foreground">
                      Active and inactive clients are shown. Selecting an inactive
                      client lets you activate them through this form.
                    </p>
                    {clientSearch.trim().length >= 2 && (
                      <ul
                        className="max-h-56 overflow-y-auto rounded-md border border-border/60 text-sm"
                        aria-label="Matching clients"
                      >
                        {clientMatches.length === 0 ? (
                          <li className="px-3 py-2.5 text-muted-foreground" role="status">
                            {searchState === "searching" ? "Searching…"
                              : searchState === "error"
                                ? (searchError ?? "Client search is unavailable.")
                                : "No clients match that name."}
                          </li>
                        ) : (
                          clientMatches.map((c) => (
                            <li key={c.id}>
                              <button
                                type="button"
                                className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-accent focus:outline-none focus-visible:bg-accent"
                                onClick={() => selectClient(c)}
                              >
                                <span className="min-w-0">
                                  <span className="block truncate font-medium">{c.label}</span>
                                  {c.email && (
                                    <span className="block truncate text-xs text-muted-foreground">
                                      {c.email}
                                    </span>
                                  )}
                                </span>
                                <span className="flex shrink-0 items-center gap-2">
                                  {c.has_open_case && (
                                    <span className="text-xs text-warning">Open case</span>
                                  )}
                                  <StatusBadge active={c.is_active} />
                                </span>
                              </button>
                            </li>
                          ))
                        )}
                      </ul>
                    )}
                  </div>
                )}
              </section>

              {/* 2 — AML subject details */}
              <section className="space-y-3" aria-label="AML subject details">
                <SectionHeading title="2 · AML subject details" />
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="ac-name">Subject display name</Label>
                    <Input
                      id="ac-name"
                      value={displayName}
                      onChange={(e) => { setDisplayName(e.target.value); setNameDirty(true); }}
                      placeholder="Full legal name"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ac-subject-type">Subject type</Label>
                    <Select value={subjectType} onValueChange={(v: any) => setSubjectType(v)}>
                      <SelectTrigger id="ac-subject-type"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="individual">Individual</SelectItem>
                        <SelectItem value="entity">Entity / company</SelectItem>
                        <SelectItem value="trust">Trust</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </section>

              {/* 3 — Activation details */}
              <section className="space-y-3" aria-label="Activation details">
                <SectionHeading title="3 · Activation details" />
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="ac-timing">Activation timing</Label>
                    <Select value={model} onValueChange={(v: any) => setModel(v)}>
                      <SelectTrigger id="ac-timing" className="[&>span]:truncate"><SelectValue /></SelectTrigger>
                      <SelectContent className="max-w-[min(90vw,32rem)]">
                        <SelectItem value="A" className="whitespace-normal">
                          At service trigger — agreement in place
                        </SelectItem>
                        <SelectItem value="B" disabled={!modelBReady} className="whitespace-normal">
                          Before service — conditional agreement{modelBReady ? "" : " (not available)"}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ac-event">Activation event</Label>
                    <Input
                      id="ac-event"
                      value={event}
                      onChange={(e) => setEvent(e.target.value)}
                      placeholder="e.g. Signed engagement letter"
                    />
                  </div>
                </div>

                {model === "B" && !modelBReady && !loadingProgram && (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Pre-service activation is not available yet</AlertTitle>
                    <AlertDescription>
                      Starting compliance before the service requires recorded legal approval and a
                      program version in Configuration. Use the service-trigger option, or complete
                      the program setup first.
                    </AlertDescription>
                  </Alert>
                )}

                {model === "B" && modelBReady && (
                  <Alert>
                    <ShieldCheck className="h-4 w-4" />
                    <AlertTitle>Pre-service activation — program v{program?.program_version}</AlertTitle>
                    <AlertDescription>
                      Legal approval recorded{program?.approved_at ? ` on ${new Date(program.approved_at).toLocaleDateString()}` : ""}.
                      The designated service stays locked until the compliance gate is approved.
                    </AlertDescription>
                  </Alert>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="ac-reason">Reason &amp; evidence (min 10 chars)</Label>
                  <Textarea
                    id="ac-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={3}
                    placeholder="Describe the trigger, evidence source and why AML activation is warranted."
                  />
                </div>
              </section>

              {/* 4 — Confirmation */}
              <section className="space-y-3" aria-label="Confirmation">
                <SectionHeading title="4 · Confirmation" />

                {selected && !selected.is_active && !selected.has_open_case && (
                  <Alert>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Inactive client</AlertTitle>
                    <AlertDescription>
                      This client is currently inactive. Confirming this form will
                      activate the client and start AML/CTF compliance.
                    </AlertDescription>
                  </Alert>
                )}

                <label className="flex items-start gap-2.5 text-sm">
                  <Checkbox
                    checked={confirmed}
                    onCheckedChange={(v) => setConfirmed(Boolean(v))}
                    className="mt-0.5"
                    aria-label="Confirm activation event"
                  />
                  <span className="text-muted-foreground">
                    I confirm this activation event has occurred and this is a real
                    client of the business. I understand a tamper-evident audit
                    record will be written.
                  </span>
                </label>
              </section>
            </>
          )}
        </div>

        <DialogFooter className="shrink-0 flex-col-reverse gap-2 border-t border-border/60 bg-background px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end sm:px-6 sm:pb-4">
          <Button
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          {formUsable && (
            <Button
              className="w-full sm:w-auto"
              onClick={handleSubmit}
              disabled={!canSubmit || submitting}
            >
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Activate client
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
