// Голоса и порядок стены профиля.
// Запись: { id, targetUserId, authorId, text, createdAt, likes?, dislikes? }.
// likes/dislikes — списки userId. У одного человека ровно один голос.

function voteLists(comment) {
  if (!Array.isArray(comment.likes)) comment.likes = [];
  if (!Array.isArray(comment.dislikes)) comment.dislikes = [];
}

function applyVote(comment, userId, value) {
  voteLists(comment);
  const vote = value === 'like' || value === 'dislike' ? value : null;
  const same = vote === 'like' ? comment.likes.includes(userId)
    : vote === 'dislike' ? comment.dislikes.includes(userId)
    : false;
  comment.likes = comment.likes.filter(id => id !== userId);
  comment.dislikes = comment.dislikes.filter(id => id !== userId);
  if (vote && !same) {
    (vote === 'like' ? comment.likes : comment.dislikes).push(userId);
  }
  return same ? null : vote;
}

function scoreOf(comment) {
  voteLists(comment);
  return comment.likes.length - comment.dislikes.length;
}

const SORTS = {
  new: (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
  old: (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
  likes: (a, b) => scoreOf(b) - scoreOf(a) || new Date(b.createdAt) - new Date(a.createdAt),
};

function sortComments(items, sort) {
  const cmp = SORTS[sort] || SORTS.new;
  return [...items].sort(cmp);
}

function publicVotes(comment, viewerId) {
  voteLists(comment);
  return {
    likes: comment.likes.length,
    dislikes: comment.dislikes.length,
    myVote: comment.likes.includes(viewerId) ? 'like'
      : comment.dislikes.includes(viewerId) ? 'dislike'
      : null,
  };
}

module.exports = { applyVote, scoreOf, sortComments, publicVotes };
