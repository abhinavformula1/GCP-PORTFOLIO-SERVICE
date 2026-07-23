const ENHANCEABLE_SELECTORS = [
  '.sd-seo-field select',
  '.sd-ai-setting-card select',
  '.sd-article-settings-field select',
  '.sd-sponsor-field select',
  '.sd-article-details-form select',
  '.sd-publish-seo-list select',
  '.sd-block-field select',
  '.sd-obs-filter-select',
  '.sd-media-select',
  '.sd-status-select',
].join(', ');

let activeInstance = null;
let isPatched = false;
let observer = null;

function isEnhanceableSelect(select) {
  return select instanceof HTMLSelectElement
    && !select.multiple
    && !select.size
    && !select.dataset.customSelectIgnore
    && !select.classList.contains('sd-custom-select-native')
    && select.matches(ENHANCEABLE_SELECTORS);
}

function getEnhanceableSelects(root) {
  const scope = root instanceof Element || root instanceof Document ? root : document;
  return Array.from(scope.querySelectorAll(ENHANCEABLE_SELECTORS)).filter(isEnhanceableSelect);
}

function closeActiveSelect() {
  if (activeInstance) activeInstance.close();
}

function patchSelectSetters() {
  if (isPatched) return;
  isPatched = true;

  const valueDescriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  if (valueDescriptor && valueDescriptor.configurable && typeof valueDescriptor.set === 'function') {
    Object.defineProperty(HTMLSelectElement.prototype, 'value', {
      configurable: true,
      enumerable: valueDescriptor.enumerable,
      get: valueDescriptor.get,
      set(value) {
        valueDescriptor.set.call(this, value);
        syncSelect(this);
      },
    });
  }

  const selectedIndexDescriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex');
  if (selectedIndexDescriptor && selectedIndexDescriptor.configurable && typeof selectedIndexDescriptor.set === 'function') {
    Object.defineProperty(HTMLSelectElement.prototype, 'selectedIndex', {
      configurable: true,
      enumerable: selectedIndexDescriptor.enumerable,
      get: selectedIndexDescriptor.get,
      set(value) {
        selectedIndexDescriptor.set.call(this, value);
        syncSelect(this);
      },
    });
  }
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getOptionMeta(option, index) {
  const label = String(option.dataset.label || option.textContent || '').trim();
  return {
    value: option.value,
    label,
    description: String(option.dataset.description || '').trim(),
    icon: String(option.dataset.icon || '').trim(),
    badge: String(option.dataset.badge || '').trim(),
    disabled: option.disabled,
    hidden: option.hidden,
    selected: option.selected,
    index,
  };
}

function renderOption(meta) {
  const iconHtml = meta.icon
    ? '<span class="material-symbols-outlined sd-custom-select-option-icon" aria-hidden="true">' + escapeHtml(meta.icon) + '</span>'
    : '<span class="sd-custom-select-option-icon sd-custom-select-option-icon--empty" aria-hidden="true"></span>';
  const descriptionHtml = meta.description
    ? '<span class="sd-custom-select-option-description">' + escapeHtml(meta.description) + '</span>'
    : '';
  const badgeHtml = meta.badge
    ? '<span class="sd-custom-select-option-badge">' + escapeHtml(meta.badge) + '</span>'
    : '';
  const disabledAttr = meta.disabled ? ' disabled' : '';
  const selectedClass = meta.selected ? ' is-selected' : '';

  return [
    '<button type="button" class="sd-custom-select-option' + selectedClass + '" data-option-index="' + meta.index + '"' + disabledAttr + ' role="option" aria-selected="' + String(meta.selected) + '">',
    '  <span class="sd-custom-select-option-main">',
    iconHtml,
    '    <span class="sd-custom-select-option-copy">',
    '      <span class="sd-custom-select-option-label-row">',
    '        <span class="sd-custom-select-option-label">' + escapeHtml(meta.label) + '</span>',
    badgeHtml,
    '      </span>',
    descriptionHtml,
    '    </span>',
    '  </span>',
    '  <span class="sd-custom-select-option-check material-symbols-outlined" aria-hidden="true">check_circle</span>',
    '</button>',
  ].join('');
}

function buildMenu(instance) {
  const list = instance.menuList;
  const options = Array.from(instance.select.options).map(getOptionMeta).filter(function (option) {
    return !option.hidden;
  });
  instance.options = options;
  list.innerHTML = options.map(renderOption).join('');
}

function updateTrigger(instance) {
  const selectedOption = instance.select.selectedOptions[0] || instance.select.options[instance.select.selectedIndex] || instance.select.options[0];
  const meta = selectedOption ? getOptionMeta(selectedOption, instance.select.selectedIndex) : { label: '', description: '', icon: '', badge: '' };
  instance.triggerLabel.textContent = meta.label || instance.select.getAttribute('placeholder') || 'Select';
  instance.triggerDescription.textContent = meta.description || '';
  instance.triggerDescription.hidden = !meta.description;
  instance.triggerBadge.textContent = meta.badge || '';
  instance.triggerBadge.hidden = !meta.badge;
  if (meta.icon) {
    instance.triggerIcon.textContent = meta.icon;
    instance.triggerIcon.hidden = false;
  } else {
    instance.triggerIcon.textContent = '';
    instance.triggerIcon.hidden = true;
  }
  instance.root.classList.toggle('is-disabled', instance.select.disabled);
}

function scrollMenuListToButton(instance, optionButton) {
  if (!instance || !instance.menuList || !(optionButton instanceof HTMLElement)) return;
  const list = instance.menuList;
  const viewTop = list.scrollTop;
  const viewBottom = viewTop + list.clientHeight;
  const top = optionButton.offsetTop;
  const bottom = top + optionButton.offsetHeight;
  if (top < viewTop) list.scrollTop = top;
  else if (bottom > viewBottom) list.scrollTop = Math.max(0, bottom - list.clientHeight);
}

function focusOption(instance, index) {
  if (!instance.options.length) return;
  const safeIndex = Math.max(0, Math.min(index, instance.options.length - 1));
  const optionButton = instance.menuList.querySelector('[data-option-index="' + instance.options[safeIndex].index + '"]');
  if (!optionButton) return;
  instance.focusedIndex = safeIndex;
  instance.menuList.querySelectorAll('.sd-custom-select-option').forEach(function (button) {
    button.classList.toggle('is-focused', button === optionButton);
  });
  optionButton.focus({ preventScroll: true });
  scrollMenuListToButton(instance, optionButton);
}

function openSelect(instance) {
  if (instance.select.disabled) return;
  if (activeInstance && activeInstance !== instance) activeInstance.close();
  buildMenu(instance);
  updateTrigger(instance);
  instance.menu.hidden = false;
  instance.root.classList.add('is-open');
  instance.trigger.setAttribute('aria-expanded', 'true');
  activeInstance = instance;
  instance.openedAt = Date.now();

  // Position first so focusing doesn't scroll the window and instantly close.
  positionMenu(instance);

  const selectedIndex = instance.options.findIndex(function (option) { return option.selected && !option.disabled; });
  focusOption(instance, selectedIndex >= 0 ? selectedIndex : 0);
}

function positionMenu(instance) {
  if (!instance || !instance.menu || !instance.menuList) return;
  // Reset to default (down).
  instance.menu.style.top = '';
  instance.menu.style.bottom = '';
  instance.menu.dataset.placement = 'down';

  if (!instance.root.classList.contains('is-open')) return;
  const triggerRect = instance.trigger.getBoundingClientRect();
  const margin = 12;
  const spaceBelow = window.innerHeight - triggerRect.bottom;
  const spaceAbove = triggerRect.top;
  // Match CSS: max-height: min(320px, 48vh)
  const cap = Math.min(320, Math.floor(window.innerHeight * 0.48));

  // If the menu would overflow below, flip above when there's more room.
  if (spaceBelow < cap + margin && spaceAbove > spaceBelow) {
    instance.menu.style.top = 'auto';
    instance.menu.style.bottom = 'calc(100% + 10px)';
    instance.menu.dataset.placement = 'up';
  }
}

function closeSelect(instance, restoreFocus) {
  instance.menu.hidden = true;
  instance.root.classList.remove('is-open');
  instance.trigger.setAttribute('aria-expanded', 'false');
  instance.menuList.querySelectorAll('.sd-custom-select-option').forEach(function (button) {
    button.classList.remove('is-focused');
  });
  if (activeInstance === instance) activeInstance = null;
  if (restoreFocus) instance.trigger.focus();
}

function chooseOption(instance, optionIndex) {
  const option = instance.options.find(function (item) { return item.index === optionIndex; });
  if (!option || option.disabled) return;
  if (instance.select.value !== option.value) {
    instance.select.value = option.value;
    instance.select.dispatchEvent(new Event('input', { bubbles: true }));
    instance.select.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    syncSelect(instance.select);
  }
  closeSelect(instance, true);
}

function handleTriggerKeydown(instance, event) {
  switch (event.key) {
    case 'ArrowDown':
    case 'ArrowUp':
    case 'Enter':
    case ' ':
      event.preventDefault();
      openSelect(instance);
      break;
    default:
      break;
  }
}

function handleMenuKeydown(instance, event) {
  if (!instance.root.classList.contains('is-open')) return;
  switch (event.key) {
    case 'Escape':
      event.preventDefault();
      closeSelect(instance, true);
      break;
    case 'ArrowDown':
      event.preventDefault();
      focusOption(instance, instance.focusedIndex + 1);
      break;
    case 'ArrowUp':
      event.preventDefault();
      focusOption(instance, instance.focusedIndex - 1);
      break;
    case 'Home':
      event.preventDefault();
      focusOption(instance, 0);
      break;
    case 'End':
      event.preventDefault();
      focusOption(instance, instance.options.length - 1);
      break;
    case 'Enter':
    case ' ':
      event.preventDefault();
      if (instance.focusedIndex >= 0 && instance.options[instance.focusedIndex]) {
        chooseOption(instance, instance.options[instance.focusedIndex].index);
      }
      break;
    case 'Tab':
      closeSelect(instance, false);
      break;
    default:
      break;
  }
}

function enhanceSelect(select) {
  if (!isEnhanceableSelect(select)) return null;
  if (select.__customSelectInstance) {
    syncSelect(select);
    return select.__customSelectInstance;
  }

  const root = document.createElement('div');
  root.className = 'sd-custom-select';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'sd-custom-select-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');

  const triggerMain = document.createElement('span');
  triggerMain.className = 'sd-custom-select-trigger-main';

  const triggerIcon = document.createElement('span');
  triggerIcon.className = 'material-symbols-outlined sd-custom-select-trigger-icon';
  triggerIcon.hidden = true;

  const triggerCopy = document.createElement('span');
  triggerCopy.className = 'sd-custom-select-trigger-copy';

  const triggerLabelRow = document.createElement('span');
  triggerLabelRow.className = 'sd-custom-select-trigger-label-row';

  const triggerLabel = document.createElement('span');
  triggerLabel.className = 'sd-custom-select-trigger-label';

  const triggerBadge = document.createElement('span');
  triggerBadge.className = 'sd-custom-select-trigger-badge';
  triggerBadge.hidden = true;

  const triggerDescription = document.createElement('span');
  triggerDescription.className = 'sd-custom-select-trigger-description';
  triggerDescription.hidden = true;

  const triggerChevron = document.createElement('span');
  triggerChevron.className = 'material-symbols-outlined sd-custom-select-trigger-chevron';
  triggerChevron.textContent = 'expand_more';
  triggerChevron.setAttribute('aria-hidden', 'true');

  triggerLabelRow.append(triggerLabel, triggerBadge);
  triggerCopy.append(triggerLabelRow, triggerDescription);
  triggerMain.append(triggerIcon, triggerCopy);
  trigger.append(triggerMain, triggerChevron);

  const menu = document.createElement('div');
  menu.className = 'sd-custom-select-menu';
  menu.hidden = true;

  const menuList = document.createElement('div');
  menuList.className = 'sd-custom-select-list';
  menuList.setAttribute('role', 'listbox');
  menu.appendChild(menuList);

  select.classList.add('sd-custom-select-native');
  select.parentNode.insertBefore(root, select);
  root.append(select, trigger, menu);

  const instance = {
    select,
    root,
    trigger,
    triggerIcon,
    triggerLabel,
    triggerBadge,
    triggerDescription,
    triggerChevron,
    menu,
    menuList,
    options: [],
    focusedIndex: -1,
    close(restoreFocus) {
      closeSelect(instance, Boolean(restoreFocus));
    },
  };

  select.__customSelectInstance = instance;

  trigger.addEventListener('click', function () {
    if (instance.root.classList.contains('is-open')) closeSelect(instance, true);
    else openSelect(instance);
  });
  trigger.addEventListener('keydown', function (event) {
    handleTriggerKeydown(instance, event);
  });
  menuList.addEventListener('click', function (event) {
    const button = event.target.closest('.sd-custom-select-option');
    if (!button) return;
    chooseOption(instance, Number(button.dataset.optionIndex));
  });
  menuList.addEventListener('keydown', function (event) {
    handleMenuKeydown(instance, event);
  });
  select.addEventListener('change', function () {
    syncSelect(select);
  });

  const selectObserver = new MutationObserver(function () {
    syncSelect(select);
  });
  selectObserver.observe(select, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['disabled', 'hidden', 'label'],
  });

  syncSelect(select);
  return instance;
}

export function syncSelect(select) {
  if (!(select instanceof HTMLSelectElement)) return;
  const instance = select.__customSelectInstance || enhanceSelect(select);
  if (!instance) return;
  buildMenu(instance);
  updateTrigger(instance);
}

export function refreshCustomSelects(root = document) {
  getEnhanceableSelects(root).forEach(function (select) {
    enhanceSelect(select);
  });
}

export function initCustomSelects(root = document) {
  patchSelectSetters();
  refreshCustomSelects(root);

  if (!observer) {
    observer = new MutationObserver(function (mutations) {
      const pending = new Set();
      mutations.forEach(function (mutation) {
        if (mutation.target instanceof HTMLSelectElement) pending.add(mutation.target);
        mutation.addedNodes.forEach(function (node) {
          if (!(node instanceof Element)) return;
          if (node instanceof HTMLSelectElement && isEnhanceableSelect(node)) pending.add(node);
          getEnhanceableSelects(node).forEach(function (select) { pending.add(select); });
        });
      });
      pending.forEach(function (select) { syncSelect(select); });
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled', 'hidden', 'label'],
    });
  }

  if (!document.body.dataset.customSelectsBound) {
    document.body.dataset.customSelectsBound = 'true';
    document.addEventListener('click', function (event) {
      if (!activeInstance) return;
      if (!activeInstance.root.contains(event.target)) closeActiveSelect();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && activeInstance) {
        event.preventDefault();
        closeActiveSelect();
      }
    });
    window.addEventListener('resize', closeActiveSelect);
    // Close on scroll *outside* the active select. If we close on every scroll
    // event (capture), the menu immediately collapses when its own list scrolls.
    window.addEventListener('scroll', function (event) {
      if (!activeInstance) return;
      if (activeInstance.openedAt && Date.now() - activeInstance.openedAt < 250) return;
      const target = event && event.target;
      if (target instanceof Node && activeInstance.root.contains(target)) return;
      closeActiveSelect();
    }, true);
  }
}
