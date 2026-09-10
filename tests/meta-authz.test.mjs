// Authorisation rules for creating and controlling Meta campaigns.
//
// These guard a specific mistake: granting a tester access by inserting a
// crm_team row. Every CRM policy keys off is_crm_member(), which tests
// membership and not role, so that row would also hand over every merchant's
// orders and ALL rights on crm_leads. The grant therefore lives in its own
// store-scoped table, and these tests pin the consequences of that split.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mayCreate, mayReduce } from '../api/meta/campaign-launch.js';

const admin  = { uid: 'u-admin',  role: 'admin',      scopes: [] };
const exec   = { uid: 'u-exec',   role: 'exec',       scopes: [] };
const tester = { uid: 'u-test',   role: null,         scopes: ['showme'] };
// A leftover crm_team row from the earlier design. It must buy nothing.
const stale  = { uid: 'u-stale',  role: 'ads_tester', scopes: [] };

test('admin may create for any store', () => {
  assert.equal(mayCreate(admin, 'showme'), true);
  assert.equal(mayCreate(admin, 'krupa-agarbatti'), true);
});

test('a scoped tester may create ONLY for the granted store', () => {
  assert.equal(mayCreate(tester, 'showme'), true);
  assert.equal(mayCreate(tester, 'krupa-agarbatti'), false);
  assert.equal(mayCreate(tester, 'sankalp'), false);
});

test('a scoped tester cannot create with no store named', () => {
  assert.equal(mayCreate(tester, ''), false);
  assert.equal(mayCreate(tester, undefined), false);
  assert.equal(mayCreate(tester, null), false);
});

test('a stale crm_team ads_tester role grants nothing — fails closed', () => {
  // The old design let this role create. Keeping that would have made the
  // dangerous crm_team row a working credential again.
  assert.equal(mayCreate(stale, 'showme'), false);
});

test('non-admin staff cannot create for an arbitrary store', () => {
  assert.equal(mayCreate(exec, 'showme'), false);
});

test('reducing delivery: staff anywhere, tester only in scope', () => {
  // Pause and stop only ever reduce spend, so staff may act anywhere.
  assert.equal(mayReduce(admin, 'krupa-agarbatti'), true);
  assert.equal(mayReduce(exec, 'krupa-agarbatti'), true);
  // A scoped tester may pause their own store's launch, nobody else's.
  assert.equal(mayReduce(tester, 'showme'), true);
  assert.equal(mayReduce(tester, 'krupa-agarbatti'), false);
});

test('scopes are matched exactly — no prefix or substring escape', () => {
  const t = { uid: 'u', role: null, scopes: ['showme'] };
  assert.equal(mayCreate(t, 'showme-2'), false);
  assert.equal(mayCreate(t, 'show'), false);
  assert.equal(mayCreate(t, 'notshowme'), false);
});

test('a tester holding several grants is confined to exactly those', () => {
  const multi = { uid: 'u', role: null, scopes: ['showme', 'sankalp'] };
  assert.equal(mayCreate(multi, 'showme'), true);
  assert.equal(mayCreate(multi, 'sankalp'), true);
  assert.equal(mayCreate(multi, 'krupa-agarbatti'), false);
});
