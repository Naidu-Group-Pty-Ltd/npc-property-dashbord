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
  return <div className="space-y-2">
    <Label className="leading-5 text-foreground/90" htmlFor={id}>{label}{required ? <span className="ml-1 text-destructive" aria-hidden="true">*</span> : ''}</Label>
    <Input className="rounded-xl border-border/70 bg-background/70 shadow-inner focus-visible:border-brand-300/45" id={id} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} {...register(name, props.type === 'number' ? { setValueAs: value => value === '' ? 0 : Number(value) } : undefined)} {...props} />
    {error && <p id={`${id}-error`} role="alert" className="text-xs font-medium text-destructive">{error}</p>}
  </div>;
}
