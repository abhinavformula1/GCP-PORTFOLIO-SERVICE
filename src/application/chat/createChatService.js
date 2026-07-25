'use strict';

const { ValidationError } = require('../../domain/errors');
const { assertPort } = require('../ports/assert');

function createChatService(repository) {
  assertPort(repository, 'application.chat.repository', [
    'getActiveChat',
    'upsertActiveChat',
    'clearActiveChat',
    'completeActiveChat',
  ]);

  return Object.freeze({
    getActive(uid) {
      return repository.getActiveChat(uid);
    },
    saveActive(uid, input) {
      const { step, answers, message, locale } = input || {};
      if (message && (typeof message !== 'object' || typeof message.text !== 'string')) {
        throw new ValidationError('Invalid message payload.');
      }
      if (step !== undefined && (typeof step !== 'number' || step < 0 || step > 50)) {
        throw new ValidationError('Invalid step.');
      }
      if (answers !== undefined && (typeof answers !== 'object' || answers === null)) {
        throw new ValidationError('Invalid answers payload.');
      }
      return repository.upsertActiveChat(uid, { step, answers, message, locale });
    },
    clearActive(uid) {
      return repository.clearActiveChat(uid);
    },
    completeActive(uid, input) {
      const { salesforceId, alreadySubmitted } = input || {};
      return repository.completeActiveChat(uid, { salesforceId, alreadySubmitted });
    },
  });
}

module.exports = { createChatService };
