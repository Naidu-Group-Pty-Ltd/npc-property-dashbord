/**
 * The agreement as a digital document — the in-app representation.
 *
 * Renders the LOCKED content model with the bound field values, live: the
 * wizard's preview updates as fields are typed, the partner's review room
 * reads the frozen values of the issued version, and both are this one
 * component, so what the issuer previews is what the partner reviews.
 *
 * Presentation only. The wording comes from the content module and is not
 * editable here or anywhere else in the browser. Unfilled fields print the
 * template's original `<<INSERT>>` brackets, muted, exactly like the PDF.
 * Semantic tokens only — this surface renders inside both the Command Centre
 * (light) and the Finance Portal (dark palettes).
 */
import { createContext, Fragment, useContext, useMemo, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import InlineFieldEditor from './InlineFieldEditor';
import {
  agreementTemplate,
  placeholderForToken,
  isAgreementFieldVisible,
  EXECUTION_PANEL_LINES,
  type AgreementBlock,
  type AgreementFieldDef,
  type AgreementFieldValues,
  type AgreementSectionDef,
  type AgreementTemplateKey,
  type ExecutionPartyRole,
  type GridCellDef,
} from '@/lib/agreements';

export interface DigitalSignature {
  party_role: string;
  legal_entity: string | null;
  signatory_name: string | null;
  signatory_title: string | null;
  signed_at: string | null;
  signature_method?: string | null;
}

/**
 * Direct editing, when the caller owns the field values.
 *
 * Only the issuer's own draft surface passes this — the partner review room and
 * every issued version render read-only, because an issued agreement's wording
 * and figures are frozen. `rawValues` is the unformatted store the wizard's step
 * forms write; the document keeps printing the projected values.
 */
export interface DigitalEditContext {
  defs: readonly AgreementFieldDef[];
  rawValues: AgreementFieldValues;
  onChange: (key: string, value: unknown) => void;
}

interface Props {
  templateKey: AgreementTemplateKey;
  values: AgreementFieldValues;
  signatures?: DigitalSignature[];
  /** Section E (email pack) — template/manual mode only. */
  includeTemplatePack?: boolean;
  /** The issuing organisation's logo, when configured. */
  logoUrl?: string | null;
  /** Version label shown on the cover ("1.0", "Draft"). */
  versionLabel?: string;
  /** When set, every configurable value on the page is editable in place. */
  edit?: DigitalEditContext | null;
  className?: string;
}

const TOKEN_SPLIT = /(\{\{[a-z0-9_]+\}\})/g;

interface EditLookup {
  defs: Map<string, AgreementFieldDef>;
  rawValues: AgreementFieldValues;
  onChange: (key: string, value: unknown) => void;
}

const EditContext = createContext<EditLookup | null>(null);

/** The editable definition for a token, or null when the surface is read-only. */
function useEditableDef(token: string | null | undefined) {
  const edit = useContext(EditContext);
  if (!edit || !token) return null;
  const def = edit.defs.get(token);
  if (!def) return null;
  return { def, edit };
}

/**
 * One value on the page: read-only text, or the same text as an in-place editor.
 * Every printed value routes through here so editability is a single decision.
 */
function EditableValue({
  token,
  filled,
  className,
  children,
}: {
  token?: string | null;
  filled: boolean;
  className?: string;
  children: ReactNode;
}) {
  const editable = useEditableDef(token);
  if (!editable) {
    return <span className={className}>{children}</span>;
  }
  return (
    <InlineFieldEditor
      def={editable.def}
      rawValue={editable.edit.rawValues[editable.def.key]}
      filled={filled}
      onChange={editable.edit.onChange}
    >
      {children}
    </InlineFieldEditor>
  );
}

function BoundText({
  text,
  templateKey,
  values,
}: {
  text: string;
  templateKey: AgreementTemplateKey;
  values: AgreementFieldValues;
}) {
  const parts = text.split(TOKEN_SPLIT);
  return (
    <>
      {parts.map((part, index) => {
        const match = /^\{\{([a-z0-9_]+)\}\}$/.exec(part);
        if (!match) return <Fragment key={index}>{part}</Fragment>;
        const token = match[1];
        const value = values[token];
        const filled = value !== null && value !== undefined && String(value).trim() !== '';
        return (
          <EditableValue
            key={index}
            token={token}
            filled={filled}
            className={filled ? 'font-medium text-foreground' : 'text-muted-foreground/70'}
          >
            {filled ? String(value) : placeholderForToken(templateKey, token)}
          </EditableValue>
        );
      })}
    </>
  );
}

function PanelLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-wider text-primary">
      {children}
    </div>
  );
}

function NoteCard({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/30 px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <p className="mt-1 text-sm leading-relaxed text-foreground/90">{children}</p>
    </div>
  );
}

function ChoiceValue({
  cell,
  templateKey,
  values,
}: {
  cell: GridCellDef;
  templateKey: AgreementTemplateKey;
  values: AgreementFieldValues;
}) {
  const choice = cell.choice!;
  const edit = useContext(EditContext);
  const choiceDef = edit?.defs.get(choice.fieldKey) ?? null;
  const raw = values[choice.fieldKey];
  const selected = raw === null || raw === undefined ? '' : String(raw);
  const optionValues = choice.options.map((option) => option.value);
  const customValue = selected && !optionValues.includes(selected) ? selected : '';

  return (
    <div className="space-y-0.5">
      {choice.lead ? <div className="text-sm text-foreground/90">{choice.lead}</div> : null}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {choice.options.map((option) => {
          const isOther = option.value === 'other';
          const checked = selected === option.value || (isOther && Boolean(customValue));
          const otherText = isOther
            ? String((choice.otherFieldKey ? values[choice.otherFieldKey] : customValue) ?? '').trim()
            : '';
          const body = (
            <>
              <span aria-hidden className="text-base leading-none">{checked ? '☑' : '☐'}</span>
              <span className={checked ? 'font-medium' : undefined}>{option.label}</span>
            </>
          );
          const tone = cn('inline-flex items-baseline gap-1.5 text-sm', checked ? 'text-foreground' : 'text-muted-foreground');
          return (
            <span key={option.value} className="inline-flex items-baseline gap-1.5">
              {/* Editable surfaces tick the box in place; read-only ones print it. */}
              {choiceDef && edit ? (
                <button
                  type="button"
                  title={`Select — ${option.label}`}
                  onClick={() => edit.onChange(choiceDef.key, option.value)}
                  className={cn(tone, 'rounded px-1 transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring')}
                >
                  {body}
                </button>
              ) : (
                <span className={tone}>{body}</span>
              )}
              {/* The free text behind "Other" is its own field, so it edits on its own. */}
              {isOther && choice.otherFieldKey ? (
                <EditableValue
                  token={choice.otherFieldKey}
                  filled={Boolean(otherText)}
                  className={otherText ? 'font-medium text-foreground' : 'text-muted-foreground/70'}
                >
                  {otherText || (checked ? placeholderForToken(templateKey, choice.otherFieldKey) : '')}
                </EditableValue>
              ) : otherText ? (
                <span className="font-medium text-foreground">{otherText}</span>
              ) : null}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function GridCell({
  cell,
  templateKey,
  values,
}: {
  cell: GridCellDef;
  templateKey: AgreementTemplateKey;
  values: AgreementFieldValues;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/50 px-3.5 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{cell.label}</div>
      <div className="mt-1 text-sm leading-relaxed">
        {cell.choice ? (
          <ChoiceValue cell={cell} templateKey={templateKey} values={values} />
        ) : cell.template ? (
          <BoundText text={cell.template} templateKey={templateKey} values={values} />
        ) : cell.fieldKey ? (
          <BoundText text={`{{${cell.fieldKey}}}`} templateKey={templateKey} values={values} />
        ) : (
          <span className="text-muted-foreground/70">{cell.text}</span>
        )}
      </div>
    </div>
  );
}

const RULE = '______________________________';
const DATE_RULE = '____ / ____ / ______';
const WITNESS_RULE = '__________________';

function SignaturePanel({
  role,
  title,
  templateKey,
  values,
  signature,
}: {
  role: ExecutionPartyRole;
  title: string;
  templateKey: AgreementTemplateKey;
  values: AgreementFieldValues;
  signature: DigitalSignature | null;
}) {
  const entityValue = signature?.legal_entity
    ?? (role === 'partner' ? values.fp_legal_name : role === 'loan_writer' ? values.lw_entity : values.ba_legal_name);
  const nameValue = signature?.signatory_name
    ?? (role === 'partner' ? values.partner_signatory_name : role === 'principal' ? values.principal_signatory_name : null);
  const titleValue = signature?.signatory_title
    ?? (role === 'partner' ? values.partner_signatory_title : role === 'principal' ? values.principal_signatory_title : null);

  const line = (labelText: string, value: unknown, rule: string, token?: string | null) => {
    const text = String(value ?? '').trim();
    // A countersigned line is history — never editable, whatever the surface.
    const editToken = signature ? null : token;
    return (
      <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
        <span className="text-xs text-muted-foreground">{labelText}</span>
        <EditableValue
          token={editToken}
          filled={Boolean(text)}
          className={text ? 'font-medium text-foreground' : 'tracking-wider text-muted-foreground/50'}
        >
          {text || rule}
        </EditableValue>
      </div>
    );
  };

  const entityToken = role === 'partner' ? 'fp_legal_name' : role === 'loan_writer' ? 'lw_entity' : 'ba_legal_name';
  const nameToken = role === 'partner' ? 'partner_signatory_name' : role === 'principal' ? 'principal_signatory_name' : null;
  const titleToken = role === 'partner' ? 'partner_signatory_title' : role === 'principal' ? 'principal_signatory_title' : null;

  return (
    <div className="rounded-lg border border-border bg-card/50 p-4">
      <PanelLabel>{title}</PanelLabel>
      <div className="mt-3 space-y-2.5">
        {line(EXECUTION_PANEL_LINES.legalEntity, entityValue, RULE, entityToken)}
        {line(EXECUTION_PANEL_LINES.signatoryName, nameValue, RULE, nameToken)}
        {line(EXECUTION_PANEL_LINES.signatoryTitle, titleValue, RULE, titleToken)}
        <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="text-xs text-muted-foreground">{EXECUTION_PANEL_LINES.signature}</span>
          {signature ? (
            <span className="border-b border-border font-serif text-lg italic text-foreground">
              {signature.signatory_name}
            </span>
          ) : (
            <span className="tracking-wider text-muted-foreground/50">{RULE}</span>
          )}
        </div>
        {line(
          EXECUTION_PANEL_LINES.date,
          signature?.signed_at ? signature.signed_at.slice(0, 10) : null,
          DATE_RULE,
        )}
        {line(EXECUTION_PANEL_LINES.witness, null, WITNESS_RULE)}

        {signature ? (
          <div className="pt-1 text-[11px] font-medium uppercase tracking-wider text-success">
            Executed electronically
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Block({
  block,
  templateKey,
  values,
  signatures,
  logoUrl,
  versionLabel,
}: {
  block: AgreementBlock;
  templateKey: AgreementTemplateKey;
  values: AgreementFieldValues;
  signatures: DigitalSignature[];
  logoUrl?: string | null;
  versionLabel?: string;
}) {
  switch (block.kind) {
    case 'cover':
      return (
        <div className="rounded-xl border border-border bg-card/60 px-6 py-10 text-center sm:px-10">
          {logoUrl ? (
            <img src={logoUrl} alt="" className="mx-auto mb-4 max-h-14 max-w-[200px] object-contain" />
          ) : null}
          <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            <BoundText text={block.companyNameToken} templateKey={templateKey} values={values} />
          </div>
          <h2 className="mt-5 font-serif text-2xl font-semibold leading-tight text-foreground sm:text-3xl">
            {block.titleLines.map((line, index) => (
              <Fragment key={index}>{line}{index < block.titleLines.length - 1 ? <br /> : null}</Fragment>
            ))}
          </h2>
          <div className="mt-3 text-[11px] font-semibold uppercase tracking-widest text-primary">
            {block.issuedByLine}
          </div>
          {/* Who is bound, and on what terms. This replaced a template
              descriptor and a row of EDITABLE / BRAND-READY chips — those
              describe the product to somebody choosing a template, and have no
              place on the face of an agreement a counterparty is reading. */}
          <dl className="mx-auto mt-6 max-w-lg border-t border-border/60 text-left">
            {block.particulars.map((entry) => (
              <div key={`${entry.label}-${entry.value}`} className="flex gap-4 border-b border-border/60 py-2">
                <dt className="w-32 shrink-0 self-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {entry.label}
                </dt>
                <dd className="font-serif text-sm text-foreground">
                  <BoundText text={entry.value} templateKey={templateKey} values={values} />
                </dd>
              </div>
            ))}
          </dl>
          <div className="mt-6 text-xs text-foreground/80">
            <BoundText text={block.versionLine} templateKey={templateKey} values={values} />
          </div>
          {versionLabel ? (
            <div className="mt-1 text-[11px] text-muted-foreground">Agreement version {versionLabel}</div>
          ) : null}
          <div className="mx-auto mt-5 max-w-md border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
            {block.reviewStatement}
          </div>
        </div>
      );
    case 'note':
      return (
        <NoteCard label={block.label}>
          <BoundText text={block.body} templateKey={templateKey} values={values} />
        </NoteCard>
      );
    case 'emailTemplate':
      return (
        <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
          <div className="rounded-lg border border-border/60 bg-card/50 p-4">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{block.subjectLabel}</div>
            <div className="mt-1 text-sm font-medium text-foreground">
              <BoundText text={block.subject} templateKey={templateKey} values={values} />
            </div>
            <div className="mt-3 space-y-2.5 text-sm leading-relaxed text-foreground/90">
              {block.bodyParagraphs.map((paragraph, index) => (
                <p key={index}><BoundText text={paragraph} templateKey={templateKey} values={values} /></p>
              ))}
            </div>
            <div className="mt-3 space-y-0.5 text-sm text-foreground/90">
              {block.signoffLines.map((line, index) => (
                <div key={index}><BoundText text={line} templateKey={templateKey} values={values} /></div>
              ))}
            </div>
          </div>
          <div className="space-y-4">
            <div className="rounded-lg border border-border/60 bg-card/50 p-4">
              <PanelLabel>{block.checklistTitle}</PanelLabel>
              <div className="mt-2 space-y-2.5">
                {block.checklist.map((item) => (
                  <div key={item.step} className="flex gap-3">
                    <div className="font-serif text-lg font-semibold text-primary">{item.step}</div>
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wider text-foreground">{item.title}</div>
                      <div className="text-xs text-muted-foreground">{item.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-border/60 bg-card/50 p-4">
              <PanelLabel>{block.attachmentsTitle}</PanelLabel>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-foreground/90">
                {block.attachments.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          </div>
        </div>
      );
    case 'grid':
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          {block.rows.flat().map((cell, index) => (
            <GridCell key={index} cell={cell} templateKey={templateKey} values={values} />
          ))}
        </div>
      );
    case 'dualPanel':
      return (
        <div className="grid gap-4 md:grid-cols-2">
          {[block.left, block.right].map((side) => (
            <div key={side.title} className="rounded-lg border border-border bg-card/50 p-4">
              <PanelLabel>{side.title}</PanelLabel>
              <ul className="mt-2.5 list-disc space-y-1.5 pl-4 text-sm leading-relaxed text-foreground/90">
                {side.bullets.map((bullet, index) => (
                  <li key={index}><BoundText text={bullet} templateKey={templateKey} values={values} /></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      );
    case 'clauses':
      return (
        <div className="space-y-5">
          {block.clauses.map((clause) => (
            <div key={clause.number}>
              <h4 className="text-sm font-semibold text-foreground">
                <span className="text-primary">{clause.number}.</span> {clause.heading}
              </h4>
              <div className="mt-2 space-y-1.5">
                {clause.subclauses.map((sub) => (
                  <p key={sub.number} className="flex gap-2.5 text-sm leading-relaxed text-foreground/90">
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">{sub.number}</span>
                    <span><BoundText text={sub.text} templateKey={templateKey} values={values} /></span>
                  </p>
                ))}
              </div>
            </div>
          ))}
        </div>
      );
    case 'workflow':
      return (
        <div className="divide-y divide-border/60 rounded-lg border border-border/60 bg-card/50">
          {block.steps.map((step) => (
            <div key={step.num} className="flex items-baseline gap-4 px-4 py-2.5">
              <div className="w-5 shrink-0 font-serif text-lg font-semibold text-primary">{step.num}</div>
              <div className="w-24 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-foreground">{step.title}</div>
              <div className="text-sm text-muted-foreground">{step.text}</div>
            </div>
          ))}
        </div>
      );
    case 'execution': {
      const byRole = new Map(signatures.map((signature) => [signature.party_role, signature]));
      return (
        <div className="grid gap-4 md:grid-cols-2">
          {block.parties.map((party) => (
            <SignaturePanel
              key={party.role}
              role={party.role}
              title={party.title}
              templateKey={templateKey}
              values={values}
              signature={byRole.get(party.role) ?? null}
            />
          ))}
        </div>
      );
    }
    case 'consent':
      return (
        <div className="space-y-3">
          <NoteCard label={block.label}>
            <BoundText text={block.body} templateKey={templateKey} values={values} />
          </NoteCard>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-border/60 bg-card/50 px-3.5 py-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{block.signatureLabel}</div>
              <div className="mt-1 text-sm tracking-wider text-muted-foreground/50">{RULE}</div>
            </div>
            <div className="rounded-lg border border-border/60 bg-card/50 px-3.5 py-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{block.dateLabel}</div>
              <div className="mt-1 text-sm tracking-wider text-muted-foreground/50">{DATE_RULE}</div>
            </div>
          </div>
        </div>
      );
    default:
      return null;
  }
}

function SectionHeader({ section }: { section: AgreementSectionDef }) {
  if (!section.header) return null;
  const { badge, heading, hint, sub } = section.header;
  return (
    <div className="flex items-start gap-3 border-b border-border pb-2.5">
      <div className="rounded bg-primary/10 px-2 py-0.5 font-serif text-sm font-semibold text-primary">{badge}</div>
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-foreground">
          {heading}
          {hint ? <span className="ml-2 font-normal normal-case tracking-normal text-muted-foreground">{hint}</span> : null}
        </h3>
        {sub ? <div className="text-xs text-muted-foreground">{sub}</div> : null}
      </div>
    </div>
  );
}

export function agreementSectionNav(
  templateKey: AgreementTemplateKey,
  includeTemplatePack = false,
): { id: string; badge: string; heading: string }[] {
  return agreementTemplate(templateKey).sections
    .filter((section) => section.header && (section.audience === 'always' || includeTemplatePack))
    .map((section) => ({
      id: section.id,
      badge: section.header!.badge,
      heading: section.header!.heading,
    }));
}

export default function DigitalAgreementView({
  templateKey,
  values,
  signatures = [],
  includeTemplatePack = false,
  logoUrl,
  versionLabel,
  edit = null,
  className,
}: Props) {
  const content = agreementTemplate(templateKey);
  const sections = content.sections.filter(
    (section) => section.audience === 'always' || includeTemplatePack,
  );

  /**
   * Which tokens are editable here. Derived values are computed and have no
   * store to write to; a conditional field that is not currently in play must
   * not be reachable from the page either, or the document would collect text
   * that `rowPatchFromValues` then discards.
   */
  const lookup = useMemo<EditLookup | null>(() => {
    if (!edit) return null;
    const defs = new Map<string, AgreementFieldDef>();
    for (const def of edit.defs) {
      if (def.db === 'derived') continue;
      if (!isAgreementFieldVisible(def, edit.rawValues)) continue;
      defs.set(def.key, def);
    }
    return { defs, rawValues: edit.rawValues, onChange: edit.onChange };
  }, [edit]);

  const body = (
    <div className={cn('space-y-8', className)}>
      {sections.map((section) => (
        <section key={section.id} id={`agc-${section.id}`} className="scroll-mt-24 space-y-4">
          <SectionHeader section={section} />
          {section.blocks.map((block, index) => (
            <Block
              key={index}
              block={block}
              templateKey={templateKey}
              values={values}
              signatures={signatures}
              logoUrl={logoUrl}
              versionLabel={versionLabel}
            />
          ))}
        </section>
      ))}
    </div>
  );

  return lookup ? <EditContext.Provider value={lookup}>{body}</EditContext.Provider> : body;
}
