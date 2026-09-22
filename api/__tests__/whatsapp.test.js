/**
 * api/__tests__/whatsapp.test.js
 *
 * The WhatsApp number can write into the books, so its gatekeeping is tested
 * as security code (docs/AUTOMATION_PLAN.md §4.4):
 *   - only allowlisted numbers may write; an empty allowlist means NOBODY
 *   - the webhook capability key is compared in constant time and fails closed
 *   - Meta's HMAC verifier accepts a correct signature and rejects tampering
 *   - routed messages map to the right record type, and unknown intents map to nothing
 *
 * Run with:  npx vitest run api/__tests__/whatsapp.test.js
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  senderAllowed, senderName, webhookKeyOk, verifySignature, routedToIntake,
} from '../_lib/whatsapp.js';

const saved = {};
const setEnv = (k, v) => { saved[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; };

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

describe('senderAllowed', () => {
  it('fails closed when no allowlist is configured', () => {
    setEnv('WHATSAPP_ALLOWED_NUMBERS', undefined);
    expect(senderAllowed('306912345678')).toBe(false);
  });

  it('accepts listed numbers regardless of formatting', () => {
    setEnv('WHATSAPP_ALLOWED_NUMBERS', '+30 691 234 5678, 306987654321');
    expect(senderAllowed('306912345678')).toBe(true);
    expect(senderAllowed('306987654321')).toBe(true);
  });

  it('rejects everyone else', () => {
    setEnv('WHATSAPP_ALLOWED_NUMBERS', '306912345678');
    expect(senderAllowed('306900000000')).toBe(false);
    expect(senderAllowed('')).toBe(false);
  });
});

describe('senderName', () => {
  beforeEach(() => setEnv('WHATSAPP_SENDER_NAMES', '306912345678=Kostas,306987654321=Panos'));

  it('names known senders', () => {
    expect(senderName('306912345678')).toBe('Kostas');
    expect(senderName('+30 698 765 4321')).toBe('Panos');
  });

  it('returns null for strangers', () => {
    expect(senderName('306900000000')).toBeNull();
  });
});

describe('webhookKeyOk', () => {
  const req = (over = {}) => ({ query: {}, headers: {}, ...over });

  it('fails closed with no expected key', () => {
    expect(webhookKeyOk(req({ query: { key: 'x' } }), '')).toBe(false);
  });

  it('accepts the right key from the query string or a Bearer header', () => {
    expect(webhookKeyOk(req({ query: { key: 'sekret-123' } }), 'sekret-123')).toBe(true);
    expect(webhookKeyOk(req({ headers: { authorization: 'Bearer sekret-123' } }), 'sekret-123')).toBe(true);
  });

  it('rejects wrong, missing and length-mismatched keys', () => {
    expect(webhookKeyOk(req({ query: { key: 'sekret-124' } }), 'sekret-123')).toBe(false);
    expect(webhookKeyOk(req(), 'sekret-123')).toBe(false);
    expect(webhookKeyOk(req({ query: { key: 'sek' } }), 'sekret-123')).toBe(false);
  });
});

describe('verifySignature', () => {
  const secret = 'app-secret';
  const body = Buffer.from(JSON.stringify({ entry: [{ id: '1' }] }));
  const sig = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

  it('accepts a correct signature', () => {
    expect(verifySignature(body, sig, secret)).toBe(true);
  });

  it('rejects a tampered body or a missing secret', () => {
    expect(verifySignature(Buffer.from('{"entry":[]}'), sig, secret)).toBe(false);
    expect(verifySignature(body, sig, '')).toBe(false);
    expect(verifySignature(body, '', secret)).toBe(false);
  });
});

describe('routedToIntake', () => {
  const ctx = { sourceRef: 'wamid.1', from: '306912345678', transcript: 'x' };

  it('maps each intent to its record type', () => {
    expect(routedToIntake({ intent: 'expense', name: 'Fuel', amount: 18 }, ctx).kind).toBe('cost');
    expect(routedToIntake({ intent: 'owner_paid', name: 'Fuel', amount: 18 }, ctx).kind).toBe('ledger');
    expect(routedToIntake({ intent: 'issue', name: 'Parking' }, ctx).kind).toBe('issue');
    expect(routedToIntake({ intent: 'repair', name: 'Brake', scooterId: '41735' }, ctx).kind).toBe('ticket');
    expect(routedToIntake({ intent: 'task', name: 'Call municipality' }, ctx).kind).toBe('task');
  });

  it('keeps repair details, including whether the work is done', () => {
    const t = routedToIntake(
      { intent: 'repair', name: 'Brake cable', scooterId: '41735', minutes: 25, parts: ['brake cable'], completed: true },
      ctx,
    );
    expect(t.payload.scooterId).toBe('41735');
    expect(t.payload.minutes).toBe(25);
    expect(t.payload.parts).toEqual(['brake cable']);
    expect(t.payload.completed).toBe(true);
  });

  it('files nothing for questions or unknown intents', () => {
    expect(routedToIntake({ intent: 'question' }, ctx)).toBeNull();
    expect(routedToIntake({ intent: 'unknown' }, ctx)).toBeNull();
    expect(routedToIntake(null, ctx)).toBeNull();
  });
});
