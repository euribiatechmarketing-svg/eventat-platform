// Every automatic email: the registry matches the prototype's emails/emails.js one to one, and rendering
// each template with its sample reproduces the prototype's text (only CTA hrefs differ).
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { renderEmail } from '@/lib/email/render';
import { CATALOGUE, TEMPLATES } from '@/lib/email/templates';
import { SAMPLES } from '@/lib/email/templates/samples';
import type { Audience } from '@/lib/email/types';

type ProtoEmail = {
  key: string; audience: 'client' | 'partner' | 'vendor' | 'team'; trigger: string; when: string; optional: boolean;
  subject: string; preheader: string; heading: string; paragraphs: string[];
  details?: [string, string][]; cta?: { label: string; href: string }; note?: string;
};

const PROTO = fileURLToPath(new URL('../../eventat-app/emails/emails.js', import.meta.url));
const hasProto = existsSync(PROTO);
const src = hasProto ? readFileSync(PROTO, 'utf8') : '';
const protoKeys = [...src.matchAll(/"key":\s*"([^"]+)"/g)].map(m => m[1]);
const proto: ProtoEmail[] = (() => {
  if (!hasProto) return [];
  const sandbox: { window: { EVENTAT_EMAILS?: ProtoEmail[] } } = { window: {} };
  runInNewContext(src, sandbox);
  return sandbox.window.EVENTAT_EMAILS ?? [];
})();

const norm = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const audienceOf = (a: ProtoEmail['audience']): Audience => (a === 'client' ? 'client' : a === 'team' ? 'team' : 'partner');
const keys = Object.keys(TEMPLATES);

describe('email registry', () => {
  it('has exactly 90 templates', () => {
    expect(keys).toHaveLength(90);
    expect(new Set(keys).size).toBe(90);
  });

  it('has a sample for every template and nothing else', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual([...keys].sort());
  });

  it('gives every optional email a preference key, and none to service emails', () => {
    for (const t of Object.values(TEMPLATES)) {
      if (t.optional) expect(t.preference, t.key).toMatch(/^(client|partner)\.[a-z-]+$/);
      else expect(t.preference, t.key).toBeUndefined();
    }
  });

  it('lists all 90 in the catalogue', () => {
    expect(CATALOGUE).toHaveLength(90);
    expect(new Set(CATALOGUE.map(c => c.key)).size).toBe(90);
    for (const c of CATALOGUE) {
      expect(c.trigger && c.when && c.subject, c.key).toBeTruthy();
      expect(c.optional, c.key).toBe(TEMPLATES[c.key].optional);
    }
  });

  it('points every CTA at a production route', () => {
    for (const key of keys) {
      const href = TEMPLATES[key].render(SAMPLES[key]).cta?.href;
      if (href === undefined) continue;
      expect(href, key).toMatch(/^\//);
      expect(href, key).not.toMatch(/\.html|undefined|null/);
    }
  });

  it('renders every email to HTML and text without undefined or null', () => {
    for (const key of keys) {
      const t = TEMPLATES[key];
      const { html, text } = renderEmail(t.render(SAMPLES[key]), t.audience, t.optional, 'https://eventat.bg');
      for (const out of [html, text]) {
        expect(out, key).not.toMatch(/undefined|null|NaN|\[object Object\]/);
      }
    }
  });
});

describe.skipIf(!hasProto)('matches the prototype (eventat-app/emails/emails.js)', () => {
  it('reads 90 emails from the prototype', () => {
    expect(protoKeys).toHaveLength(90);
    expect(proto.map(e => e.key)).toEqual(protoKeys);
  });

  it('has the same keys, one to one', () => {
    expect([...keys].sort()).toEqual([...protoKeys].sort());
  });

  it('lists the catalogue in the prototype order with its when and subject', () => {
    expect(CATALOGUE.map(c => c.key)).toEqual(protoKeys);
    CATALOGUE.forEach((c, i) => {
      expect(c.when, c.key).toBe(proto[i].when);
      expect(norm(c.subject), c.key).toBe(norm(proto[i].subject));
      expect(c.trigger, c.key).toBe(proto[i].trigger);
    });
  });

  for (const p of proto) {
    it(`${p.key} renders the prototype text`, () => {
      const t = TEMPLATES[p.key];
      expect(t, p.key).toBeDefined();
      expect(t.audience).toBe(audienceOf(p.audience));
      expect(t.optional).toBe(p.optional);
      const m = t.render(SAMPLES[p.key]);
      expect(norm(m.subject)).toBe(norm(p.subject));
      expect(norm(m.heading)).toBe(norm(p.heading));
      expect(m.paragraphs.map(norm)).toEqual(p.paragraphs.map(norm));
      expect(norm(m.preheader)).toBe(norm(p.preheader));
      expect(m.trigger).toBe(p.trigger);
      expect((m.details ?? []).map(([k, v]) => [norm(k), norm(v)])).toEqual((p.details ?? []).map(([k, v]) => [norm(k), norm(v)]));
      expect(norm(m.cta?.label)).toBe(norm(p.cta?.label));
      expect(norm(m.note)).toBe(norm(p.note));
    });
  }
});
