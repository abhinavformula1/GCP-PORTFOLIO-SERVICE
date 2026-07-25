'use strict';

function toMillis(value) {
  if (value == null) return null;
  if (typeof value.toMillis === 'function') return value.toMillis();
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

module.exports = { toMillis };
