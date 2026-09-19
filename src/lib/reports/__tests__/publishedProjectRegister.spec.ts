import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PUBLISHED_PROJECTS,
  PUBLISHED_PROJECT_BASIS,
  PUBLISHED_PROJECT_COVERAGE,
  projectsNear,
  publishedProjectRules,
  readProjectState,
  renderPublishedProjects,
} from '../publishedProjectRegister.pure';

const SUBJECT = { lat: -33.824993, lon: 148.683685 }; // 48 Redfern Street, Cowra — verified address point

describe('every row carries what §5 asks of a material project', () => {
  it.each(PUBLISHED_PROJECTS.map((p) => [p.name, p] as const))(
    '%s names its authority, its stages, what it delivers and what it does not establish',
    (_name, p) => {
      expect(p.authority.length).toBeGreaterThan(3);
      expect(p.stages.length).toBeGreaterThan(0);
      expect(p.delivers.length).toBeGreaterThan(0);
      // Required, not optional: the class of error this replaces is an
      // infrastructure sentence that implies an effect on prices.
      expect(p.doesNotEstablish.length).toBeGreaterThan(0);
      for (const s of p.stages) {
        expect(s.publishedStatus.length).toBeGreaterThan(3);
        expect(s.statusDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(s.sourceUrl).toMatch(/^https:\/\//);
        expect(s.published).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    },
  );

  it('every project explicitly disclaims an effect on values, rents or demand', () => {
    for (const p of PUBLISHED_PROJECTS) {
      expect(p.doesNotEstablish.join(' ')).toMatch(/propert(y|ies) values?|rents?|demand/i);
    }
  });

  it('a stage carries no amount, so stages cannot be summed at all', () => {
    // The type has no per-stage amount by construction. A field that cannot be
    // summed wrongly is better than a rule saying not to.
    for (const p of PUBLISHED_PROJECTS) {
      for (const s of p.stages) {
        expect(Object.keys(s)).not.toContain('investment');
        expect(Object.keys(s)).not.toContain('amount');
        expect(Object.keys(s)).not.toContain('cost');
      }
    }
  });
});

describe('the Cowra hospital, reconciled across its stages', () => {
  const near = projectsNear(SUBJECT.lat, SUBJECT.lon, 15);

  it('is found from the verified address point, at a measured distance', () => {
    expect(near).toHaveLength(1);
    expect(near[0].project.name).toBe('Cowra Hospital Redevelopment');
    expect(near[0].distanceKm).toBeGreaterThan(1.0);
    expect(near[0].distanceKm).toBeLessThan(1.2);
  });

  it('carries ONE investment figure for four published milestones', () => {
    const p = near[0].project;
    expect(p.investment?.statedAs).toBe('$110.2 million');
    expect(p.stages).toHaveLength(4);
    // Four pages each saying $110.2m. Stored per stage, this is $440.8m of
    // regional investment that does not exist.
    expect(p.stages.filter((s) => /110\.2/.test(s.publishedStatus))).toHaveLength(1);
  });

  it('reads as open and operating with works continuing, from the stages themselves', () => {
    expect(readProjectState(near[0].project)).toBe('operational_with_works_continuing');
  });

  it('does not assert the final stage finished, because no publisher said so', () => {
    // "Mid-2026" is an estimate and today is later than that. A calendar is
    // not a publisher.
    const said = near[0].project.doesNotEstablish.join(' ');
    expect(said).toMatch(/mid-2026/i);
    expect(said).toMatch(/no later statement|not.*confirm/i);
  });

  it('is outside a tighter radius rather than reported as nearby', () => {
    expect(projectsNear(SUBJECT.lat, SUBJECT.lon, 0.5)).toHaveLength(0);
  });
});

describe('the rendered block', () => {
  const md = renderPublishedProjects(projectsNear(SUBJECT.lat, SUBJECT.lon, 15));

  it('says the stages are one project and one figure, in the document', () => {
    expect(md).toContain('not separate investments and must not be added together');
  });

  it('labels the distance as straight-line, and says a road journey is longer', () => {
    expect(md).toMatch(/1\.1 km straight-line/);
    expect(md).toContain('a road journey is longer');
  });

  it('names its basis as a recorded publication, never as a register reading', () => {
    expect(md).toContain(PUBLISHED_PROJECT_BASIS);
    expect(md).not.toMatch(/retrieved from (a|the) register/i);
  });

  it('prints what is delivered and what the evidence does not establish', () => {
    expect(md).toContain('**What it delivers.**');
    expect(md).toContain('**What this evidence does not establish.**');
    expect(md).toContain('first CT scanner');
  });

  it('dates every published status rather than rendering today', () => {
    expect(md).toContain('11 November 2025');
    expect(md).toContain('9 December 2025');
    expect(md).toContain('5 January 2026 to mid-2026');
  });

  it('is empty where nothing is near, rather than drawing an empty table', () => {
    expect(renderPublishedProjects([])).toBe('');
  });
});

describe('the rules the prose answers to', () => {
  const withProject = publishedProjectRules(projectsNear(SUBJECT.lat, SUBJECT.lon, 15));
  const without = publishedProjectRules([]);

  it('forbids stating or implying an effect on values, rents, yields or growth', () => {
    expect(withProject).toMatch(/Do NOT state or imply an effect on property values/);
    for (const word of ['rents', 'yields', 'demand', 'capital\ngrowth', 'growth']) {
      expect(withProject.toLowerCase()).toContain(word.replace('\n', ' ').toLowerCase());
    }
  });

  it('forbids summing stages or totalling the projects into a regional figure', () => {
    expect(withProject).toMatch(/Never add them together/);
    expect(withProject).toMatch(/never total the projects/);
  });

  it('forbids rating the area\'s infrastructure outlook from the register', () => {
    expect(withProject).toMatch(/not Low, not Strong, not Favourable, not a score/);
  });

  it('an empty register is a statement about what was RECORDED, never about the area', () => {
    expect(without).toMatch(/statement about what has been\s+RECORDED, not about the area/);
    expect(without).toMatch(/do not write that there is no infrastructure investment nearby/i);
    expect(without).toMatch(/do not rate/i);
  });

  it('the coverage note says what the register does not reach', () => {
    const said = PUBLISHED_PROJECT_COVERAGE.join(' ');
    expect(said).toMatch(/council capital works/i);
    expect(said).toMatch(/has not been shown to be absent/i);
  });
});

describe('the generator reads it', () => {
  const src = readFileSync('supabase/functions/generate-investment-report/index.ts', 'utf8');

  it('keys on the verified coordinate, so no coordinate names no project', () => {
    expect(src).toContain('const publishedProjectCoords = enhancedData.locationIntelligence?.coordinates;');
    expect(src).toMatch(/publishedProjectCoords\?\.lat && publishedProjectCoords\?\.lng/);
  });

  it('pins the block so a trim cannot cut the evidence and leave the rule', () => {
    const pin = src.indexOf('const pinnedPlanningContext = [');
    const end = src.indexOf('].join', pin);
    expect(src.slice(pin, end)).toContain('publishedProjectBlock');
    expect(src.slice(pin, end)).toContain('publishedProjectSectionRules');
  });

  it('appends the block verbatim rather than asking a model to reproduce it', () => {
    expect(src).toContain('### Major public projects near this property');
    expect(src).toContain('PUBLISHED_PROJECT_COVERAGE.join');
  });
});
