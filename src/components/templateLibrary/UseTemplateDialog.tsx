/**
 * "Use template" — name the working copy, create it, open it in the Builder.
 *
 * The copy is assembled server-side in `manage-template-library` from the
 * verified session. This dialog supplies a name and a description and nothing
 * else; it cannot influence scope, ownership or activation state.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { useCreateWorkingCopy } from '@/hooks/useTemplateLibrary';
import type { TemplateLibraryListEntry } from '@/lib/templateLibrary/types';

interface Props {
  entry: TemplateLibraryListEntry | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const MAX_NAME = 200;

export function UseTemplateDialog({ entry, open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const createCopy = useCreateWorkingCopy();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [touched, setTouched] = useState(false);

  // Re-prefill whenever a different template is chosen, and reset the error
  // state so a previous validation message does not carry over.
  useEffect(() => {
    if (open && entry) {
      setName(`${entry.name} copy`.slice(0, MAX_NAME));
      setDescription('');
      setTouched(false);
    }
  }, [open, entry]);

  if (!entry) return null;

  const trimmed = name.trim();
  const nameError = !trimmed
    ? 'Give the working copy a name.'
    : trimmed.length > MAX_NAME
      ? `Names must be ${MAX_NAME} characters or fewer.`
      : null;

  const submit = () => {
    setTouched(true);
    if (nameError) return;
    createCopy.mutate(
      { entryId: entry.id, name: trimmed, description: description.trim() || undefined },
      {
        onSuccess: ({ templateId }) => {
          toast.success('Working copy created');
          onOpenChange(false);
          navigate(`/admin/template-builder/${templateId}`);
        },
        // Errors surface as a toast from the hook; the dialog stays open with
        // the user's input intact so a retry costs nothing.
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!createCopy.isPending) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Use this template</DialogTitle>
          <DialogDescription>
            Creates your own editable copy of <span className="font-medium text-foreground">{entry.name}</span>.
            The library template is not modified, and your copy is private to you until it is approved
            and activated.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="working-copy-name">Template name</Label>
            <Input
              id="working-copy-name"
              value={name}
              maxLength={MAX_NAME + 1}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => setTouched(true)}
              disabled={createCopy.isPending}
              aria-invalid={touched && !!nameError}
              aria-describedby={touched && nameError ? 'working-copy-name-error' : undefined}
              autoFocus
            />
            {touched && nameError && (
              <p id="working-copy-name-error" className="text-xs text-destructive">{nameError}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="working-copy-description">Description (optional)</Label>
            <Textarea
              id="working-copy-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={createCopy.isPending}
              rows={3}
              placeholder="What this version is for, or who it is for."
            />
          </div>

          {!entry.compatibility.productionReady && (
            <div className="flex gap-2 rounded-md border border-warning/40 bg-warning/5 p-3">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
              <p className="text-xs text-muted-foreground">
                This template is preview only. You can design and save your copy, but it cannot be
                activated for live report generation until this report type has a production adapter.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={createCopy.isPending}
          >
            Cancel
          </Button>
          <Button onClick={submit} disabled={createCopy.isPending || (touched && !!nameError)}>
            {createCopy.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />}
            {createCopy.isPending ? 'Creating…' : 'Create working copy'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
