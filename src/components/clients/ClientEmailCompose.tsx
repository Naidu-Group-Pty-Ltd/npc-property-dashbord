import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { 
  Mail, 
  Loader2, 
  Paperclip, 
  X, 
  ChevronDown, 
  ChevronUp,
  Send
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { secureStorageDownload } from '@/hooks/useSecureStorage';

interface SenderMailbox {
  id: string;
  emailAddress: string;
  displayName: string;
  provider: 'outlook';
  source: 'personal' | 'admin';
  isDefault: boolean;
}

interface ClientEmailComposeProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  clientName: string;
  clientEmail: string | null;
  attachments?: Array<{
    id: string;
    file_name: string;
    file_path: string;
    file_size?: number | null;
    is_vownet_form?: boolean;
  }>;
  preSelectedAttachmentId?: string;
  defaultSubject?: string;
  defaultBody?: string;
  inlineAttachment?: { blob: Blob; fileName: string } | null;
}

export function ClientEmailCompose({
  open,
  onOpenChange,
  clientId,
  clientName,
  clientEmail,
  attachments = [],
  preSelectedAttachmentId,
  defaultSubject,
  defaultBody,
  inlineAttachment = null
}: ClientEmailComposeProps) {
  const [to, setTo] = useState(clientEmail || '');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [selectedMailbox, setSelectedMailbox] = useState<string>('');
  const [selectedAttachments, setSelectedAttachments] = useState<string[]>([]);
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const { user } = useAuth();

  // Fetch current user's mailbox only (session isolation)
  const { data: mailboxes = [], isLoading: isLoadingMailboxes, error: mailboxesError, refetch: refetchMailboxes } = useQuery<SenderMailbox[]>({
    queryKey: ['mailboxes-for-email', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from('custom_users')
        .select('id, email, personal_mailbox')
        .eq('id', user.id)
        .not('personal_mailbox', 'is', null)
        .maybeSingle();

      if (error) throw error;
      const personalMailbox = data?.personal_mailbox?.trim();
      const available: SenderMailbox[] = [];
      if (personalMailbox) {
        available.push({
          id: user.id,
          emailAddress: personalMailbox,
          displayName: data?.email || personalMailbox,
          provider: 'outlook',
          source: 'personal',
          isDefault: true,
        });
      }
      // The server remains the permission authority for this option and rejects
      // unauthorised shared-mailbox sends without exposing mailbox credentials.
      available.push({
        id: 'admin',
        emailAddress: 'Organisation shared mailbox',
        displayName: 'Organisation shared mailbox',
        provider: 'outlook',
        source: 'admin',
        isDefault: !personalMailbox,
      });
      return available;
    },
    enabled: open && !!user?.id
  });

  // Set defaults when modal opens
  useEffect(() => {
    if (open) {
      setTo(clientEmail || '');
      // Use provided defaults or fallback to generic template
      setSubject(defaultSubject || `Portfolio Update - ${clientName}`);
      setBody(defaultBody || `Dear ${clientName.split(' ')[0]},\n\nPlease find attached your updated portfolio documentation.\n\nKind regards`);
      
      // Pre-select attachment if specified
      if (preSelectedAttachmentId) {
        setSelectedAttachments([preSelectedAttachmentId]);
      }
      
      // Set default mailbox
      if (mailboxes.length > 0 && !selectedMailbox) {
        setSelectedMailbox(mailboxes.find(m => m.isDefault)?.id || mailboxes[0]?.id || '');
      }
    }
  }, [open, clientEmail, clientName, preSelectedAttachmentId, mailboxes, user?.id, defaultSubject, defaultBody]);

  const toggleAttachment = (attachmentId: string) => {
    setSelectedAttachments(prev => 
      prev.includes(attachmentId) 
        ? prev.filter(id => id !== attachmentId)
        : [...prev, attachmentId]
    );
  };

  const handleSend = async () => {
    if (!to.trim()) {
      toast.error('Please enter a recipient email');
      return;
    }
    if (!selectedMailbox) {
      toast.error('Please select a sender mailbox');
      return;
    }
    if (!subject.trim()) {
      toast.error('Please enter a subject');
      return;
    }

    const sender = mailboxes.find((mailbox) => mailbox.id === selectedMailbox);
    if (!sender) {
      toast.error('Please select a valid sender mailbox');
      return;
    }

    setIsSending(true);

    try {
      // Read attachments through the authenticated storage proxy. The email
      // function expects file content, not a user-visible signed URL.
      const attachmentData = await Promise.all(
        selectedAttachments.map(async (attachmentId) => {
          const attachment = attachments.find(a => a.id === attachmentId);
          if (!attachment) return null;

          const result = await secureStorageDownload('client-documents', attachment.file_path);
          if (!result.success || !result.content) {
            throw new Error(`Unable to attach ${attachment.file_name}`);
          }

          return {
            name: attachment.file_name,
            contentType: 'application/pdf',
            contentBytes: result.content,
          };
        })
      );

      const validAttachments = attachmentData.filter(Boolean);
      if (inlineAttachment) {
        const contentBytes = Array.from(new Uint8Array(await inlineAttachment.blob.arrayBuffer()));
        validAttachments.push({
          name: inlineAttachment.fileName,
          contentType: 'application/pdf',
          contentBytes,
        });
      }

      // Parse CC and BCC emails
      const ccEmails = cc.split(',').map(e => e.trim()).filter(Boolean);
      const bccEmails = bcc.split(',').map(e => e.trim()).filter(Boolean);

      const { data, error } = await invokeSecureFunction('send-email-reply', {
        to: to.trim(),
        cc: ccEmails,
        bcc: bccEmails,
        subject: subject.trim(),
        body: body,
        senderMailboxId: sender.source === 'personal' ? sender.id : undefined,
        mailboxSource: sender.source,
        attachments: validAttachments,
        clientId,
      });

      if (error) throw error;

      toast.success('Email sent successfully');
      onOpenChange(false);
      
      // Reset form
      setTo('');
      setCc('');
      setBcc('');
      setSubject('');
      setBody('');
      setSelectedAttachments([]);
      setShowCcBcc(false);

    } catch (error: any) {
      console.error('Send email error:', error);
      toast.error('Failed to send email: ' + error.message);
    } finally {
      setIsSending(false);
    }
  };

  const formatFileSize = (bytes: number | null | undefined) => {
    if (!bytes) return '';
    const kb = bytes / 1024;
    return kb > 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb.toFixed(0)} KB`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Compose Email
          </DialogTitle>
          <DialogDescription>
            Send an email to {clientName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Sender */}
          <div className="space-y-2">
            <Label htmlFor="client-email-sender">From</Label>
            <Select value={selectedMailbox} onValueChange={setSelectedMailbox} disabled={isLoadingMailboxes || mailboxes.length === 0}>
              <SelectTrigger id="client-email-sender" aria-label="Sender mailbox" className="w-full">
                <SelectValue placeholder={isLoadingMailboxes ? 'Loading sender mailboxes…' : mailboxes.length === 0 ? 'No sender mailbox connected' : 'Select sender mailbox'} />
              </SelectTrigger>
              <SelectContent className="z-[100]" position="popper">
                {mailboxes.map((mailbox) => (
                  <SelectItem key={mailbox.id} value={mailbox.id}>
                    {mailbox.displayName}{mailbox.source === 'personal' ? ` — ${mailbox.emailAddress}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {mailboxesError && (
              <div className="flex items-center justify-between gap-2 text-xs text-destructive" role="alert">
                <span>Unable to load sender mailboxes.</span>
                <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => refetchMailboxes()}>Retry</Button>
              </div>
            )}
            {!isLoadingMailboxes && !mailboxesError && mailboxes.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No sender mailbox is connected. Connect a mailbox in Settings to send this email.
              </p>
            )}
          </div>

          {/* Recipient */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>To</Label>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowCcBcc(!showCcBcc)}
                className="h-auto py-0 px-1 text-xs text-muted-foreground"
              >
                {showCcBcc ? <ChevronUp className="h-3 w-3 mr-1" /> : <ChevronDown className="h-3 w-3 mr-1" />}
                Cc/Bcc
              </Button>
            </div>
            <Input
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="recipient@email.com"
            />
          </div>

          {/* CC/BCC fields */}
          {showCcBcc && (
            <>
              <div className="space-y-2">
                <Label>Cc</Label>
                <Input
                  type="text"
                  value={cc}
                  onChange={(e) => setCc(e.target.value)}
                  placeholder="cc@email.com, another@email.com"
                />
              </div>
              <div className="space-y-2">
                <Label>Bcc</Label>
                <Input
                  type="text"
                  value={bcc}
                  onChange={(e) => setBcc(e.target.value)}
                  placeholder="bcc@email.com"
                />
              </div>
            </>
          )}

          {/* Subject */}
          <div className="space-y-2">
            <Label>Subject</Label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Email subject"
            />
          </div>

          {/* Body */}
          <div className="space-y-2">
            <Label>Message</Label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write your message..."
              rows={6}
            />
          </div>

          {inlineAttachment && (
            <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
              <span className="flex items-center gap-2 min-w-0"><Paperclip className="h-4 w-4 shrink-0" /> <span className="truncate">{inlineAttachment.fileName}</span></span>
              <Badge variant="secondary">{formatFileSize(inlineAttachment.blob.size)}</Badge>
            </div>
          )}

          {/* Attachments */}
          {attachments.length > 0 && (
            <>
              <Separator />
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Paperclip className="h-4 w-4" />
                  Attachments
                </Label>
                <div className="flex flex-wrap gap-2">
                  {attachments.map((attachment) => (
                    <Badge
                      key={attachment.id}
                      variant={selectedAttachments.includes(attachment.id) ? 'default' : 'outline'}
                      className="cursor-pointer transition-colors"
                      onClick={() => toggleAttachment(attachment.id)}
                    >
                      {attachment.is_vownet_form && (
                        <span className="text-xs mr-1">📊</span>
                      )}
                      {attachment.file_name}
                      {attachment.file_size && (
                        <span className="text-xs opacity-70 ml-1">
                          ({formatFileSize(attachment.file_size)})
                        </span>
                      )}
                      {selectedAttachments.includes(attachment.id) && (
                        <X className="h-3 w-3 ml-1" />
                      )}
                    </Badge>
                  ))}
                </div>
                {selectedAttachments.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {selectedAttachments.length} file(s) will be attached
                  </p>
                )}
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSend} disabled={isSending}>
            {isSending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Send className="h-4 w-4 mr-2" />
            )}
            Send Email
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
