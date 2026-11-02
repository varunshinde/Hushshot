import { describe, expect, it } from 'vitest';
import { NEVER_OPTIONAL, OPTIONAL_PERMISSIONS, PERMISSIONS } from '../../src/lib/manifest-permissions';

describe('manifest permissions', () => {
  it('never lists a permission as optional that Chrome would silently drop', () => {
    for (const p of OPTIONAL_PERMISSIONS) expect(NEVER_OPTIONAL).not.toContain(p);
  });

  it('requires debugger, which Sharp mode needs', () => {
    expect(PERMISSIONS).toContain('debugger');
  });

  it('asks for no host permissions or tabs access', () => {
    expect(PERMISSIONS.filter((p) => p.includes('://') || p === '<all_urls>' || p === 'tabs')).toEqual([]);
  });
});
