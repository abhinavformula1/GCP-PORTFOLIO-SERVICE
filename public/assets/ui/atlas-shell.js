/**
 * Atlas chat shell component.
 *
 * Builds and injects the Atlas launcher (floating FAB + teaser) and the
 * full chat overlay (header, messages area, input area) into a target element.
 *
 * Used by: portfolio page (main.js) and admin page (admin.js).
 */

import { createEl, materialIcon } from './dom.js';

const CHAT_HEADER_TITLE = 'Atlas';
const CHAT_HEADER_STATUS = ' VIRTUAL ASSISTANT';

function renderAtlasLauncher(handlers) {
  const teaserCta = createEl('button', { className: 'chat-teaser-cta', text: "Let's talk" });
  const fab = createEl('button', {
    id: 'chatFab',
    type: 'button',
    className: 'chat-fab-btn',
    'aria-label': 'Open assistant',
  }, [
    materialIcon('forum', { id: 'chatFabIcon' }),
  ]);

  if (typeof handlers?.openAssistant === 'function') {
    teaserCta.addEventListener('click', handlers.openAssistant);
  }
  if (typeof handlers?.toggleChatTeaser === 'function') {
    fab.addEventListener('click', handlers.toggleChatTeaser);
    fab.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      handlers.toggleChatTeaser();
    });
  }

  return createEl('div', { id: 'chatLauncher', className: 'chat-launcher' }, [
    createEl('div', { id: 'chatTeaser', className: 'chat-teaser', hidden: true }, [
      createEl('button', { id: 'chatTeaserClose', className: 'chat-teaser-close', text: '\u00d7' }),
      createEl('div', { className: 'chat-teaser-text', text: 'Hi! Looking to hire a Salesforce engineer?' }),
      teaserCta,
    ]),
    createEl('div', { className: 'chat-fab-wrap' }, [
      fab,
      createEl('span', { className: 'chat-fab-ping', 'aria-hidden': 'true' }),
    ]),
  ]);
}

function renderAtlasOverlay(handlers) {
  const startOver = createEl('button', {
    id: 'gaStartOverBtn',
    className: 'ga-header-btn ga-header-btn-icon',
    'aria-label': 'Refresh chat',
    title: 'Refresh chat',
    hidden: true,
  }, [
    materialIcon('refresh'),
  ]);
  const minimise = createEl('button', {
    className: 'ga-header-btn ga-header-btn-icon',
    'aria-label': 'Minimise',
    title: 'Minimise',
  }, [
    materialIcon('expand_more'),
  ]);

  if (typeof handlers?.restartAssistant === 'function') {
    startOver.addEventListener('click', handlers.restartAssistant);
  }
  if (typeof handlers?.minimiseAssistant === 'function') {
    minimise.addEventListener('click', handlers.minimiseAssistant);
  }

  return createEl('div', {
    id: 'assistantOverlay',
    className: 'ga-overlay',
    hidden: true,
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': 'Schedule a conversation',
  }, [
    createEl('div', { className: 'ga-modal' }, [
      createEl('div', { id: 'gaResizeHandle', className: 'ga-resize-handle', title: 'Drag to resize' }),
      createEl('div', { className: 'ga-header' }, [
        createEl('div', { className: 'ga-avatar', 'aria-hidden': 'true' }),
        createEl('div', { className: 'ga-header-info' }, [
          createEl('div', { className: 'ga-header-name', text: CHAT_HEADER_TITLE }),
          createEl('div', { className: 'ga-header-status' }, [
            createEl('span', { className: 'ga-status-dot' }),
            document.createTextNode(CHAT_HEADER_STATUS),
          ]),
        ]),
        createEl('div', { className: 'ga-header-actions' }, [
          startOver,
          minimise,
        ]),
      ]),
      createEl('div', { className: 'ga-progress-track' }, [
        createEl('div', { id: 'gaProgressBar', className: 'ga-progress-bar' }),
      ]),
      createEl('div', { id: 'gaMessages', className: 'ga-messages' }),
      createEl('div', { id: 'gaInputArea', className: 'ga-input-area' }),
    ]),
  ]);
}

export function renderAtlasShell(target, handlers) {
  const root = typeof target === 'string' ? document.querySelector(target) : target;
  if (!root) return;
  root.replaceChildren(
    renderAtlasLauncher(handlers || {}),
    renderAtlasOverlay(handlers || {})
  );
}
