'use strict';

const express = require('express');
const { body, validationResult } = require('express-validator');
const { ValidationError } = require('../../../domain/errors');
const { assertDependencies } = require('../../../application/ports/assert');

function createRouter(dependencies) {
  assertDependencies(dependencies, 'interfaces.routes.atlas', {
    requireAuth: 'function',
    atlasLimiter: 'function',
    atlas: ['submit', 'stream', 'activeConversation', 'usage', 'clearConversation', 'publicConfig'],
  });
  const { requireAuth, atlasLimiter, atlas } = dependencies;
  const router = express.Router();
  const validateAsk = [
    body('message')
      .trim()
      .notEmpty().withMessage('Message is required.')
      .isLength({ max: atlas.maxUserMessageChars })
      .withMessage(`Message must be ${atlas.maxUserMessageChars} characters or fewer.`),
    body('history')
      .optional()
      .isArray({ max: atlas.maxHistoryTurns * 2 })
      .withMessage(`History must be an array of at most ${atlas.maxHistoryTurns * 2} turns.`),
    body('model')
      .optional()
      .isIn(atlas.modelKeys)
      .withMessage(`Model must be one of: ${atlas.modelKeys.join(', ')}.`),
  ];

  function validate(req) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new ValidationError(
        errors.array()[0].msg,
        errors.array().map((error) => ({ field: error.path, message: error.msg }))
      );
    }
  }

  router.post('/atlas/ask', requireAuth, atlasLimiter, validateAsk, async (req, res, next) => {
    try {
      validate(req);
      return res.status(200).json(await atlas.submit(req.body, req.user));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/atlas/stream', requireAuth, atlasLimiter, validateAsk, async (req, res, next) => {
    try {
      validate(req);
    } catch (error) {
      return next(error);
    }
    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    if (res.flushHeaders) res.flushHeaders();
    let aborted = false;
    req.on('close', () => { aborted = true; });
    try {
      for await (const event of atlas.stream(req.body, req.user, () => aborted)) {
        if (aborted) break;
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } finally {
      if (!res.writableEnded) res.end();
    }
    return undefined;
  });

  router.get('/atlas/conversations/active', requireAuth, async (req, res, next) => {
    try {
      return res.status(200).json(await atlas.activeConversation(req.user.uid));
    } catch (error) { return next(error); }
  });
  router.get('/atlas/usage', requireAuth, async (req, res, next) => {
    try {
      return res.status(200).json(await atlas.usage(req.user.uid));
    } catch (error) { return next(error); }
  });
  router.delete('/atlas/conversations/active', requireAuth, async (req, res, next) => {
    try {
      return res.status(200).json(await atlas.clearConversation(req.user.uid));
    } catch (error) { return next(error); }
  });
  router.get('/atlas/config', async (_req, res, next) => {
    try {
      return res.json(await atlas.publicConfig());
    } catch (error) { return next(error); }
  });

  return router;
}

module.exports = { createRouter };
