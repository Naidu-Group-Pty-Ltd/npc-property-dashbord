import type { InputHTMLAttributes } from 'react';
import { useFormContext, useFormState } from 'react-hook-form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function errorAt(errors: unknown, path: string): string | undefined {
  let value: any = errors;
  for (const key of path.split('.')) value = value?.[key];
  return typeof value?.message === 'string' ? value.message : undefined;
}
export function FormField({ name, label, required, ...props }: { name: string; label: string; required?: boolean } & InputHTMLAttributes<HTMLInputElement>) {
  const { register, control } = useFormContext();
  const { errors } = useFormState({ control, name, exact: true });
  const error = errorAt(errors, name); const id = `advanced-${name.replace(/\./g, '-')}`;
  return <div className="space-y-1.5">
    <Label className="text-xs font-semibold leading-5 text-foreground/90" htmlFor={id}>{label}{required ? <><span className="ml-1 text-destructive" aria-hidden="true">*</span><span className="sr-only"> (required)</span></> : ''}</Label>
    <Input className="h-11 rounded-xl border-border/80 bg-background/80 shadow-inner transition-[border-color,box-shadow,background-color] duration-150 placeholder:text-muted-foreground/80 hover:border-border focus-visible:border-brand-300/55 focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-destructive/20" id={id} aria-required={required} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} {...register(name, props.type === 'number' ? { setValueAs: value => value === '' ? 0 : Number(value) } : undefined)} {...props} />
    {error && <p id={`${id}-error`} role="alert" className="text-xs font-medium text-destructive">{error}</p>}
  </div>;
}
