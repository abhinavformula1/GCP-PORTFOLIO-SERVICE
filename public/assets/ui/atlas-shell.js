/**
 * Atlas chat shell component.
 *
 * Builds and injects the Atlas launcher (floating FAB + teaser) and the
 * full chat overlay (header, messages area, input area) into a target element.
 *
 * Used by: portfolio page (main.js) and admin page (admin.js).
 */

import { createEl, materialIcon } from './dom.js';

function renderAtlasLauncher(handlers) {
  const teaserCta = createEl('button', { className: 'chat-teaser-cta', text: "Let's talk" });
  const fab = createEl('button', {
    id: 'chatFab',
    type: 'button',
    className: 'chat-fab-btn',
    'aria-label': 'Open assistant',
  }, [
    materialIcon('chat', { id: 'chatFabIcon' }),
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

  return createEl('div', { id: 'chatLauncher', className: 'chat-launcher', hidden: true }, [
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
    className: 'ga-header-btn',
    'aria-label': 'Start over',
    title: 'Start over',
    hidden: true,
    text: '\u21bb',
  });
  const minimise = createEl('button', {
    className: 'ga-header-btn',
    'aria-label': 'Minimise',
    title: 'Minimise',
    text: '\u2212',
  });
  const close = createEl('button', {
    className: 'ga-header-btn ga-close',
    'aria-label': 'Close',
    title: 'Close',
    text: '\u00d7',
  });

  if (typeof handlers?.restartAssistant === 'function') {
    startOver.addEventListener('click', handlers.restartAssistant);
  }
  if (typeof handlers?.minimiseAssistant === 'function') {
    minimise.addEventListener('click', handlers.minimiseAssistant);
  }
  if (typeof handlers?.closeAssistant === 'function') {
    close.addEventListener('click', handlers.closeAssistant);
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
        createEl('div', { className: 'ga-avatar', text: 'AK' }),
        createEl('div', { className: 'ga-header-info' }, [
          createEl('div', { className: 'ga-header-name', text: 'Atlas' }),
          createEl('div', { className: 'ga-header-status' }, [
            createEl('span', { className: 'ga-status-dot' }),
            document.createTextNode(' virtual assistant'),
          ]),
        ]),
        createEl('div', { className: 'ga-header-actions' }, [
          startOver,
          minimise,
          close,
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
