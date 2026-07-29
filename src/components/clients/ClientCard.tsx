import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { 
  Building2, 
  DollarSign, 
  TrendingUp, 
  TrendingDown,
  MoreVertical,
  Eye,
  Trash2,
  ExternalLink,
  RefreshCw,
  Loader2,
  Star,
  Target,
  Phone
} from 'lucide-react';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { FollowUpFlag } from './FollowUpFlag';
import { SyncToGHLDialog } from './SyncToGHLDialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';

// Pipeline stage colors
const getPipelineStageColor = (status: string | null | undefined) => {
  if (!status) return 'bg-muted';
  if (status.includes('No Show') || status.includes('No Response')) return 'bg-destructive/60';
  if (status.includes('Discovery')) return 'bg-accent';
  if (status.includes('Strategy')) return 'bg-accent';
  if (status.includes('IFC') || status.includes('Initial Financial')) return 'bg-info';
  if (status.includes('Finance Link')) return 'bg-success';
  if (status.includes('FA -')) return 'bg-success';
  if (status.includes('POP')) return 'bg-accent';
  return 'bg-info';
};

interface ClientCardProps {
  client: {
    id: string;
    primary_first_name: string;
    primary_surname: string;
    primary_email: string | null;
    primary_mobile: string | null;
    secondary_first_name: string | null;
    secondary_surname: string | null;
    ghl_contact_id: string | null;
    ghl_sync_status: string | null;
    total_portfolio_value: number;
    total_debt: number;
    net_monthly_cash_flow: number;
    created_at: string;
    is_favorite?: boolean;
    client_properties?: { id: string }[];
    pipeline_status?: string | null;
    follow_up_date?: string | null;
    deal_status?: string;
  };
  ghlLocationId?: string | null;
  onView: () => void;
  onDelete?: () => void;
  onSyncComplete?: () => void;
  isSelected?: boolean;
  onSelect?: (checked: boolean) => void;
}


function MetricTile({ icon: Icon, label, value, compact = false }: { icon: typeof Building2; label: string; value: string; compact?: boolean }) {
  return (
    <div className="min-w-0 rounded-2xl border border-border bg-muted/90 p-3 shadow-sm transition-colors group-hover:border-brand-300/60 dark:border-white/10 dark:bg-white/[0.055] dark:group-hover:border-brand-500/25">
      <div className="flex items-center gap-1.5 text-muted-foreground dark:text-muted-foreground">
        <Icon className="h-3.5 w-3.5 shrink-0 text-brand-500 dark:text-brand-200/80" />
        <span className="truncate text-xs font-semibold">{label}</span>
      </div>
      <p className={cn('mt-2 truncate font-bold leading-none text-foreground dark:text-white', compact ? 'text-base sm:text-lg' : 'text-2xl')}>{value}</p>
    </div>
  );
}

export function ClientCard({ client, ghlLocationId, onView, onDelete, onSyncComplete, isSelected, onSelect }: ClientCardProps) {
  const [isSyncing, setIsSyncing] = useState(false);
  const [showSyncDialog, setShowSyncDialog] = useState(false);
  const queryClient = useQueryClient();
  const propertyCount = client.client_properties?.length || 0;
  const isPositiveCashFlow = Number(client.net_monthly_cash_flow) >= 0;
  
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: 'AUD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const toggleFavoriteMutation = useMutation({
    mutationFn: async () => {
      // Use secure Edge Function with HttpOnly cookie auth
      try {
        const { data, error } = await invokeSecureFunction('manage-client-data', {
          operation: 'update',
          table: 'clients',
          clientId: client.id,
          data: { is_favorite: !client.is_favorite },
        });
        
        if (!error && data?.success) {
          return;
        }
      } catch (err) {
        console.warn('Edge function failed, falling back to direct query:', err);
      }
      
      // Fallback to direct query
      const { error } = await supabase
        .from('clients')
        .update({ is_favorite: !client.is_favorite })
        .eq('id', client.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      toast.success(client.is_favorite ? 'Removed from favorites' : 'Added to favorites');
    },
    onError: (error: any) => {
      toast.error('Failed to update favorite: ' + error.message);
    }
  });

  const handleSyncToGHL = () => {
    setShowSyncDialog(true);
  };

  const getGHLStatusBadge = () => {
    if (isSyncing) {
      return <Badge variant="secondary" className="gap-1 rounded-full border-brand-300/40 bg-brand-100 px-2.5 text-brand-800 shadow-sm dark:bg-brand-400/15 dark:text-brand-100 dark:shadow-brand-950/20"><Loader2 className="h-3 w-3 animate-spin" />Syncing...</Badge>;
    }
    switch (client.ghl_sync_status) {
      case 'synced':
        return <Badge variant="default" className="rounded-full border border-success/60 bg-success/10 px-2.5 font-semibold text-success shadow-sm dark:border-success/35 dark:bg-[linear-gradient(135deg,rgba(16,185,129,0.18),rgba(20,184,166,0.1))] dark:text-success dark:shadow-success/25">Synced</Badge>;
      case 'pending':
        return <Badge variant="secondary" className="rounded-full border border-brand-300/50 bg-brand-50 px-2.5 font-semibold text-brand-800 shadow-sm dark:border-brand-300/30 dark:bg-brand-400/15 dark:text-brand-100 dark:shadow-brand-950/20">Pending Sync</Badge>;
      case 'error':
        return <Badge variant="destructive" className="rounded-full border border-destructive/60 bg-destructive/10 px-2.5 text-destructive shadow-sm dark:border-destructive/30 dark:bg-destructive/15 dark:text-destructive-foreground dark:shadow-destructive/20">Sync Error</Badge>;
      default:
        return <Badge variant="outline" className="rounded-full border-border/70 bg-background/60 px-2.5 text-muted-foreground">Not Synced</Badge>;
    }
  };

  const fullName = `${client.primary_first_name} ${client.primary_surname}`.trim() || 'Unknown client';
  const hasSecondary = client.secondary_first_name && client.secondary_surname;
  const secondaryName = hasSecondary 
    ? `${client.secondary_first_name} ${client.secondary_surname}` 
    : null;

  return (
    <Card
      className={cn(
        'group relative flex h-full min-h-[20rem] overflow-hidden rounded-3xl border shadow-lg transition-all duration-300 hover:-translate-y-1 hover:shadow-xl focus-within:ring-2 focus-within:ring-brand-300/35',
        'border-border bg-white text-foreground shadow-foreground/70 hover:border-brand-300/70',
        'dark:border-white/10 dark:bg-[linear-gradient(145deg,rgba(24,24,27,0.96),rgba(3,7,18,0.9))] dark:text-white dark:shadow-black/25 dark:hover:border-brand-400/45 dark:hover:shadow-brand-950/35',
        client.is_favorite && 'ring-2 ring-brand-400/45',
        isSelected && 'border-brand-400/80 ring-2 ring-brand-300/35 dark:shadow-brand-950/40'
      )}
    >
      {isSelected && (
        <div className="pointer-events-none absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b from-brand-300 via-brand-500 to-brand-600 shadow-[0_0_18px_rgba(245,158,11,0.45)]" />
      )}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-transparent via-brand-400/80 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      <div className="pointer-events-none absolute -right-16 -top-16 h-36 w-36 rounded-full bg-brand-300/20 blur-3xl dark:bg-brand-500/10" />

      <div className="relative flex min-w-0 flex-1 flex-col p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'h-8 w-8 shrink-0 rounded-full border transition-all duration-200 focus-visible:ring-2 focus-visible:ring-brand-300/70 focus-visible:ring-offset-0',
                client.is_favorite
                  ? 'border-brand-400/60 bg-brand-100 text-brand-600 shadow-sm hover:scale-105 hover:bg-brand-200 dark:border-brand-300/45 dark:bg-brand-400/15 dark:text-brand-300 dark:hover:bg-brand-400/20'
                  : 'border-border bg-muted text-muted-foreground hover:scale-105 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-600 dark:border-white/10 dark:bg-white/5 dark:text-muted-foreground dark:hover:border-brand-300/45 dark:hover:bg-brand-400/10 dark:hover:text-brand-300'
              )}
              onClick={() => toggleFavoriteMutation.mutate()}
              disabled={toggleFavoriteMutation.isPending}
              aria-label={client.is_favorite ? `Remove ${fullName} from active clients` : `Mark ${fullName} as active client`}
            >
              <Star className={cn('h-4 w-4 transition-all duration-200', client.is_favorite && 'fill-brand-400 text-brand-500 dark:text-brand-400')} />
            </Button>

            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <div className="min-w-0">
                <h3 className="truncate text-base font-bold leading-tight tracking-tight text-foreground dark:text-white">{fullName}</h3>
                {secondaryName && <p className="truncate text-sm text-muted-foreground dark:text-muted-foreground">& {secondaryName}</p>}
              </div>

              <div className="min-w-0 rounded-2xl border border-border bg-muted/90 px-3 py-2 shadow-inner dark:border-white/10 dark:bg-white/[0.06]">
                <p className="truncate text-xs font-medium text-muted-foreground dark:text-foreground">{client.primary_email || 'Email not provided'}</p>
                <p className="mt-1 flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground dark:text-muted-foreground">
                  <Phone className="h-3 w-3 shrink-0 text-brand-500 dark:text-brand-200/80" />
                  <span className="truncate">{client.primary_mobile || 'Phone not provided'}</span>
                </p>
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-muted p-1 shadow-sm dark:border-white/10 dark:bg-white/[0.06]">
            <div className="rounded-full border border-border bg-white shadow-sm dark:border-white/10 dark:bg-white/5">
              <FollowUpFlag clientId={client.id} followUpDate={client.follow_up_date} size="sm" />
            </div>
            {onSelect && (
              <div className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-white dark:border-white/10 dark:bg-white/5">
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={onSelect}
                  aria-label={`Select ${fullName}`}
                  className="rounded-md border-brand-500/45 bg-background/70 shadow-sm focus-visible:ring-2 focus-visible:ring-brand-300/70 data-[state=checked]:border-brand-300 data-[state=checked]:bg-brand-500 data-[state=checked]:text-black"
                />
              </div>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full border border-border bg-white text-muted-foreground shadow-sm transition-all hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 focus-visible:ring-2 focus-visible:ring-brand-300/70 focus-visible:ring-offset-0 dark:border-white/10 dark:bg-white/5 dark:text-muted-foreground dark:hover:border-brand-400/50 dark:hover:bg-brand-500/10 dark:hover:text-brand-200" aria-label={`Open actions for ${fullName}`}>
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={8} className="w-48 rounded-xl border-brand-400/20 bg-popover p-1.5 text-sm shadow-2xl">
                <DropdownMenuItem onClick={onView} className="rounded-lg focus:bg-brand-500/10"><Eye className="h-4 w-4 mr-2" />View Details</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSyncToGHL} disabled={isSyncing} className="rounded-lg focus:bg-brand-500/10"><RefreshCw className={`h-4 w-4 mr-2 ${isSyncing ? 'animate-spin' : ''}`} />{isSyncing ? 'Syncing...' : 'Sync to GHL'}</DropdownMenuItem>
                {client.ghl_contact_id && ghlLocationId && <DropdownMenuItem asChild className="rounded-lg focus:bg-brand-500/10"><a href={`https://app.gohighlevel.com/v2/location/${ghlLocationId}/contacts/detail/${client.ghl_contact_id}`} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4 mr-2" />View in GHL</a></DropdownMenuItem>}
                {onDelete && <><DropdownMenuSeparator /><DropdownMenuItem onClick={onDelete} className="rounded-lg text-destructive focus:bg-destructive/10 focus:text-destructive"><Trash2 className="h-4 w-4 mr-2" />Delete</DropdownMenuItem></>}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <MetricTile icon={Building2} label="Properties" value={propertyCount.toLocaleString()} />
          <MetricTile icon={DollarSign} label="Portfolio" value={formatCurrency(Number(client.total_portfolio_value))} compact />
        </div>

        <div className={cn('mt-3 flex items-center justify-between gap-3 rounded-2xl border px-3 py-3 shadow-inner', isPositiveCashFlow ? 'border-success/30 bg-success/10 text-success dark:border-success/15 dark:bg-success/[0.07] dark:text-success' : 'border-destructive/30 bg-destructive/10 text-destructive dark:border-destructive/15 dark:bg-destructive/[0.07] dark:text-destructive')}>
          <div className="flex min-w-0 items-center gap-2">
            {isPositiveCashFlow ? <TrendingUp className="h-4 w-4 shrink-0" /> : <TrendingDown className="h-4 w-4 shrink-0" />}
            <span className="truncate text-sm font-semibold">Monthly Cash Flow</span>
          </div>
          <span className="shrink-0 font-bold tabular-nums">{formatCurrency(Number(client.net_monthly_cash_flow))}</span>
        </div>

        <div className="mt-3 space-y-2">
          {client.pipeline_status && client.pipeline_status !== 'New Lead' && (
            <div className="flex items-center justify-between gap-2 border-t border-border pt-2 dark:border-white/10">
              <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground dark:text-muted-foreground"><Target className="h-3.5 w-3.5" />Pipeline</span>
              <Badge className={cn(getPipelineStageColor(client.pipeline_status), 'max-w-[11rem] truncate text-xs text-foreground dark:text-white')}>{client.pipeline_status}</Badge>
            </div>
          )}
          {client.deal_status === 'closed' && (
            <div className="flex items-center justify-between border-t border-border pt-2 dark:border-white/10"><span className="text-xs text-muted-foreground dark:text-muted-foreground">Deal Status</span><Badge className="bg-success text-foreground dark:text-white hover:bg-success">🏆 Deal Closed</Badge></div>
          )}
        </div>

        <div className="mt-auto pt-4">
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-muted px-3 py-2.5 dark:border-white/10 dark:bg-white/[0.05]">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground dark:text-muted-foreground">GHL Status</span>
            {getGHLStatusBadge()}
          </div>
        </div>
      </div>
      <SyncToGHLDialog
        open={showSyncDialog}
        onOpenChange={setShowSyncDialog}
        clientId={client.id}
        clientName={fullName}
        onSyncComplete={onSyncComplete}
      />
    </Card>
  );
}
