/**
 * Typed electronic execution — shared by the partner's signing step and the
 * Command Centre counter-signature. The signature is the signatory's name,
 * typed deliberately: the dialog requires the typed signature to match the
 * signatory name so a signature cannot be an accident.
 *
 * The wording here states facts (who, in what capacity, when) and adds no
 * certification language to the agreement itself — the execution clauses on
 * the document are the template's own.
 */
import { useMemo, useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FileSignature, Loader2 } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  /** The legal entity being bound, shown read-only above the fields. */
  legalEntity: string | null;
  confirmLabel: string;
  pending?: boolean;
  onSign: (signature: { signatory_name: string; signatory_title: string; signature_typed: string }) => void;
}

export default function SignatureDialog({
  open, onOpenChange, title, description, legalEntity, confirmLabel, pending, onSign,
}: Props) {
  const [name, setName] = useState('');
  const [signatoryTitle, setSignatoryTitle] = useState('');
  const [typed, setTyped] = useState('');

  const matches = useMemo(
    () => name.trim().length > 1 && typed.trim().toLowerCase() === name.trim().toLowerCase(),
    [name, typed],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSignature className="h-5 w-5 text-primary" /> {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {legalEntity ? (
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Signing for </span>
            <span className="font-medium text-foreground">{legalEntity}</span>
          </div>
        ) : null}

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="agc-sig-name">Name of signatory</Label>
            <Input
              id="agc-sig-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Full legal name"
              autoComplete="name"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="agc-sig-title">Title / capacity</Label>
            <Input
              id="agc-sig-title"
              value={signatoryTitle}
              onChange={(event) => setSignatoryTitle(event.target.value)}
              placeholder="e.g. Director"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="agc-sig-typed">Type your full name as your signature</Label>
            <Input
              id="agc-sig-typed"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder="Signature"
              className="font-serif italic"
              autoComplete="off"
            />
            {typed && !matches ? (
              <p className="text-xs text-warning">The signature must match the signatory name exactly.</p>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button
            disabled={!matches || pending}
            onClick={() => onSign({
              signatory_name: name.trim(),
              signatory_title: signatoryTitle.trim(),
              signature_typed: typed.trim(),
            })}
          >
            {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileSignature className="mr-2 h-4 w-4" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
