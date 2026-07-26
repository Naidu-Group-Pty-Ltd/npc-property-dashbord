import { useEffect, useMemo, useState } from "react";
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
import { Loader2, ShieldCheck, AlertTriangle } from "lucide-react";
import { amlCasesApi, type AmlCase } from "@/lib/aml/amlCasesApi";
import { amlTenantApi, type AmlActivationProgram } from "@/lib/aml/amlTenantApi";
import { invokeSecureFunction } from "@/lib/secureInvoke";
import { toast } from "@/hooks/use-toast";

interface PickerClient {
  id: string;
  primary_first_name: string | null;
  primary_surname: string | null;
  is_active: boolean | null;
}

function pickerLabel(c: PickerClient): string {
  return [c.primary_first_name, c.primary_surname].filter(Boolean).join(" ").trim() || "Unnamed client";
}

/**
 * Phase 3 — Activate Client for AML dialog.
 *
 * Enforces the "human-confirmed activation event" rule from AGENTS.md §2.
 * Model B is disabled in the UI until the tenant records legal approval +
 * a program version. Server enforces the same guardrail regardless.
 */
export interface ActivateClientDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional prefill when launched from a specific client. */
  clientId?: string;
  clientName?: string;
  onActivated?: (aCase: AmlCase) => void;
}

export function ActivateClientDialog({
  open, onOpenChange, clientId, clientName, onActivated,
}: ActivateClientDialogProps) {
  const [clientIdInput, setClientIdInput] = useState(clientId ?? "");
  const [displayName, setDisplayName] = useState(clientName ?? "");
  const [subjectType, setSubjectType] = useState<"individual" | "entity" | "trust">("individual");
  const [model, setModel] = useState<"A" | "B">("A");
  const [event, setEvent] = useState("");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  const [program, setProgram] = useState<AmlActivationProgram | null>(null);
  const [loadingProgram, setLoadingProgram] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Client picker (no raw UUID entry in the ordinary workflow — directive §13.4).
  const [clients, setClients] = useState<PickerClient[] | null>(null);
  const [clientSearch, setClientSearch] = useState("");
  const [selectedClientLabel, setSelectedClientLabel] = useState<string | null>(null);

  const modelBReady = Boolean(program?.legal_approval && program?.program_version?.trim());

  useEffect(() => {
    if (!open) return;
    setClientIdInput(clientId ?? "");
    setDisplayName(clientName ?? "");
    setSubjectType("individual");
    setModel("A");
    setEvent("");
    setReason("");
    setConfirmed(false);
    setClientSearch("");
    setSelectedClientLabel(clientId ? clientName ?? null : null);

    let alive = true;
    setLoadingProgram(true);
    amlTenantApi.getActivationProgram()
      .then((p) => { if (alive) setProgram(p); })
      .catch(() => { if (alive) setProgram(null); })
      .finally(() => { if (alive) setLoadingProgram(false); });

    // Load a slim client list for the picker only when not prefilled.
    if (!clientId) {
      invokeSecureFunction<{ success: boolean; clients: PickerClient[] }>("get-client-data", {
        listMode: true,
        listOptions: { select: "id, primary_first_name, primary_surname, is_active", orderBy: "primary_surname", orderAsc: true },
      })
        .then(({ data }) => { if (alive && data?.success) setClients(data.clients ?? []); })
        .catch(() => { if (alive) setClients([]); });
    }
    return () => { alive = false; };
  }, [open, clientId, clientName]);

  const clientMatches = useMemo(() => {
    if (!clients || clientIdInput) return [];
    const q = clientSearch.trim().toLowerCase();
    if (q.length < 2) return [];
    return clients
      .filter((c) => pickerLabel(c).toLowerCase().includes(q))
      .slice(0, 8);
  }, [clients, clientSearch, clientIdInput]);

  const selectClient = (c: PickerClient) => {
    setClientIdInput(c.id);
    setSelectedClientLabel(pickerLabel(c));
    if (!displayName.trim()) setDisplayName(pickerLabel(c));
    setClientSearch("");
  };

  const canSubmit =
    !!clientIdInput.trim() &&
    /^[0-9a-f-]{36}$/i.test(clientIdInput.trim()) &&
    !!displayName.trim() &&
    !!event.trim() &&
    reason.trim().length >= 10 &&
    confirmed &&
    (model === "A" || modelBReady);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const { case: created } = await amlCasesApi.activateClient({
        client_id: clientIdInput.trim(),
        subject_display_name: displayName.trim(),
        subject_type: subjectType,
        activation_model: model,
        activation_event: event.trim(),
        reason: reason.trim(),
        human_confirmed: true,
      });
      toast({
        title: "Client activated for AML",
        description: `${created.case_reference} opened.`,
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Activate client for AML/CTF
          </DialogTitle>
          <DialogDescription>
            Cases open only for real, active clients after a human-confirmed
            activation event. Marketing leads never auto-generate a case.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ac-client-search">Client</Label>
              {clientIdInput ? (
                <div className="flex min-h-9 items-center gap-2">
                  <Badge variant="secondary" className="max-w-full truncate">
                    {selectedClientLabel ?? clientName ?? "Selected client"}
                  </Badge>
                  {!clientId && (
                    <Button
                      type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs"
                      onClick={() => { setClientIdInput(""); setSelectedClientLabel(null); }}
                    >
                      Change
                    </Button>
                  )}
                </div>
              ) : (
                <>
                  <Input
                    id="ac-client-search"
                    value={clientSearch}
                    onChange={(e) => setClientSearch(e.target.value)}
                    placeholder="Search clients by name…"
                    autoComplete="off"
                  />
                  {clientSearch.trim().length >= 2 && (
                    <ul
                      className="max-h-40 overflow-y-auto rounded-md border border-border/60 text-sm"
                      aria-label="Matching clients"
                    >
                      {clientMatches.length === 0 ? (
                        <li className="px-3 py-2 text-muted-foreground">
                          {clients === null ? "Loading clients…" : "No matching clients."}
                        </li>
                      ) : (
                        clientMatches.map((c) => (
                          <li key={c.id}>
                            <button
                              type="button"
                              className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-accent focus:outline-none focus-visible:bg-accent"
                              onClick={() => selectClient(c)}
                            >
                              <span className="truncate">{pickerLabel(c)}</span>
                              {c.is_active === false && (
                                <span className="ml-2 shrink-0 text-xs text-muted-foreground">Inactive</span>
                              )}
                            </button>
                          </li>
                        ))
                      )}
                    </ul>
                  )}
                </>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ac-name">Subject display name</Label>
              <Input
                id="ac-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Full legal name"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Subject type</Label>
              <Select value={subjectType} onValueChange={(v: any) => setSubjectType(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="individual">Individual</SelectItem>
                  <SelectItem value="entity">Entity</SelectItem>
                  <SelectItem value="trust">Trust</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Activation timing</Label>
              <Select value={model} onValueChange={(v: any) => setModel(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="A">At service trigger — agreement in place</SelectItem>
                  <SelectItem value="B" disabled={!modelBReady}>
                    Before service — conditional agreement{modelBReady ? "" : " (not available)"}
                  </SelectItem>
                </SelectContent>
              </Select>
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
            <Label htmlFor="ac-event">Activation event</Label>
            <Input
              id="ac-event"
              value={event}
              onChange={(e) => setEvent(e.target.value)}
              placeholder="e.g. Signed engagement letter · Executed agency agreement"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ac-reason">Reason & evidence (min 10 chars)</Label>
            <Textarea
              id="ac-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Describe the trigger, evidence source and why AML activation is warranted."
            />
          </div>

          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={confirmed}
              onCheckedChange={(v) => setConfirmed(Boolean(v))}
              className="mt-0.5"
            />
            <span className="text-muted-foreground">
              I confirm this activation event has occurred and the client is a
              real active client. I understand a tamper-evident audit record
              will be written.
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Activate client
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
