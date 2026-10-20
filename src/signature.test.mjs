import test from 'node:test';
import assert from 'node:assert/strict';
import { stripOwnPrefix } from './signature.mjs';

test('212/AC-1 a sender-typed role prefix is dropped, repeats included', () => {
  assert.equal(stripOwnPrefix('TL 💬 PM: 已完成', ['tl', 'pm']), '已完成');
  assert.equal(stripOwnPrefix('TL：TL 💬 done', ['tl']), 'done');
  assert.equal(stripOwnPrefix('Ivan/TL 💬\nbody', []), 'body');
});

test('212/AC-1 ordinary text and slash commands are left alone', () => {
  assert.equal(stripOwnPrefix('Note: tests pass', ['tl']), 'Note: tests pass');
  assert.equal(stripOwnPrefix('這一步完成了 但 💬 之後', ['tl']), '這一步完成了 但 💬 之後');
  assert.equal(stripOwnPrefix('/clear', ['tl']), '/clear');
});
