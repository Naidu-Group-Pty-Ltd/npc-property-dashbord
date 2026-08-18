#!/usr/bin/env python3
"""Build the POST payloads for cloning the NPC Vapi estate into a new account.

Reads the committed snapshot (../npc-services, ../snapshot) and writes payloads/
plus index.json. Makes no network requests and never needs a credential: every
{{REDACTED:*}} placeholder is carried through verbatim and substituted from the
environment by push.py at execute time.

Faithfulness rules:
- A payload is the captured record minus only what the server assigns
  (SERVER_FIELDS below, plus sipUri on vapi-provider numbers - minted per org).
- The nine assistant fields and three tool fields absent from the spec
  (CONTESTED below) are KEPT and flagged; whether a POST accepts them is what
  push.py --probe exists to settle. Dropping them here would silently change
  behaviour (e.g. denoising off on two live assistants).
- A reference to an object that no longer exists (the four dangling toolIds) is
  dropped LOUDLY: it cannot resolve in the new org and would fail the create.
- Nothing is re-pointed. Webhook URLs still name the legacy Make account;
  url-map.template.json lists them for push.py --url-map when the us2 URLs exist.
"""
import json, glob, os, re, sys, collections

HERE = os.path.dirname(os.path.abspath(__file__))
NPC = os.path.join(HERE, '..', 'npc-services')
SNAP = os.path.join(HERE, '..', 'snapshot')
OUT = os.path.join(HERE, 'payloads')

SERVER_FIELDS = {'id', 'orgId', 'createdAt', 'updatedAt', 'latestVersion',
                 'isServerUrlSecretSet', 'status'}
CONTESTED = {
    'assistant': {'serverUrl', 'recordingEnabled', 'hipaaEnabled', 'silenceTimeoutSeconds',
                  'backchannelingEnabled', 'backgroundDenoisingEnabled',
                  'endCallFunctionEnabled', 'dialKeypadFunctionEnabled',
                  'voicemailDetectionEnabled'},
    'tool': {'function', 'async', 'metadata'},
}
REDACT_RE = re.compile(r'\{\{REDACTED:([A-Z0-9_]+)\}\}')

def load(path):
    with open(path) as f:
        return json.load(f)

def jload_dir(pattern):
    return sorted(glob.glob(pattern))

def walk(obj, path, fn):
    if isinstance(obj, dict):
        for k, v in obj.items():
            walk(v, f'{path}/{k}', fn)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            walk(v, f'{path}/{i}', fn)
    else:
        fn(path, obj)

def main():
    dtos = load(os.path.join(HERE, 'create-dtos.json'))['resources']

    # ---- gather sources, in dependency (phase) order --------------------------
    phases = []  # (phase, resource, source_path, record, optional, extra)
    for p in jload_dir(f'{NPC}/files/*.metadata.json'):
        m = load(p)
        doc = p.replace('.metadata.json', '.doc.' + ('docx' if m['mimetype'].endswith('document') else 'pdf'))
        phases.append(('00-file', 'file', p, m, False, {'bytesFile': os.path.relpath(doc, HERE)}))
    for p in jload_dir(f'{NPC}/tools/*.json'):
        phases.append(('01-tool', 'tool', p, load(p), False, {}))
    for p in jload_dir(f'{SNAP}/structured-outputs/*.json'):
        r = load(p)
        optional = r['id'] == '468022e7-2ba9-4154-8178-927586daf240'  # unreferenced byte-dup
        phases.append(('02-structured-output', 'structured-output', p, r, optional, {}))
    for p in jload_dir(f'{SNAP}/observability/scorecard.*.json'):
        phases.append(('03-scorecard', 'scorecard', p, load(p), False, {}))
    for p in jload_dir(f'{NPC}/assistants/*.json'):
        phases.append(('04-assistant', 'assistant', p, load(p), False, {}))
    for p in jload_dir(f'{NPC}/squads/*.json'):
        phases.append(('05-squad', 'squad', p, load(p), False, {}))
    for p in jload_dir(f'{NPC}/workflows/*.json'):
        phases.append(('06-workflow', 'workflow', p, load(p), False, {}))
    for p in jload_dir(f'{NPC}/phone-numbers/*.json'):
        phases.append(('07-phone-number', 'phone-number', p, load(p), False, {}))
    for p in jload_dir(f'{SNAP}/reporting/insight.*.json'):
        phases.append(('08-insight', 'insight', p, load(p), True, {}))
    for p in jload_dir(f'{SNAP}/reporting/board.default-dashboard.*.json'):
        phases.append(('09-board', 'board', p, load(p), True, {}))

    # ---- id registry (old ids, by resource) -----------------------------------
    registry = {}
    for _, res, _, rec, _, _ in phases:
        if 'id' in rec:
            registry[rec['id']] = res

    # ---- build ---------------------------------------------------------------
    index = {'phases': [], 'payloads': [], 'summary': {}}
    urlset = set()
    counts = collections.Counter()
    errors = []
    os.makedirs(OUT, exist_ok=True)

    for phase, res, src, rec, optional, extra in phases:
        payload = {k: v for k, v in rec.items() if k not in SERVER_FIELDS}
        warnings, refs, env, deferred = [], {}, set(), {}
        old_id = rec.get('id')

        if res == 'phone-number' and rec.get('provider') == 'vapi':
            if payload.pop('sipUri', None):
                warnings.append('sipUri dropped: minted per org; SIP callers must be re-pointed at the new URI')

        # Break the assistant <-> structured-output/scorecard reference cycle.
        # Both Create DTOs accept assistantIds, but assistants are created two
        # phases later, so the reverse reference is deferred to a PATCH that
        # push.py issues after phase 04-assistant. Carried verbatim - including
        # the reverse refs the source org let go stale (see STRUCTURED-OUTPUTS.md).
        if res in ('structured-output', 'scorecard') and payload.get('assistantIds'):
            deferred['assistantIds'] = payload.pop('assistantIds')
            warnings.append('assistantIds deferred to a post-assistant PATCH (cycle: assistants reference this object and are created later)')

        # drop dangling references (only toolIds are known to dangle)
        tool_ids = (payload.get('model') or {}).get('toolIds') if res == 'assistant' else None
        if tool_ids:
            keep = [t for t in tool_ids if t in registry]
            for t in tool_ids:
                if t not in registry:
                    warnings.append(f'dangling toolId dropped (deleted in source org): {t}')
            payload['model']['toolIds'] = keep

        def note(path, val):
            if isinstance(val, str):
                if val in registry and path.strip('/') != 'id':
                    refs[path] = {'resource': registry[val], 'oldId': val}
                for m in REDACT_RE.finditer(val):
                    env.add(m.group(1))
                if 'hook.eu2.make.com' in val:
                    urlset.add(val)
        walk(payload, '', note)

        # validate against the Create DTO
        dto_name, dto = None, None
        table = dtos[res]['dtos']
        if table:
            if len(table) == 1:
                dto_name, dto = next(iter(table.items()))
            else:
                for n, d in table.items():
                    dk = d['discriminatorKey']
                    if dk and payload.get(dk) in (d['discriminatorValues'] or []):
                        dto_name, dto = n, d
                        break
            if dto is None:
                errors.append(f'{src}: no Create DTO variant matches')
            else:
                for k in dto['required']:
                    if k not in payload:
                        errors.append(f'{src}: missing required "{k}" for {dto_name}')
                for k in payload:
                    if k not in dto['properties']:
                        if k in CONTESTED.get(res, ()):
                            warnings.append(f'contested field kept (absent from spec, may be dropped by POST): {k}')
                        else:
                            errors.append(f'{src}: key "{k}" not in {dto_name}')

        stem = os.path.basename(src).replace('.metadata.json', '.json')
        rel = f'payloads/{phase}/{stem}'
        os.makedirs(os.path.join(OUT, phase), exist_ok=True)
        with open(os.path.join(HERE, rel), 'w') as f:
            json.dump(payload, f, indent=2)
            f.write('\n')

        entry = {
            'file': rel, 'phase': phase, 'resource': res, 'dto': dto_name,
            'endpoint': dtos[res]['endpoint'], 'oldId': old_id,
            'name': rec.get('name') or (rec.get('function') or {}).get('name'),
            'optional': optional, 'refs': refs, 'env': sorted(env),
            'warnings': warnings, **extra,
        }
        if deferred:
            entry['deferred'] = deferred
        index['payloads'].append(entry)
        counts[phase] += 1

    index['phases'] = [{'phase': p, 'count': c} for p, c in sorted(counts.items())]
    index['summary'] = {
        'payloads': len(index['payloads']),
        'optional': sum(1 for p in index['payloads'] if p['optional']),
        'envVars': sorted({e for p in index['payloads'] for e in p['env']}),
        'crossReferences': sum(len(p['refs']) for p in index['payloads']),
        'warnings': sum(len(p['warnings']) for p in index['payloads']),
        'legacyMakeUrls': len(urlset),
        'sourceOrgId': 'c9015cd5-3701-4ac5-aa9c-be6cdcaaecdd',
    }
    with open(os.path.join(HERE, 'index.json'), 'w') as f:
        json.dump(index, f, indent=2)
        f.write('\n')
    with open(os.path.join(HERE, 'url-map.template.json'), 'w') as f:
        json.dump({u: '' for u in sorted(urlset)}, f, indent=2)
        f.write('\n')

    print(json.dumps(index['phases'], indent=1))
    print('env vars needed:', index['summary']['envVars'])
    print('cross-references:', index['summary']['crossReferences'],
          '| warnings:', index['summary']['warnings'],
          '| legacy Make URLs:', len(urlset))
    if errors:
        print('\nVALIDATION ERRORS:')
        for e in errors:
            print('  -', e)
        sys.exit(1)
    print('all payloads validate against their Create DTOs')

if __name__ == '__main__':
    main()
