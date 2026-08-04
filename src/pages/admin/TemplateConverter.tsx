/**
 * Template Builder → Converter.
 *
 * Upload a template somebody has been sending clients for years; get it back
 * set through the report design system and bound to a report format.
 *
 * ## The three steps are three steps on purpose
 *
 * Upload, review, render. The middle one is why this is a page rather than a
 * button: binding is *suggested and then confirmed*. A wrong automatic binding
 * produces a document where the "Serviceability" chapter is filled with the fee
 * schedule, which looks entirely correct and is completely wrong. So every
 * proposal arrives with its score visible and a dropdown beside it, and a weak
 * match says so in words rather than in a number nobody reads.
 *
 * ## What is taken from the upload
 *
 * Sections, their order, their nesting, and whether they are tabular. Not
 * margins, not colours, not where a logo sat — those are what the design system
 * is replacing. Carrying them across would reproduce the document rather than
 * refurbish it.
 *
 * ## Nothing the upload contained is discarded
 *
 * A section no chapter wanted is printed as an appendix, not dropped. Somebody
 * chose to put it in their template, and a converter that silently eats a third
 * of an upload is a converter nobody trusts twice. The counts are on the screen
 * for the same reason.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Check,
  Download,
  FileUp,
  Loader2,
  Palette,
  Plus,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { usePermissions } from '@/hooks/usePermissions';
import { BrandDesignSystemDialog } from '@/components/templateBuilder/converter/BrandDesignSystemDialog';
import {
  deliverConvertedTemplate,
  extractTemplate,
  proposeTemplateBinding,
} from '@/lib/reports/converted/requestTemplateConversion';
import {
  type ConvertExtractResponse,
  type ConvertRenderResponse,
  MAX_SOURCE_BYTES,
  TEXT_SUFFIXES,
} from '@/lib/reports/converted/route.pure';
import {
  bindableFormats,
  type BindingPlan,
  type ChapterBinding,
  formatName,
  WEAK_MATCH,
} from '@/lib/reports/converted/binding.pure';
import type { ReportArchetypeId } from '@/lib/reportDesign/structure.pure';

const ACCEPT = [...TEXT_SUFFIXES, '.pdf'].join(',');
/** The dropdown value for "no section", since a Select cannot hold empty. */
const NONE = '__none__';

interface DesignSystemRow {
  id: string;
  name: string;
  description: string;
  origin: string;
}

export default function TemplateConverter() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { canEdit } = usePermissions();
  const canEditTemplates = canEdit('templates');

  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState<ReportArchetypeId>(() => bindableFormats()[0]);
  const [extracting, setExtracting] = useState(false);
  const [reproposing, setReproposing] = useState(false);
  const [rendering, setRendering] = useState(false);

  const [extracted, setExtracted] = useState<ConvertExtractResponse | null>(null);
  const [plan, setPlan] = useState<BindingPlan | null>(null);
  const [designSystemId, setDesignSystemId] = useState<string | null>(null);
  const [systemDialogOpen, setSystemDialogOpen] = useState(false);
  const [result, setResult] = useState<ConvertRenderResponse | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const { data: systems = [], isLoading: systemsLoading } = useQuery({
    queryKey: ['brand-design-systems'],
    queryFn: async (): Promise<DesignSystemRow[]> => {
      const { data, error } = await supabase
        .from('brand_design_systems')
        .select('id, name, description, origin')
        .eq('is_active', true)
        .order('updated_at', { ascending: false });
      // A converter that cannot list design systems still converts under the
      // house default, so this is a warning rather than a thrown query.
      if (error) {
        console.warn('[TemplateConverter] design systems unreadable', error.message);
        return [];
      }
      return (data ?? []) as DesignSystemRow[];
    },
  });

  const { data: whitelabel } = useQuery({
    queryKey: ['whitelabel-company-name'],
    queryFn: async () => {
      const { data } = await supabase.from('whitelabel_settings').select('company_name').limit(1).maybeSingle();
      return String(data?.company_name ?? '');
    },
  });

  // The object URL is revoked when it is replaced and when the page goes away.
  // A preview iframe holding a stale blob is a memory leak with a picture in it.
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const sections = extracted?.sections ?? [];
  const sectionTitle = (index: number | null) =>
    index === null ? null : sections.find((s) => s.index === index)?.title ?? null;

  /** Sections not bound to any chapter — printed as an appendix. */
  const unbound = useMemo(() => {
    if (!plan) return [];
    const taken = new Set(plan.bindings.map((b) => b.sectionIndex).filter((i): i is number => i !== null));
    return sections.filter((s) => !taken.has(s.index));
  }, [plan, sections]);

  const boundCount = plan?.bindings.filter((b) => b.sectionIndex !== null).length ?? 0;

  const handleExtract = async () => {
    if (!file) return;
    setExtracting(true);
    setResult(null);
    try {
      const response = await extractTemplate(file, format);
      setExtracted(response);
      setPlan(response.binding as BindingPlan);
      toast.success(`Read ${response.title}`, { description: response.summary });
    } catch (e) {
      toast.error('Could not read the template', { description: (e as Error).message });
    } finally {
      setExtracting(false);
    }
  };

  const handleFormatChange = async (next: ReportArchetypeId) => {
    setFormat(next);
    if (!extracted) return;
    setReproposing(true);
    try {
      const response = await proposeTemplateBinding(extracted.conversionId, next);
      setPlan(response.binding as BindingPlan);
      setResult(null);
      toast.success(`Re-bound to ${response.formatName}`);
    } catch (e) {
      toast.error('Could not re-bind', { description: (e as Error).message });
    } finally {
      setReproposing(false);
    }
  };

  /**
   * Move one chapter's binding.
   *
   * One-to-one is enforced here as well as on the route: taking a section that
   * another chapter already holds releases it from that chapter rather than
   * duplicating it. A section bound twice prints the same three paragraphs in
   * two places and looks entirely deliberate.
   */
  const bindChapter = (chapter: string, value: string) => {
    setPlan((prev) => {
      if (!prev) return prev;
      const next = value === NONE ? null : Number(value);
      const bindings: ChapterBinding[] = prev.bindings.map((b) => {
        if (b.chapter === chapter) {
          return {
            ...b,
            sectionIndex: next,
            confirmed: true,
            confidence: next === null ? 0 : b.sectionIndex === next ? b.confidence : 100,
            reason: next === null ? 'Left for the live report.' : 'Chosen by hand.',
          };
        }
        if (next !== null && b.sectionIndex === next) {
          return {
            ...b,
            sectionIndex: null,
            confidence: 0,
            reason: `Released — "${sectionTitle(next)}" was moved to ${chapter}.`,
            confirmed: true,
          };
        }
        return b;
      });
      return {
        ...prev,
        bindings,
        unfilled: bindings.filter((b) => b.sectionIndex === null).map((b) => b.chapter),
        unbound: sections
          .filter((s) => !bindings.some((b) => b.sectionIndex === s.index))
          .map((s) => s.index),
      };
    });
    setResult(null);
  };

  const handleRender = async () => {
    if (!extracted || !plan) return;
    setRendering(true);
    try {
      const delivered = await deliverConvertedTemplate({
        conversionId: extracted.conversionId,
        format,
        binding: plan,
        designSystemId,
      });
      setResult(delivered);
      setPreviewUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(delivered.blob);
      });
      toast.success(`Converted — ${delivered.pageCount ?? '?'} pages`, {
        description: `${delivered.boundCount} bound, ${delivered.unfilledCount} left to the live report, `
          + `${delivered.appendixCount} in the appendix.`,
      });
    } catch (e) {
      toast.error('The conversion failed', { description: (e as Error).message });
    } finally {
      setRendering(false);
    }
  };

  if (!canEditTemplates) {
    return (
      <div className="container mx-auto py-8">
        <Alert>
          <TriangleAlert className="h-4 w-4" />
          <AlertTitle>Templates edit permission required</AlertTitle>
          <AlertDescription>
            Converting a template writes a design system and a document. Ask an administrator for
            edit access to Templates.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="container mx-auto space-y-6 py-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 mb-2"
            onClick={() => navigate('/admin/template-builder')}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Template Builder
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">Converter</h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Upload an existing template and have it set through the report design system, bound to
            one of the migrated report formats so the real report data can flow into it later.
          </p>
        </div>
      </div>

      {/* ── 1 · The upload ─────────────────────────────────────────────── */}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">1 · The template</CardTitle>
          <CardDescription>
            A PDF, Markdown or text file up to {MAX_SOURCE_BYTES / 1024 / 1024} MB. Only the section
            structure is taken — headings, their order and their nesting. A source exported with
            real headings converts far better than one where the headings are text sized to look
            like them.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="converter-file">File</Label>
              <input
                ref={fileInput}
                id="converter-file"
                type="file"
                accept={ACCEPT}
                className="sr-only"
                onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); }}
              />
              <Button variant="outline" onClick={() => fileInput.current?.click()}>
                <FileUp className="mr-2 h-4 w-4" />
                {file ? file.name : 'Choose a template'}
              </Button>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="converter-format">Bind to</Label>
              <Select
                value={format}
                onValueChange={(v) => handleFormatChange(v as ReportArchetypeId)}
                disabled={reproposing}
              >
                <SelectTrigger id="converter-format" className="w-[280px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {bindableFormats().map((id) => (
                    <SelectItem key={id} value={id}>{formatName(id)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button onClick={handleExtract} disabled={!file || extracting}>
              {extracting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {extracting ? 'Reading…' : 'Read the sections'}
            </Button>
          </div>

          {file && file.name.toLowerCase().endsWith('.pdf') && (
            <p className="text-xs text-muted-foreground">
              A PDF is transcribed to Markdown before its structure is read, which takes a minute or
              two for a long template. The words are transcribed as they are — nothing is
              summarised or rewritten.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── 2 · The binding ────────────────────────────────────────────── */}

      {extracted && plan && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">2 · What plays which part</CardTitle>
            <CardDescription>
              {extracted.summary} Every proposal below is a guess with its score attached — change
              anything that looks wrong before rendering.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {extracted.unstructured && (
              <Alert>
                <TriangleAlert className="h-4 w-4" />
                <AlertTitle>The upload had no headings</AlertTitle>
                <AlertDescription>
                  No heading structure was found, so the whole document became one section and
                  nothing could be bound. Re-exporting the original with real headings converts far
                  better.
                </AlertDescription>
              </Alert>
            )}

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[220px]">{formatName(format)} chapter</TableHead>
                  <TableHead>From the template</TableHead>
                  <TableHead className="w-[110px]">Match</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plan.bindings.map((binding) => (
                  <TableRow key={binding.chapter}>
                    <TableCell className="font-medium align-top">{binding.chapter}</TableCell>
                    <TableCell className="align-top">
                      <Select
                        value={binding.sectionIndex === null ? NONE : String(binding.sectionIndex)}
                        onValueChange={(v) => bindChapter(binding.chapter, v)}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>— nothing; the live report supplies it —</SelectItem>
                          {sections.map((s) => (
                            <SelectItem key={s.index} value={String(s.index)}>
                              {s.depth > 1 ? '· ' : ''}{s.title}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="mt-1 text-xs text-muted-foreground leading-snug">{binding.reason}</p>
                    </TableCell>
                    <TableCell className="align-top">
                      {binding.sectionIndex === null
                        ? <Badge variant="outline">Unfilled</Badge>
                        : binding.confidence >= WEAK_MATCH
                          ? <Badge variant="secondary">{binding.confidence}</Badge>
                          : <Badge variant="destructive">Weak · {binding.confidence}</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {unbound.length > 0 && (
              <div className="rounded-md border p-3">
                <p className="text-sm font-medium">
                  {unbound.length} unmatched {unbound.length === 1 ? 'section' : 'sections'} — kept as an appendix
                </p>
                <p className="text-xs text-muted-foreground">
                  Printed at the back rather than discarded. Nothing from the upload disappears.
                </p>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {unbound.map((s) => (
                    <li key={s.index}>
                      <Badge variant="outline">{s.title}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="text-sm text-muted-foreground">
              {boundCount} of {plan.bindings.length} chapters bound
              {plan.bindings.length - boundCount > 0
                ? `, ${plan.bindings.length - boundCount} left to the live report`
                : ''}
              {unbound.length > 0 ? `, ${unbound.length} in the appendix` : ''}.
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── 3 · The design system, and the render ──────────────────────── */}

      {extracted && plan && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">3 · How it is set</CardTitle>
            <CardDescription>
              The design system decides the palette, the typography and the furniture. It applies to
              every migrated report format too, not only this conversion.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="converter-system">Design system</Label>
                {systemsLoading ? (
                  <Skeleton className="h-9 w-[280px]" />
                ) : (
                  <Select
                    value={designSystemId ?? NONE}
                    onValueChange={(v) => { setDesignSystemId(v === NONE ? null : v); setResult(null); }}
                  >
                    <SelectTrigger id="converter-system" className="w-[280px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>House design</SelectItem>
                      {systems.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <Button variant="outline" onClick={() => setSystemDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                New design system
              </Button>

              <Button onClick={handleRender} disabled={rendering}>
                {rendering
                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  : <Palette className="mr-2 h-4 w-4" />}
                {rendering ? 'Rendering…' : result ? 'Render again' : 'Convert'}
              </Button>
            </div>

            {designSystemId && (
              <p className="text-xs text-muted-foreground">
                {systems.find((s) => s.id === designSystemId)?.description || 'No description.'}
                {systems.find((s) => s.id === designSystemId)?.origin === 'generated'
                  ? ' · Drafted by Claude'
                  : ''}
              </p>
            )}

            {result && (
              <>
                <Separator />
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <Check className="h-4 w-4 text-success" />
                    <span className="text-sm font-medium">
                      {result.fileName} · {result.pageCount ?? '?'} pages · set in {result.designSystemName}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const a = document.createElement('a');
                        a.href = previewUrl ?? result.url;
                        a.download = result.fileName;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                      }}
                    >
                      <Download className="mr-2 h-4 w-4" />
                      Download
                    </Button>
                    <Button size="sm" variant="ghost" onClick={handleRender} disabled={rendering}>
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Re-render
                    </Button>
                  </div>

                  {result.bandNote.length > 0 && (
                    <Alert>
                      <TriangleAlert className="h-4 w-4" />
                      <AlertTitle>Longer than this format usually runs</AlertTitle>
                      <AlertDescription>
                        {result.bandNote.join(' ')} A converted draft carries appendix chapters the
                        format never has, so this is worth knowing rather than an error.
                      </AlertDescription>
                    </Alert>
                  )}

                  {result.brandGaps.length > 0 && (
                    <Alert>
                      <TriangleAlert className="h-4 w-4" />
                      <AlertTitle>The brand snapshot was incomplete</AlertTitle>
                      <AlertDescription>{result.brandGaps.join('; ')}</AlertDescription>
                    </Alert>
                  )}

                  {previewUrl && (
                    <iframe
                      title={`${result.fileName} preview`}
                      src={previewUrl}
                      className="h-[70vh] w-full rounded-md border"
                    />
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      <BrandDesignSystemDialog
        open={systemDialogOpen}
        onOpenChange={setSystemDialogOpen}
        companyName={whitelabel ?? ''}
        onSaved={(id) => {
          queryClient.invalidateQueries({ queryKey: ['brand-design-systems'] });
          if (id) setDesignSystemId(id);
        }}
      />
    </div>
  );
}
