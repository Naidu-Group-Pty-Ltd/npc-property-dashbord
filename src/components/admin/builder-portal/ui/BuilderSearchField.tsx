import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';

/**
 * The search control used by the Organisations, Portal users and Memberships
 * surfaces.
 *
 * Display-only: it owns no state and does no filtering. The value and the
 * change handler belong to the page, so all three surfaces continue to share
 * the one search term exactly as before.
 */
export interface BuilderSearchFieldProps {
  value: string;
  onValueChange: (value: string) => void;
  placeholder: string;
  label: string;
}

export function BuilderSearchField({ value, onValueChange, placeholder, label }: BuilderSearchFieldProps) {
  return (
    <div className="relative w-full sm:max-w-sm">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="h-9 pl-9"
      />
    </div>
  );
}
