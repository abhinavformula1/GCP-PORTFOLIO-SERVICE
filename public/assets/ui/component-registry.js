/**
 * component-registry.js
 * Single source of truth for every configurable component in the CMS.
 * Admin can enable / disable each entry from the Metadata Configuration page.
 * The composer reads this registry to build its block insertion menu.
 */

export const COMPONENT_REGISTRY = [
  // ── Editor block components ──────────────────────────────────────────────
  {
    id:       'block_table',
    group:    'Editor Blocks',
    label:    'Table',
    icon:     'table_rows',
    hint:     'Rows & columns — compare specs, configs or properties.',
    defaultEnabled: true,
  },
  {
    id:       'block_hero',
    group:    'Editor Blocks',
    label:    'Selected Design',
    icon:     'stars',
    hint:     'Highlight the chosen architecture with a kicker, heading and decision summary.',
    defaultEnabled: true,
  },
  {
    id:       'block_cards',
    group:    'Editor Blocks',
    label:    'Info Cards',
    icon:     'grid_view',
    hint:     'Key facts as a tile grid — e.g. design goals, constraints, or system properties.',
    defaultEnabled: true,
  },
  {
    id:       'block_flow',
    group:    'Editor Blocks',
    label:    'Flow',
    icon:     'linear_scale',
    hint:     'Left-to-right pipeline steps — e.g. auth flow, data path, or trust boundary.',
    defaultEnabled: true,
  },
  {
    id:       'block_comparison',
    group:    'Editor Blocks',
    label:    'Comparison',
    icon:     'compare_arrows',
    hint:     'Options with Chosen / Rejected / Considered status and reasoning.',
    defaultEnabled: true,
  },
  {
    id:       'block_sequence',
    group:    'Editor Blocks',
    label:    'Sequence',
    icon:     'format_list_numbered',
    hint:     'Numbered steps for a technical flow — e.g. request lifecycle or boot sequence.',
    defaultEnabled: true,
  },
  {
    id:       'block_risks',
    group:    'Editor Blocks',
    label:    'Risk Grid',
    icon:     'warning',
    hint:     'Risk cards with Low / Medium / High severity and mitigation notes.',
    defaultEnabled: true,
  },
  {
    id:       'block_code',
    group:    'Editor Blocks',
    label:    'Code Block',
    icon:     'terminal',
    hint:     'Syntax-highlighted snippet — pick the language from the header bar.',
    defaultEnabled: true,
  },
  {
    id:       'block_image',
    group:    'Editor Blocks',
    label:    'Image',
    icon:     'image',
    hint:     'Upload a JPEG, PNG, GIF, WebP or SVG with alt text and caption.',
    defaultEnabled: true,
  },

  // ── Page features ────────────────────────────────────────────────────────
  {
    id:       'feature_tier_gate',
    group:    'Page Features',
    label:    'Tier Gate',
    icon:     'workspace_premium',
    hint:     'Lock premium articles behind a tier gate with configurable benefit cards.',
    defaultEnabled: true,
  },
  {
    id:       'feature_pdf_export',
    group:    'Page Features',
    label:    'PDF Export',
    icon:     'picture_as_pdf',
    hint:     'Allow readers to download articles as a formatted PDF.',
    defaultEnabled: true,
  },
  {
    id:       'feature_hire_me',
    group:    'Page Features',
    label:    'Hire Me Modal',
    icon:     'work',
    hint:     'Show a "Hire Me" contact form on the public portfolio page.',
    defaultEnabled: true,
  },
  {
    id:       'feature_contact_info',
    group:    'Page Features',
    label:    'Contact Info',
    icon:     'contact_page',
    hint:     'Show recruiter contact channels (email, phone, LinkedIn, Trailblazer).',
    defaultEnabled: true,
  },

  // ── UI Components ────────────────────────────────────────────────────────
  {
    id:       'ui_icon_cards',
    group:    'UI Components',
    label:    'Icon Cards',
    icon:     'grid_on',
    hint:     'Circular icon + label card grid — used in the tier gate and benefit lists.',
    defaultEnabled: true,
  },
  {
    id:       'ui_welcome_overlay',
    group:    'UI Components',
    label:    'Welcome Overlay',
    icon:     'waving_hand',
    hint:     'First-visit welcome modal shown to new readers.',
    defaultEnabled: true,
  },
];

/** Map from registry id → INSERT_ITEMS type key in composer.js */
export const BLOCK_ID_TO_TYPE = {
  block_table:      'matrix',
  block_hero:       'hero',
  block_cards:      'cards',
  block_flow:       'flow',
  block_comparison: 'comparison',
  block_sequence:   'sequence',
  block_risks:      'risks',
  block_code:       'code',
  block_image:      'image',
};

/**
 * Given a flat enabled map (id → boolean), return the set of block types
 * that should appear in the composer insert menu.
 * Falls back to all enabled if the map is empty / null.
 */
export function enabledBlockTypes(enabledMap) {
  if (!enabledMap || !Object.keys(enabledMap).length) {
    return new Set(Object.values(BLOCK_ID_TO_TYPE));
  }
  const types = new Set();
  Object.entries(BLOCK_ID_TO_TYPE).forEach(function ([id, type]) {
    if (enabledMap[id] !== false) types.add(type);
  });
  return types;
}
