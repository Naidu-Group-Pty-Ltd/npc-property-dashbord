import { useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  useBuilderConversation, useRetryBuilderMessage, useSendBuilderMessage,
  type ConversationMessageView, type DeliveryState,
} from '@/lib/marketplaceBuilderStock';

/**
 * The conversation with a property's builder, on its page.
 *
 * Carried over the signed Builders Network (docs/builder-portal/51). The
 * thread is read every few seconds while the page is visible — polling is the
 * whole transport on this side — and is drawn in the order it was written,
 * with the actual sender on every message. What the Command Centre sent shows
 * whether the builder has it; a message that did not arrive stays visible and
 * its writer can send it again. Each message is written with one idempotency
 * key, reused if the same send is repeated, so a timeout never doubles it.
 *
 * Writing needs Listings edit and a live activation; the server decides both
 * and says so through `can_send` / `open`.
 */

const DELIVERY_LABELS: Record<DeliveryState, string> = {
  queued: 'Sending',
  delivered: 'Delivered',
  failed: 'Not delivered',
};

const when = (iso: string) => new Date(iso).toLocaleString('en-AU');

export function BuilderStockConversation({
  stockItemId, builderName,
}: {
  stockItemId: string;
  builderName: string | null;
}) {
  const { toast } = useToast();
  const query = useBuilderConversation(stockItemId);
  const send = useSendBuilderMessage(stockItemId);
  const retry = useRetryBuilderMessage(stockItemId);
  const [draft, setDraft] = useState('');
  const [clientMessageId, setClientMessageId] = useState(() => crypto.randomUUID());

  const conversation = query.data;
  const messages = conversation?.messages ?? [];
  const who = builderName ?? 'the builder';

  const submit = async () => {
    const body = draft.trim();
    if (!body || send.isPending) return;
    try {
      await send.mutateAsync({ clientMessageId, body });
      setDraft('');
      setClientMessageId(crypto.randomUUID());
    } catch (error) {
      toast({
        title: 'Your message was not sent',
        description: error instanceof Error ? error.message : 'Try again shortly.',
        variant: 'destructive',
      });
    }
  };

  const sendAgain = async (messageId: string) => {
    try {
      await retry.mutateAsync(messageId);
    } catch (error) {
      toast({
        title: 'That message could not be sent again',
        description: error instanceof Error ? error.message : 'Try again shortly.',
        variant: 'destructive',
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Messages with {who}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {query.isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading the conversation…
          </p>
        ) : query.error && !conversation ? (
          <p className="text-sm text-muted-foreground">
            The conversation could not be loaded just now. It will try again shortly.
          </p>
        ) : messages.length ? (
          <div role="log" aria-label={`Messages with ${who}`} aria-live="polite" className="max-h-[28rem] space-y-3 overflow-y-auto pr-1">
            {messages.map((message) => (
              <Message key={message.id} message={message} onRetry={sendAgain} retrying={retry.isPending} />
            ))}
          </div>
        ) : conversation?.open ? (
          <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            No messages yet. Anything you write here goes to {who} about this property.
          </p>
        ) : null}

        {conversation && !conversation.open ? (
          <p className="text-sm text-muted-foreground">
            {messages.length
              ? 'This property is no longer activated here, so the conversation is closed. Its history stays.'
              : `Activate this property to message ${who} about it.`}
          </p>
        ) : null}

        {conversation?.can_send ? (
          <div className="space-y-2">
            <Textarea
              aria-label="Message"
              placeholder={`Write to ${who}`}
              value={draft}
              maxLength={4000}
              onChange={(event) => setDraft(event.target.value)}
              disabled={send.isPending}
              rows={3}
            />
            <div className="flex justify-end">
              <Button type="button" onClick={() => void submit()} disabled={send.isPending || !draft.trim()}>
                {send.isPending
                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                  : <Send className="mr-2 h-4 w-4" aria-hidden />}
                Send
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Message({
  message, onRetry, retrying,
}: {
  message: ConversationMessageView;
  onRetry: (id: string) => void;
  retrying: boolean;
}) {
  const ours = message.side === 'command_centre';
  return (
    <article
      className={cn(
        'max-w-[85%] rounded-lg border px-3 py-2 text-sm',
        ours ? 'ml-auto border-primary/30 bg-primary/5' : 'mr-auto border-border bg-card',
      )}
    >
      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{message.sender_display_name}</span>
        {' · '}{ours ? 'Your team' : 'Builder'}{' · '}{when(message.sent_at)}
      </p>
      <p className="mt-1 whitespace-pre-wrap break-words text-foreground">{message.body}</p>
      {message.delivery_state ? (
        <p className={cn('mt-1 flex items-center gap-2 text-xs',
          message.delivery_state === 'failed' ? 'text-destructive' : 'text-muted-foreground')}>
          <span>{DELIVERY_LABELS[message.delivery_state]}</span>
          {message.can_retry ? (
            <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-xs"
              onClick={() => onRetry(message.id)} disabled={retrying}>
              Send again
            </Button>
          ) : null}
        </p>
      ) : null}
    </article>
  );
}
