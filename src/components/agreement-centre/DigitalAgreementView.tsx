/**
 * The agreement as a digital document — the in-app representation.
 *
 * Renders the content model with the bound field values, live: the wizard's
 * preview updates as fields are typed, the partner's review room reads the
 * frozen values of the issued version, and both are this one component, so what
 * the issuer previews is what the partner reviews.
 *
 * ## Two kinds of edit, deliberately distinguished
 *
 * The supplied templates stay locked — nothing here rewrites a content module.
 * What an issuer's draft surface can do is:
 *
 *  1. **fill the inserts** — the bracketed values the template invites. Handled
 *     by `InlineFieldEditor`, writing the same raw field the step forms write.
 *  2. **amend the wording** — a clause body, a heading, a schedule sentence, a
 *     bullet. Handled by `ContentTextEditor`, writing a per-node override stored
 *     with the agreement's values (so an issued version freezes the wording it
 *     was issued with) and applied here and by the PDF renderer through the one
 *     shared transform, `agreementContentForValues`.
 *
 * Both agreements — Strategic Property Referral and Finance Referral &
 * Commission — are covered, because the paths come from the same traversal that
 * the server uses rather than from either template's shape.
 *
 * Unfilled fields print the template's original `<<INSERT>>` brackets, muted,
 * exactly like the PDF. Semantic tokens only — this surface renders inside both
 * the Command Centre (light) and the Finance Portal (dark palettes).
 */
import { createContext, Fragment, useContext, useMemo, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import {
  AnnotationAddButton,
  AnnotationContext,
  AnnotationMarker,
  useAnnotationLayer,
  type AnnotationLayer,
} from './annotationContext';
import InlineFieldEditor from './InlineFieldEditor';
import ContentTextEditor from './ContentTextEditor';
import {
  agreementTemplate,
  agreementContentForValues,
  listAgreementContentSlots,
  placeholderForToken,
  isAgreementFieldVisible,
  EXECUTION_PANEL_LINES,
  type AgreementBlock,
  type AgreementContentSlot,
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
 *
 * `onContentChange` is optional: a surface may allow value edits without opening
 * the wording of the instrument. Passing it turns every text node in the
 * document into an amendable one.
 */
export interface DigitalEditContext {
  defs: readonly AgreementFieldDef[];
  rawValues: AgreementFieldValues;
  onChange: (key: string, value: unknown) => void;
  /** `null` text restores the supplied wording at that path. */
  onContentChange?: (path: string, text: string | null) => void;
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
  /**
   * Change requests pinned to clauses, and whether this reader may add one.
   *
   * Both portals render this component, so passing the same layer to each is
   * what makes the partner's pins appear on the Command Centre's live preview
   * — not a second implementation that has to be kept in step.
   */
  annotations?: AnnotationLayer | null;
  className?: string;
}

const TOKEN_SPLIT = /(\{\{[a-z0-9_]+\}\})/g;

interface EditLookup {
  defs: Map<string, AgreementFieldDef>;
  rawValues: AgreementFieldValues;
  onChange: (key: string, value: unknown) => void;
}

const EditContext = createContext<EditLookup | null>(null);

/** A node the reader may amend: supplied wording plus what is printed now. */
type AmendableSlot = AgreementContentSlot & { current: string };

/** Wording amendment, when the surface allows it. */
interface ContentEditLookup {
  /** Keyed by path. `text` is the SUPPLIED wording — what "restore" restores. */
  slots: Map<string, AmendableSlot>;
  onContentChange: (path: string, text: string | null) => void;
}

const ContentEditContext = createContext<ContentEditLookup | null>(null);

/**
 * One text node of the document, optionally amendable.
 *
 * The pencil sits AFTER the text rather than turning the text into a button:
 * clause bodies contain the value editors, and a button inside a button is
 * neither valid nor usable. Read-only surfaces render the children untouched,
 * so there is no cost to routing every text node through here.
 */
function Amendable({
  path,
  children,
  className,
}: {
  path: string;
  children: ReactNode;
  className?: string;
}) {
  const content = useContext(ContentEditContext);
  const slot = content?.slots.get(path) ?? null;

  // The annotation layer hangs off the same path. Every text node already
  // passes through here carrying its address, so pinning a change request to a
  // clause needs no second traversal and cannot drift out of step with the
  // amendment paths — a request and the amendment answering it name the same
  // node. See `annotationContext.tsx`.
  const annotations = useAnnotationLayer();
  const pins = annotations?.byPath.get(path) ?? null;
  const canAdd = annotations?.canAdd === true;
  const marker = pins && annotations ? (
    <AnnotationMarker
      annotations={pins}
      active={pins.some((pin) => pin.id === annotations.activeId)}
      onSelect={annotations.onSelect}
    />
  ) : null;
  const adder = canAdd && annotations?.onAdd ? (
    <AnnotationAddButton
      path={path}
      onAdd={annotations.onAdd}
      composing={annotations.composingPath === path}
    />
  ) : null;

  if (!content || !slot) {
    if (!marker && !adder) {
      return className ? <span className={className}>{children}</span> : <>{children}</>;
    }
    return (
      <span className={cn('group/doctext', className)}>
        {children}
        {marker}
        {adder}
      </span>
    );
  }
  return (
    <span className={cn('group/doctext', className)}>
      {children}
      <ContentTextEditor
        path={path}
        // The printed wording (override already applied upstream) is what the
        // editor opens with; the slot carries the supplied original.
        text={slot.current}
        original={slot.text}
        label={slot.label}
        multiline={slot.multiline}
        onChange={content.onContentChange}
      />
      {marker}
      {adder}
    </span>
  );
}

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

/** Bound text that is also amendable — the document's default text node. */
function DocText({
  path,
  text,
  templateKey,
  values,
}: {
  path: string;
  text: string;
  templateKey: AgreementTemplateKey;
  values: AgreementFieldValues;
}) {
  return (
    <Amendable path={path}>
      <BoundText text={text} templateKey={templateKey} values={values} />
    </Amendable>
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
  path,
  templateKey,
  values,
}: {
  cell: GridCellDef;
  path: string;
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
      {choice.lead ? (
        <div className="text-sm text-foreground/90">
          <Amendable path={`${path}:lead`}>{choice.lead}</Amendable>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {choice.options.map((option, optionIndex) => {
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
              {/* The option's own wording is amendable; its label is template text. */}
              <Amendable path={`${path}:opt:${optionIndex}`}>{null}</Amendable>
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
  path,
  templateKey,
  values,
}: {
  cell: GridCellDef;
  path: string;
  templateKey: AgreementTemplateKey;
  values: AgreementFieldValues;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/50 px-3.5 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Amendable path={`${path}:label`}>{cell.label}</Amendable>
      </div>
      <div className="mt-1 text-sm leading-relaxed">
        {cell.choice ? (
          <ChoiceValue cell={cell} path={path} templateKey={templateKey} values={values} />
        ) : cell.template ? (
          <DocText path={`${path}:template`} text={cell.template} templateKey={templateKey} values={values} />
        ) : cell.fieldKey ? (
          <BoundText text={`{{${cell.fieldKey}}}`} templateKey={templateKey} values={values} />
        ) : (
          <span className="text-muted-foreground/70">
            <Amendable path={`${path}:text`}>{cell.text}</Amendable>
          </span>
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
  titlePath,
  templateKey,
  values,
  signature,
}: {
  role: ExecutionPartyRole;
  title: string;
  titlePath: string;
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
      <PanelLabel><Amendable path={titlePath}>{title}</Amendable></PanelLabel>
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
  path,
  templateKey,
  values,
  signatures,
  logoUrl,
  versionLabel,
}: {
  block: AgreementBlock;
  /** `s:<sectionId>/b:<index>` — the override path prefix for this block. */
  path: string;
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
              <Fragment key={index}>
                <Amendable path={`${path}/title:${index}`}>{line}</Amendable>
                {index < block.titleLines.length - 1 ? <br /> : null}
              </Fragment>
            ))}
          </h2>
          <div className="mt-3 text-[11px] font-semibold uppercase tracking-widest text-primary">
            <Amendable path={`${path}/issuedBy`}>{block.issuedByLine}</Amendable>
          </div>
          {/* Who is bound, and on what terms. This replaced a template
              descriptor and a row of EDITABLE / BRAND-READY chips — those
              describe the product to somebody choosing a template, and have no
              place on the face of an agreement a counterparty is reading. */}
          <dl className="mx-auto mt-6 max-w-lg border-t border-border/60 text-left">
            {block.particulars.map((entry, index) => (
              <div key={`${entry.label}-${index}`} className="flex gap-4 border-b border-border/60 py-2">
                <dt className="w-32 shrink-0 self-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <Amendable path={`${path}/particular:${index}:label`}>{entry.label}</Amendable>
                </dt>
                <dd className="font-serif text-sm text-foreground">
                  <DocText
                    path={`${path}/particular:${index}:value`}
                    text={entry.value}
                    templateKey={templateKey}
                    values={values}
                  />
                </dd>
              </div>
            ))}
          </dl>
          <div className="mt-6 text-xs text-foreground/80">
            <DocText path={`${path}/versionLine`} text={block.versionLine} templateKey={templateKey} values={values} />
          </div>
          {versionLabel ? (
            <div className="mt-1 text-[11px] text-muted-foreground">Agreement version {versionLabel}</div>
          ) : null}
          <div className="mx-auto mt-5 max-w-md border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
            <Amendable path={`${path}/review`}>{block.reviewStatement}</Amendable>
          </div>
        </div>
      );
    case 'note':
      return (
        <NoteCard label={block.label}>
          <DocText path={`${path}/body`} text={block.body} templateKey={templateKey} values={values} />
        </NoteCard>
      );
    case 'emailTemplate':
      return (
        <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
          <div className="rounded-lg border border-border/60 bg-card/50 p-4">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{block.subjectLabel}</div>
            <div className="mt-1 text-sm font-medium text-foreground">
              <DocText path={`${path}/subject`} text={block.subject} templateKey={templateKey} values={values} />
            </div>
            <div className="mt-3 space-y-2.5 text-sm leading-relaxed text-foreground/90">
              {block.bodyParagraphs.map((paragraph, index) => (
                <p key={index}>
                  <DocText path={`${path}/para:${index}`} text={paragraph} templateKey={templateKey} values={values} />
                </p>
              ))}
            </div>
            <div className="mt-3 space-y-0.5 text-sm text-foreground/90">
              {block.signoffLines.map((line, index) => (
                <div key={index}>
                  <DocText path={`${path}/signoff:${index}`} text={line} templateKey={templateKey} values={values} />
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-4">
            <div className="rounded-lg border border-border/60 bg-card/50 p-4">
              <PanelLabel>{block.checklistTitle}</PanelLabel>
              <div className="mt-2 space-y-2.5">
                {block.checklist.map((item, index) => (
                  <div key={item.step} className="flex gap-3">
                    <div className="font-serif text-lg font-semibold text-primary">{item.step}</div>
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wider text-foreground">
                        <Amendable path={`${path}/check:${index}:title`}>{item.title}</Amendable>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        <Amendable path={`${path}/check:${index}:detail`}>{item.detail}</Amendable>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-border/60 bg-card/50 p-4">
              <PanelLabel>{block.attachmentsTitle}</PanelLabel>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-foreground/90">
                {block.attachments.map((item, index) => (
                  <li key={index}>
                    <Amendable path={`${path}/attach:${index}`}>{item}</Amendable>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      );
    case 'grid':
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          {block.rows.map((row, rowIndex) => row.map((cell, cellIndex) => (
            <GridCell
              key={`${rowIndex}-${cellIndex}`}
              cell={cell}
              path={`${path}/cell:${rowIndex}:${cellIndex}`}
              templateKey={templateKey}
              values={values}
            />
          )))}
        </div>
      );
    case 'dualPanel':
      return (
        <div className="grid gap-4 md:grid-cols-2">
          {([['left', block.left], ['right', block.right]] as const).map(([side, panel]) => (
            <div key={side} className="rounded-lg border border-border bg-card/50 p-4">
              <PanelLabel>
                <Amendable path={`${path}/${side}:title`}>{panel.title}</Amendable>
              </PanelLabel>
              <ul className="mt-2.5 list-disc space-y-1.5 pl-4 text-sm leading-relaxed text-foreground/90">
                {panel.bullets.map((bullet, index) => (
                  <li key={index}>
                    <DocText
                      path={`${path}/${side}:bullet:${index}`}
                      text={bullet}
                      templateKey={templateKey}
                      values={values}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      );
    case 'clauses':
      return (
        <div className="space-y-5">
          {block.clauses.map((clause, clauseIndex) => (
            <div key={`${clause.number}-${clauseIndex}`}>
              <h4 className="text-sm font-semibold text-foreground">
                <span className="text-primary">{clause.number}.</span>{' '}
                <Amendable path={`${path}/clause:${clauseIndex}:heading`}>{clause.heading}</Amendable>
              </h4>
              <div className="mt-2 space-y-1.5">
                {clause.subclauses.map((sub, subIndex) => (
                  <p key={`${sub.number}-${subIndex}`} className="flex gap-2.5 text-sm leading-relaxed text-foreground/90">
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">{sub.number}</span>
                    <span>
                      <DocText
                        path={`${path}/clause:${clauseIndex}:sub:${subIndex}:text`}
                        text={sub.text}
                        templateKey={templateKey}
                        values={values}
                      />
                    </span>
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
          {block.steps.map((step, index) => (
            <div key={step.num} className="flex items-baseline gap-4 px-4 py-2.5">
              <div className="w-5 shrink-0 font-serif text-lg font-semibold text-primary">{step.num}</div>
              <div className="w-24 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-foreground">
                <Amendable path={`${path}/step:${index}:title`}>{step.title}</Amendable>
              </div>
              <div className="text-sm text-muted-foreground">
                <DocText path={`${path}/step:${index}:text`} text={step.text} templateKey={templateKey} values={values} />
              </div>
            </div>
          ))}
        </div>
      );
    case 'execution': {
      const byRole = new Map(signatures.map((signature) => [signature.party_role, signature]));
      return (
        <div className="grid gap-4 md:grid-cols-2">
          {block.parties.map((party, index) => (
            <SignaturePanel
              key={party.role}
              role={party.role}
              title={party.title}
              titlePath={`${path}/party:${index}:title`}
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
            <DocText path={`${path}/body`} text={block.body} templateKey={templateKey} values={values} />
          </NoteCard>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-border/60 bg-card/50 px-3.5 py-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <Amendable path={`${path}/signatureLabel`}>{block.signatureLabel}</Amendable>
              </div>
              <div className="mt-1 text-sm tracking-wider text-muted-foreground/50">{RULE}</div>
            </div>
            <div className="rounded-lg border border-border/60 bg-card/50 px-3.5 py-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <Amendable path={`${path}/dateLabel`}>{block.dateLabel}</Amendable>
              </div>
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
          <Amendable path={`s:${section.id}/h:heading`}>{heading}</Amendable>
          {hint ? (
            <span className="ml-2 font-normal normal-case tracking-normal text-muted-foreground">
              <Amendable path={`s:${section.id}/h:hint`}>{hint}</Amendable>
            </span>
          ) : null}
        </h3>
        {sub ? (
          <div className="text-xs text-muted-foreground">
            <Amendable path={`s:${section.id}/h:sub`}>{sub}</Amendable>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Jump links. Takes the agreement's values so an amended section heading is the
 * heading the reader clicks — the nav and the document cannot disagree.
 */
export function agreementSectionNav(
  templateKey: AgreementTemplateKey,
  includeTemplatePack = false,
  values?: AgreementFieldValues | null,
): { id: string; badge: string; heading: string }[] {
  return agreementContentForValues(templateKey, values ?? null).sections
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
  annotations = null,
  className,
}: Props) {
  // The wording of THIS agreement: the supplied template plus its own amendments.
  const content = useMemo(() => agreementContentForValues(templateKey, values), [templateKey, values]);
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

  /**
   * The amendable nodes, keyed by path, carrying BOTH the supplied wording (for
   * "restore") and the wording currently printed (for the editor's draft). Built
   * from the supplied template so a path is authoritative even when overridden.
   */
  const contentLookup = useMemo<ContentEditLookup | null>(() => {
    const onContentChange = edit?.onContentChange;
    if (!onContentChange) return null;
    const slots = new Map<string, AmendableSlot>();
    const supplied = listAgreementContentSlots(agreementTemplate(templateKey));
    const printed = new Map(listAgreementContentSlots(content).map((slot) => [slot.path, slot.text]));
    for (const slot of supplied) {
      slots.set(slot.path, { ...slot, current: printed.get(slot.path) ?? slot.text });
    }
    return { slots, onContentChange };
  }, [edit?.onContentChange, templateKey, content]);

  const body = (
    <div className={cn('space-y-8', className)}>
      {sections.map((section) => (
        <section key={section.id} id={`agc-${section.id}`} className="scroll-mt-24 space-y-4">
          <SectionHeader section={section} />
          {section.blocks.map((block, index) => (
            <Block
              key={index}
              block={block}
              path={`s:${section.id}/b:${index}`}
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

  const withValues = lookup ? <EditContext.Provider value={lookup}>{body}</EditContext.Provider> : body;
  const withContent = contentLookup
    ? <ContentEditContext.Provider value={contentLookup}>{withValues}</ContentEditContext.Provider>
    : withValues;
  return annotations
    ? <AnnotationContext.Provider value={annotations}>{withContent}</AnnotationContext.Provider>
    : withContent;
}
