import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Filter, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export interface ClientFiltersState {
  portfolioMin: number | null;
  portfolioMax: number | null;
  cashFlowStatus: 'all' | 'positive' | 'negative';
  syncStatus: 'all' | 'synced' | 'pending' | 'error' | 'not_synced';
  reviewStatus: 'all' | 'overdue' | 'due_soon' | 'upcoming' | 'no_review';
  reviewFrequency: 'all' | 'quarterly' | 'bi_annual' | 'annual';
  followUpStatus: 'all' | 'flagged' | 'overdue' | 'upcoming' | 'none';
}

interface ClientFiltersProps {
  filters: ClientFiltersState;
  onFiltersChange: (filters: ClientFiltersState) => void;
}

export const defaultFilters: ClientFiltersState = {
  portfolioMin: null,
  portfolioMax: null,
  cashFlowStatus: 'all',
  syncStatus: 'all',
  reviewStatus: 'all',
  reviewFrequency: 'all',
  followUpStatus: 'all',
};

export function ClientFilters({ filters, onFiltersChange }: ClientFiltersProps) {
  const [isOpen, setIsOpen] = useState(false);

  const activeFilterCount = [
    filters.portfolioMin !== null || filters.portfolioMax !== null,
    filters.cashFlowStatus !== 'all',
    filters.syncStatus !== 'all',
    filters.reviewStatus !== 'all',
    filters.reviewFrequency !== 'all',
    filters.followUpStatus !== 'all',
  ].filter(Boolean).length;

  const handleReset = () => {
    onFiltersChange(defaultFilters);
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-11 gap-2 rounded-xl border-brand-500/25 bg-background/70 px-4 font-semibold text-muted-foreground shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand-400/50 hover:bg-brand-500/10 hover:text-brand-100 hover:shadow-[0_12px_30px_rgba(245,158,11,0.12)] focus-visible:ring-2 focus-visible:ring-brand-400/35 focus-visible:ring-offset-2 focus-visible:ring-offset-background data-[state=open]:border-brand-300/55 data-[state=open]:bg-brand-500/15 data-[state=open]:text-brand-100">
          <Filter className="h-4 w-4 text-brand-200/80" />
          Filters
          {activeFilterCount > 0 && (
            <Badge variant="secondary" className="flex h-5 min-w-5 items-center justify-center rounded-full border border-brand-300/25 bg-brand-400 px-1.5 text-xs font-bold text-black shadow-sm shadow-brand-500/20">
              {activeFilterCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 rounded-2xl border-brand-500/20 bg-card/95 shadow-2xl shadow-sm dark:shadow-black/30 backdrop-blur" align="start">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-medium">Filters</h4>
            {activeFilterCount > 0 && (
              <Button variant="ghost" size="sm" onClick={handleReset} className="h-8 rounded-lg px-2 text-xs transition-colors hover:bg-brand-500/10 hover:text-brand-100 focus-visible:ring-2 focus-visible:ring-brand-300/35">
                <X className="h-3 w-3 mr-1" />
                Clear all
              </Button>
            )}
          </div>

          {/* Portfolio Value Range */}
          <div className="space-y-2">
            <Label className="text-sm">Portfolio Value</Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                placeholder="Min"
                aria-label="Minimum portfolio value"
                value={filters.portfolioMin ?? ''}
                onChange={(e) => onFiltersChange({
                  ...filters,
                  portfolioMin: e.target.value ? Number(e.target.value) : null
                })}
                className="h-8"
              />
              <span className="text-muted-foreground">-</span>
              <Input
                type="number"
                placeholder="Max"
                aria-label="Maximum portfolio value"
                value={filters.portfolioMax ?? ''}
                onChange={(e) => onFiltersChange({
                  ...filters,
                  portfolioMax: e.target.value ? Number(e.target.value) : null
                })}
                className="h-8"
              />
            </div>
          </div>

          {/* Cash Flow Status */}
          <div className="space-y-2">
            <Label className="text-sm">Cash Flow Status</Label>
            <Select
              value={filters.cashFlowStatus}
              onValueChange={(value: 'all' | 'positive' | 'negative') => 
                onFiltersChange({ ...filters, cashFlowStatus: value })
              }
            >
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="positive">Positive Cash Flow</SelectItem>
                <SelectItem value="negative">Negative Cash Flow</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* GHL Sync Status */}
          <div className="space-y-2">
            <Label className="text-sm">GHL Sync Status</Label>
            <Select
              value={filters.syncStatus}
              onValueChange={(value: 'all' | 'synced' | 'pending' | 'error' | 'not_synced') => 
                onFiltersChange({ ...filters, syncStatus: value })
              }
            >
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="synced">Synced</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="error">Error</SelectItem>
                <SelectItem value="not_synced">Not Synced</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Review Status */}
          <div className="space-y-2">
            <Label className="text-sm">Review Status</Label>
            <Select
              value={filters.reviewStatus}
              onValueChange={(value: 'all' | 'overdue' | 'due_soon' | 'upcoming' | 'no_review') => 
                onFiltersChange({ ...filters, reviewStatus: value })
              }
            >
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
                <SelectItem value="due_soon">Due Soon (7 days)</SelectItem>
                <SelectItem value="upcoming">Upcoming (30 days)</SelectItem>
                <SelectItem value="no_review">No Review Scheduled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Review Frequency */}
          <div className="space-y-2">
            <Label className="text-sm">Review Frequency</Label>
            <Select
              value={filters.reviewFrequency}
              onValueChange={(value: 'all' | 'quarterly' | 'bi_annual' | 'annual') => 
                onFiltersChange({ ...filters, reviewFrequency: value })
              }
            >
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="quarterly">Quarterly</SelectItem>
                <SelectItem value="bi_annual">Bi-Annual</SelectItem>
                <SelectItem value="annual">Annual</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Follow-Up Status */}
          <div className="space-y-2">
            <Label className="text-sm">Follow-Up Status</Label>
            <Select
              value={filters.followUpStatus}
              onValueChange={(value: 'all' | 'flagged' | 'overdue' | 'upcoming' | 'none') => 
                onFiltersChange({ ...filters, followUpStatus: value })
              }
            >
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="flagged">Has Follow-Up</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
                <SelectItem value="upcoming">Upcoming (7 days)</SelectItem>
                <SelectItem value="none">No Follow-Up</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
