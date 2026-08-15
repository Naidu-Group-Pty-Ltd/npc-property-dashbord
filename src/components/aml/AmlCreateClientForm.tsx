import { useCallback, useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, ArrowLeft, Loader2, UserPlus } from "lucide-react";
import { amlCasesApi, type AmlActivationClient } from "@/lib/aml/amlCasesApi";
import {
  createClientRecord, validateNewClient, type NewClientInput,
} from "@/lib/clients/createClientRecord";
import { ClientStatusBadge } from "@/components/aml/AmlClientPicker";

/**
 * Create a brand-new client without leaving the activation dialog.
 *
 * ── What this is, and what it deliberately is not ─────────────────────
 * It creates the client in the CENTRAL register through `manage-client-data`,
 * the same endpoint and the same `client_management.can_edit` permission
 * Client Management uses (see `createClientRecord`). It is not a second
 * client system, and the row it writes is indistinguishable from one created
 * in the CRM — because it was created the same way.
 *
 * It does NOT auto-confirm the activation. A case may only be opened after a
 * **human-confirmed activation event** (AGENTS.md §2), and that confirmation
 * is a regulatory act with a named event, a written reason and a tamper-
 * evident audit record. Creating the client hands it straight to the
 * activation form with the client already selected — which is what removes
 * the round trip — but a person still states the event and confirms it. A
 * "create and activate in one click" that skipped that would be inventing a
 * compliance outcome the frontend has no authority to invent.
 *
 * ── Duplicate detection ───────────────────────────────────────────────
 * Checked BEFORE the insert, against the same AML-gated register read the
 * picker uses, on name and on email. Email is the one that actually catches
 * things: a name check cannot match "Rob Smith" to an existing "Robert
 * Smith", but a shared address will. Matches are shown with the option to
 * use the existing client instead — the point is to stop the duplicate being
 * created, not to report it afterwards.
 */

export interface AmlCreateClientFormProps {
  /** Leave the create form and go back to the register. */
  onCancel: () => void;
  /** The client was created; it becomes the dialog's selection. */
  onCreated: (client: AmlActivationClient) => void;
  /** Use an existing client the duplicate check surfaced instead. */
  onUseExisting: (client: AmlActivationClient) => void;
  disabled?: boolean;
}

const EMPTY: NewClientInput = { firstName: "", surname: "", email: "", mobile: "" };

export function AmlCreateClientForm({
  onCancel, onCreated, onUseExisting, disabled,
}: AmlCreateClientFormProps) {
  const [form, setForm] = useState<NewClientInput>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [duplicates, setDuplicates] = useState<AmlActivationClient[]>([]);
  const [checking, setChecking] = useState(false);
  const dupSeq = useRef(0);

  const set = (patch: Partial<NewClientInput>) => {
    setForm((f) => ({ ...f, ...patch }));
    setError(null);
  };

  const fullName = `${form.firstName} ${form.surname}`.trim();
  const email = (form.email ?? "").trim();

  /**
   * Look for an existing client before one is created. Name and email are
   * checked independently — they catch different duplicates — and the results
   * are merged by id.
   */
  const checkDuplicates = useCallback(async () => {
    const seq = ++dupSeq.current;
    const queries = [fullName.length >= 2 ? fullName : null, email.length >= 3 ? email : null]
      .filter((q): q is string => Boolean(q));
    if (queries.length === 0) {
      setDuplicates([]);
      return;
    }
    setChecking(true);
    try {
      const pages = await Promise.all(queries.map((query) =>
        amlCasesApi.listClientsForActivation({ query, status: "all", limit: 5 })
          .then((p) => p.clients ?? [], () => [])));
      if (seq !== dupSeq.current) return;
      const byId = new Map<string, AmlActivationClient>();
      for (const c of pages.flat()) byId.set(c.id, c);
      setDuplicates([...byId.values()].slice(0, 5));
    } finally {
      if (seq === dupSeq.current) setChecking(false);
    }
  }, [fullName, email]);

  useEffect(() => {
    const t = setTimeout(() => { void checkDuplicates(); }, 350);
    return () => clearTimeout(t);
  }, [checkDuplicates]);

  const validationError = validateNewClient(form);
  const canSubmit = !validationError && !submitting && !disabled;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await createClientRecord(form);
      onCreated({
        id: created.id,
        label: [created.primary_first_name, created.primary_surname]
          .filter(Boolean).join(" ").trim() || fullName,
        email: created.primary_email ?? (email || null),
        mobile: created.primary_mobile ?? (form.mobile?.trim() || null),
        // A brand-new client is inactive until this activation confirms it,
        // and it cannot already hold a case.
        is_active: false,
        has_open_case: false,
      });
    } catch (e: any) {
      // Creation failures are shown here rather than as a toast: the operator
      // is mid-form and needs to fix a field, not dismiss a notification.
      setError(e?.message ?? "The client could not be created.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-3" data-testid="ac-create-client">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <UserPlus aria-hidden="true" className="h-4 w-4 text-primary" />
          New client
        </p>
        <Button
          type="button" variant="ghost" size="sm"
          className="h-7 gap-1 px-2 text-xs"
          onClick={onCancel}
          disabled={submitting}
        >
          <ArrowLeft aria-hidden="true" className="h-3 w-3" />
          Back to register
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="nc-first">First name</Label>
          <Input
            id="nc-first" value={form.firstName} disabled={submitting || disabled}
            onChange={(e) => set({ firstName: e.target.value })}
            placeholder="Given name" autoComplete="off"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="nc-surname">Surname</Label>
          <Input
            id="nc-surname" value={form.surname} disabled={submitting || disabled}
            onChange={(e) => set({ surname: e.target.value })}
            placeholder="Family name" autoComplete="off"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="nc-email">Email <span className="text-muted-foreground">(optional)</span></Label>
          <Input
            id="nc-email" type="email" value={form.email} disabled={submitting || disabled}
            onChange={(e) => set({ email: e.target.value })}
            placeholder="name@example.com" autoComplete="off"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="nc-mobile">Mobile <span className="text-muted-foreground">(optional)</span></Label>
          <Input
            id="nc-mobile" value={form.mobile} disabled={submitting || disabled}
            onChange={(e) => set({ mobile: e.target.value })}
            placeholder="04…" autoComplete="off"
          />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        The client is created in the central client register — the same record
        Client Management uses. You will confirm the activation event below
        before any case is opened.
      </p>

      {/* Duplicate detection — before the insert, never after it. */}
      {duplicates.length > 0 && (
        <Alert role="status">
          <AlertTriangle aria-hidden="true" className="h-4 w-4" />
          <AlertTitle>
            {duplicates.length === 1
              ? "A similar client already exists"
              : `${duplicates.length} similar clients already exist`}
          </AlertTitle>
          <AlertDescription className="space-y-2">
            <p className="text-xs">
              Use the existing record instead of creating a second one.
            </p>
            <ul className="space-y-1">
              {duplicates.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    disabled={submitting || c.has_open_case}
                    onClick={() => onUseExisting(c)}
                    className="flex w-full items-center justify-between gap-2 rounded-md border border-border/60 px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{c.label}</span>
                      {c.email && (
                        <span className="block truncate text-muted-foreground">{c.email}</span>
                      )}
                    </span>
                    <span className="shrink-0">
                      {c.has_open_case
                        ? <span className="text-warning">{c.open_case?.case_reference ?? "Open case"}</span>
                        : <ClientStatusBadge active={c.is_active} />}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertTriangle aria-hidden="true" className="h-4 w-4" />
          <AlertTitle>The client was not created</AlertTitle>
          <AlertDescription className="text-xs">{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {checking ? "Checking for existing clients…" : validationError ?? ""}
        </p>
        <Button
          type="button" size="sm" onClick={submit} disabled={!canSubmit}
          data-testid="ac-create-client-submit"
        >
          {submitting && <Loader2 aria-hidden="true" className="mr-2 h-3.5 w-3.5 animate-spin" />}
          Create client
        </Button>
      </div>
    </div>
  );
}
