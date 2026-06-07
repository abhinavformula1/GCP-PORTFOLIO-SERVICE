// ESLint flat config — see https://eslint.org/docs/latest/use/configure/configuration-files
//
// Strategy:
//   - eslint:recommended baseline (catches real bugs: no-undef, no-unused-vars, etc.)
//   - Three modernization rules layered on top: no-var, prefer-const, eqeqeq
//   - Front-end (public/assets/**) treated as ES modules with browser globals
//   - Back-end (src/**, server.js, scripts/**) treated as CommonJS with Node globals
//   - Modernization rules start at 'warn' so CI doesn't go red on day one. Promote
//     to 'error' once the codebase is cleaned up.

const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  // Files ESLint should not look at. node_modules is excluded by default.
  {
    ignores: [
      'package-lock.json',
      'public/assets/vendor/**', // future-proof: any third-party drop-ins
    ],
  },

  // Baseline: ESLint's built-in recommended ruleset (~75 rules).
  js.configs.recommended,

  // Project-wide tweaks to the recommended rules — relax patterns that are
  // intentional conventions in this codebase, not bugs.
  {
    rules: {
      // Allow `function (err, req, res, _next)` (Express middleware that
      // doesn't call next) and `catch (_) {}` (intentionally swallowed).
      'no-unused-vars': ['error', {
        argsIgnorePattern:         '^_',
        varsIgnorePattern:         '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      // Allow `try { ... } catch (_) {}` — empty catch is sometimes the right
      // thing (e.g. best-effort sessionStorage access in incognito mode).
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  // Front-end: ES modules running in the browser.
  {
    files: ['public/assets/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        // Google Identity Services SDK is loaded via <script> tag in
        // index.html; the global `google.accounts.id` is referenced from JS.
        google: 'readonly',
      },
    },
    rules: {
      'no-var':       'warn',
      'prefer-const': 'warn',
      'eqeqeq':       ['warn', 'smart'],
    },
  },

  // Back-end: CommonJS running on Node. Includes config files at the repo
  // root (eslint.config.js itself) so they get the right globals.
  {
    files: ['src/**/*.js', 'server.js', 'scripts/**/*.js', '*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-var':       'error',
      'prefer-const': 'error',
      'eqeqeq':       ['error', 'smart'],
    },
  },

  // Test files: same rules but allow the usual test globals.
  {
    files: ['**/*.test.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
  },
];
