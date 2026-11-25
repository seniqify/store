// CRM training v2 (founder, 2026-11-25: "make training more detailed with
// screenshots and more information ... explain [the incentive] more detailed
// like use diagram or graphics"). Every screenshot a module names exists and
// its numbered markers match the steps; example shops point at live pages.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { MODULES } from '../src/crm/crmTraining.js';
import { BUSINESS_HOOKS, shopLink } from '../src/crm/crmScripts.js';
import { incentiveRule, incentiveRuleLines } from '../src/crm/crmLogic.js';

const SHOTS = JSON.parse(readFileSync(new URL('../src/crm/trainingShots.json', import.meta.url), 'utf8'));
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('every module is detailed: sections, a screenshot, mistakes, a self-check', () => {
  for (const m of MODULES) {
    assert.ok(m.sections.length >= 3, `${m.key} sections`);
    assert.ok(m.mistakes?.length >= 2, `${m.key} mistakes`);
    assert.ok(m.check && m.check.options[m.check.answer] && m.check.why, `${m.key} self-check`);
    if (m.key !== 'rules') assert.ok(m.sections.some((s) => s.shot || s.widget), `${m.key} has a picture`);
  }
  assert.ok(MODULES.find((m) => m.key === 'wins').sections.some((s) => s.widget === 'incentive'), 'the incentive explainer is in the wins module');
});

test('screenshots: the file exists, is small, and markers match the steps', () => {
  const used = MODULES.flatMap((m) => m.sections.filter((s) => s.shot));
  assert.ok(used.length >= 15);
  for (const s of used) {
    const meta = SHOTS[s.shot];
    assert.ok(meta, `${s.shot} in trainingShots.json`);
    const file = new URL(`../public/crm-training/${s.shot}.webp`, import.meta.url);
    assert.ok(existsSync(file), `${s.shot}.webp`);
    assert.ok(statSync(file).size < 200 * 1024, `${s.shot}.webp is small`);
    assert.equal(meta.marks.length, (s.steps || []).length, `${s.shot}: one step per marker`);
    for (const mk of meta.marks) assert.ok(mk.x >= 0 && mk.x <= 100 && mk.y >= 0 && mk.y <= 100, `${s.shot} #${mk.n} inside the image`);
    assert.deepEqual(meta.marks.map((x) => x.n), meta.marks.map((_, i) => i + 1), `${s.shot}: markers numbered 1..n`);
  }
});

test('example shops point at live demo pages, not the removed showcase shops', () => {
  const all = JSON.stringify([BUSINESS_HOOKS, MODULES]) + read('src/crm/crmFaq.js');
  for (const dead of ['rupasi-sarees', 'maharaja-sweets', 'annapurna-khanaval', 'solapur-chaddar', 'glow-grace-salon', 'vitthal-lodge']) assert.ok(!all.includes(dead), dead);
  const live = BUSINESS_HOOKS.filter((b) => b.shop).map((b) => shopLink(b.shop));
  assert.deepEqual(live, ['https://www.pocketlink.store/demo/aanyaboutique', 'https://www.pocketlink.store/demo/glowup']);
});

test('the incentive pictures follow the rule (Rs 300 by default, higher rate never lower)', () => {
  const r = incentiveRule({});
  assert.equal(r.monthly, 300);
  assert.equal(incentiveRule({ per_paid: 500 }).slab_monthly, 500, 'Rs 500 normal: the higher rate is not Rs 400');
  assert.match(incentiveRuleLines({ monthly: 300, pay_day: 'on the 6th of each month' }).join(' '), /Paid on the 6th of each month\./);
  const ex = read('src/crm/CrmIncentiveExplainer.jsx');
  assert.match(ex, /const NORMAL = '#4cb874';/, 'validated colours');
  assert.match(ex, /See as a table/, 'the chart has a table view');
  assert.match(ex, /role="img"/);
  for (const f of ['src/crm/CrmIncentives.jsx', 'src/crm/CrmTraining.jsx', 'src/crm/CrmSettings.jsx']) assert.match(read(f), /<IncentiveExplainer /, f);
});
