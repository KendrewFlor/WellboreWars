import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cloudConfigured, decodeFields, parseLeaderboard, resultWrite, submitResult, fetchLeaderboard } from '../js/cloud.js';

test('cloud is off until configured, and calls fail safely', async () => {
  assert.equal(cloudConfigured(), false);
  assert.equal((await submitResult('Kendrew', true)).ok, false);
  assert.equal((await fetchLeaderboard()).ok, false);
});

test('Firestore values decode and leaderboard rows are sanitised', () => {
  assert.deepEqual(decodeFields({ name: { stringValue: 'A' }, wins: { integerValue: '12' } }), { name: 'A', wins: 12 });
  const rows = parseLeaderboard([
    { document: { name: 'projects/x/databases/(default)/documents/players/abc', fields: { name: { stringValue: '<b>Hax</b>' }, wins: { integerValue: '5' }, losses: { integerValue: '-3' } } } },
    { readTime: 'no document' },
    'garbage',
  ]);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { id: 'abc', name: 'bHaxb', wins: 5, losses: 0 });
  assert.deepEqual(parseLeaderboard({ not: 'an array' }), []);
});

test('the result write matches what firestore.rules allows', () => {
  const w = resultWrite('uid123', 'Kendrew', true).writes[0];
  assert.deepEqual(w.updateMask.fieldPaths, ['name']);
  assert.deepEqual(Object.keys(w.update.fields), ['name']);
  assert.deepEqual(w.updateTransforms.map((t) => t.fieldPath), ['wins', 'updatedAt']);
  assert.equal(w.updateTransforms[0].increment.integerValue, '1');
  assert.equal(w.updateTransforms[1].setToServerValue, 'REQUEST_TIME');
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  for (const f of ['name', 'wins', 'losses', 'updatedAt']) assert.ok(rules.includes(`'${f}'`), f);
  assert.ok(rules.includes('request.query.limit <= 25'));
  assert.ok(rules.includes('allow read, write: if false'));
});
