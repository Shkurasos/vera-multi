const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyVote, sortComments, publicVotes } = require('./profile-comments');

function comment(id, createdAt, likes = [], dislikes = []) {
  return { id, createdAt, likes: [...likes], dislikes: [...dislikes] };
}

test('a vote replaces the previous one and a repeat clears it', () => {
  const c = comment('a', '2026-01-01T00:00:00.000Z');
  assert.equal(applyVote(c, 'u1', 'like'), 'like');
  assert.deepEqual(c.likes, ['u1']);
  assert.equal(applyVote(c, 'u1', 'like'), null);
  assert.deepEqual(publicVotes(c, 'u1'), { likes: 0, dislikes: 0, myVote: null });
  applyVote(c, 'u1', 'dislike');
  assert.deepEqual(c.likes, []);
  assert.deepEqual(publicVotes(c, 'u1'), { likes: 0, dislikes: 1, myVote: 'dislike' });
  assert.equal(applyVote(c, 'u1', 'like'), 'like');
  assert.deepEqual(publicVotes(c, 'u1'), { likes: 1, dislikes: 0, myVote: 'like' });
  assert.equal(applyVote(c, 'u2', 'nope'), null);
  assert.deepEqual(c.likes, ['u1']);
});

test('sort is new, old, or by like score', () => {
  const items = [
    comment('old-liked', '2026-01-01T00:00:00.000Z', ['a', 'b'], []),
    comment('new-plain', '2026-03-01T00:00:00.000Z'),
    comment('mid-mixed', '2026-02-01T00:00:00.000Z', ['a'], ['b', 'c']),
  ];
  assert.deepEqual(sortComments(items, 'new').map(c => c.id), ['new-plain', 'mid-mixed', 'old-liked']);
  assert.deepEqual(sortComments(items, 'old').map(c => c.id), ['old-liked', 'mid-mixed', 'new-plain']);
  assert.deepEqual(sortComments(items, 'likes').map(c => c.id), ['old-liked', 'new-plain', 'mid-mixed']);
  assert.deepEqual(items.map(c => c.id), ['old-liked', 'new-plain', 'mid-mixed']);
});
