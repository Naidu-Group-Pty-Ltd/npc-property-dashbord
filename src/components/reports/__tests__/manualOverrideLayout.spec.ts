import { describe, expect, it } from 'vitest';
import { getManualOverrideShellVariables } from '../manualOverrideLayout';

describe('Manual Data Override shell positioning', () => {
  it('offsets the portal from the expanded dashboard sidebar', () => {
    expect(getManualOverrideShellVariables('expanded', true)).toMatchObject({
      '--manual-override-sidebar-width': '16rem',
      '--manual-override-header-height': '72px',
    });
  });

  it('uses the collapsed sidebar width without retaining the expanded offset', () => {
    expect(getManualOverrideShellVariables('collapsed', true)).toMatchObject({
      '--manual-override-sidebar-width': '3rem',
      '--manual-override-header-height': '72px',
    });
  });

  it('removes the desktop sidebar offset when the dashboard uses mobile/tablet chrome', () => {
    expect(getManualOverrideShellVariables('expanded', false)).toMatchObject({
      '--manual-override-sidebar-width': '0px',
      '--manual-override-header-height': '56px',
    });
  });
});
