/* eslint-env node */
// ESLint configuration — Diego owns (Wave 3).
//
// Using the legacy .eslintrc.cjs config format (matching ESLint 8.x) rather
// than the flat config. Reasons:
//   1. eslint-plugin-jsx-a11y 6.9 and eslint-plugin-react 7.35 still ship
//      legacy-format extends ("plugin:jsx-a11y/recommended"); flat-config
//      adapters exist but add a Wave-3 unknown for no win.
//   2. The legacy format reads identically to the conventions in the project
//      docs.
//
// Wave-2 follow-ups encoded here:
//   - jsx-a11y/aria-proptypes: RESTORED to `error` in Phase 7 (Diego Wave 29).
//     The Wave-2 `warn` downgrade existed because eslint-plugin-jsx-a11y 6.9
//     rejected dynamic boolean ARIA attrs (toolbar-button, sidebar tabs) and
//     had no `allowedDynamic` escape hatch. The installed plugin is now 6.10.2
//     (handles dynamic booleans) and Riley's Wave-28a a11y remediation removed
//     all component-level workarounds, so the rule is back at `error`. See the
//     rule entry in `rules:` below for the full rationale.
//   - no-restricted-imports constrains src/client/** away from main-process
//     internals; the gatekeeper src/client/types/ipc-contract.ts is the only
//     legal cross-boundary import (type-only re-export from src/ipc/contracts).
//   - @typescript-eslint/no-explicit-any: error — conventions §1.2 requires
//     a justifying comment via the disable directive.

module.exports = {
  root: true,
  env: {
    es2022: true,
    node: true,
    browser: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
    // Project references slow lint down significantly; only opt-in for rules
    // that need type info. For now stay project-less for speed.
  },
  plugins: [
    '@typescript-eslint',
    'react',
    'react-hooks',
    'jsx-a11y',
    'import',
  ],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
    'plugin:jsx-a11y/recommended',
    'plugin:import/recommended',
    'plugin:import/typescript',
    'prettier', // disables all stylistic rules that fight prettier
  ],
  settings: {
    react: { version: '18.3' },
    // Note: we do NOT enable the typescript import resolver here. The
    // eslint-import-resolver-typescript package is not in our dep tree
    // (it's a transitive dep of some configs but not all plugin versions
    // agree on the resolver interface). Leaving the resolver at node-default
    // means import/namespace + import/no-duplicates degrade gracefully on
    // .js-extension TypeScript imports; the TypeScript compiler still owns
    // the authoritative resolution check via `npm run typecheck`.
    'import/resolver': {
      node: { extensions: ['.js', '.ts', '.tsx', '.cjs', '.mjs'] },
    },
    // Treat .ts/.tsx imports as resolvable by the import plugin's static
    // analyzer without requiring on-disk resolution.
    'import/parsers': {
      '@typescript-eslint/parser': ['.ts', '.tsx'],
    },
  },
  ignorePatterns: [
    'dist/',
    'release/',
    'node_modules/',
    'coverage/',
    'playwright-report/',
    'test-results/',
    '*.cjs',
    '*.config.ts',
    '*.config.js',
    'src/client/vite.config.ts',
    'src/client/vitest.setup.ts',
  ],
  rules: {
    // --- TypeScript -------------------------------------------------------
    '@typescript-eslint/no-explicit-any': 'error', // conventions §1.2
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/consistent-type-imports': [
      'error',
      { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
    ],

    // --- Safety floor (Phase 2.5 Wave 10, Diego) -------------------------
    // Added in Phase 2.5 cleanup. All four rules have zero impact on the
    // current codebase (verified by running ESLint with each rule enabled —
    // 0 new violations). They are ratchets against future regressions:
    //   - eqeqeq:           conventions §1 (no implicit-coercion comparisons).
    //   - no-var:           the one legitimate `var` (a `declare global` in
    //                       document-store.ts) carries its own disable line.
    //   - no-throw-literal: per conventions §13.1 the project uses
    //                       Result<T, E> not exceptions; if anyone wraps a
    //                       non-Error literal in `throw`, fail fast.
    //   - no-debugger:      debugger statements never ship.
    //   - no-alert:         renderer uses the toast pattern, not `alert()`.
    'eqeqeq': ['error', 'always'],
    'no-var': 'error',
    'no-throw-literal': 'error',
    'no-debugger': 'error',
    'no-alert': 'error',

    // --- React ------------------------------------------------------------
    'react/react-in-jsx-scope': 'off', // react-jsx transform
    'react/prop-types': 'off', // we use TypeScript
    'react/jsx-uses-react': 'off',
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',

    // --- a11y -------------------------------------------------------------
    // Phase-7 (Diego, Wave 29) — RESTORED to `error` from `warn` (P7-L-4
    // acceptance criterion). The Wave-2 `warn` workaround was written against
    // eslint-plugin-jsx-a11y 6.9, which (per the Wave-3 learnings entry)
    // rejected dynamic boolean ARIA attrs (aria-pressed / aria-selected from
    // TS-proven booleans) and offered no `allowedDynamic` escape hatch. The
    // installed plugin is now 6.10.2, which correctly accepts dynamic boolean
    // ARIA. Riley's Wave-28a a11y remediation removed every component-level
    // literal-branch workaround and empirically verified `npx eslint
    // --rule '{"jsx-a11y/aria-proptypes":"error"}' src/client` reports ZERO
    // violations across the entire renderer tree. Re-verified clean at `error`
    // in Wave 29. The IDE's bundled (older) a11y analyzer still false-flags
    // `aria-selected={expr}`; trust the CLI (`npx eslint`) — it is the gate.
    'jsx-a11y/aria-proptypes': 'error',

    // --- Imports / boundary enforcement ----------------------------------
    'import/no-unresolved': 'off', // TypeScript owns resolution checks
    'import/namespace': 'off', // requires full resolver; tsc owns this
    'import/default': 'off',
    'import/no-named-as-default-member': 'off',
    'import/no-duplicates': 'warn',
    'import/order': [
      'warn',
      {
        groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
        'newlines-between': 'always',
        alphabetize: { order: 'asc', caseInsensitive: true },
      },
    ],
  },
  overrides: [
    // -------- Renderer boundary enforcement -------------------------------
    // Per conventions §4.3 and Riley's gatekeeper module: src/client/** may
    // not import from main-process internals nor from `electron` directly.
    // The only legal cross-boundary touch is type-only via
    // src/client/types/ipc-contract.ts → src/ipc/contracts.ts.
    {
      files: ['src/client/**/*.{ts,tsx}'],
      excludedFiles: ['src/client/types/ipc-contract.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['electron', 'electron/*'],
                message: 'Renderer must access Electron only via window.pdfApi (see src/client/services/api.ts).',
              },
              {
                group: ['**/src/main/**', '**/src/preload/**', '**/src/db/**', '**/src/ipc/handlers/**'],
                message: 'Renderer may not import main-process code. Use window.pdfApi (services/api.ts) or the gatekeeper at src/client/types/ipc-contract.ts.',
              },
              {
                // Wave 8.5 H-2 (Julian's Phase 2 §G): the gatekeeper at
                // src/client/types/ipc-contract.ts is the ONLY legal route to
                // the IPC contract types. Direct imports from src/ipc/contracts
                // bypass the boundary documented in conventions §4.3. Riley's
                // Wave 7 manual catch on David's drift held, but the lint that
                // §4.3 says enforces this was missing this pattern.
                group: ['**/src/ipc/contracts', '**/src/ipc/contracts.*', '**/ipc/contracts', '**/ipc/contracts.*'],
                message: 'Renderer must route through src/client/types/ipc-contract.ts (the gatekeeper). Direct imports from src/ipc/contracts bypass the boundary documented in conventions.md §4.3.',
              },
            ],
          },
        ],
      },
    },

    // -------- Main-process boundary --------------------------------------
    // Main may not import the renderer's React tree or client services.
    {
      files: ['src/main/**/*.ts', 'src/ipc/**/*.ts', 'src/preload/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['**/src/client/**'],
                message: 'Main/preload/ipc must not import renderer code.',
              },
            ],
          },
        ],
      },
    },

    // -------- Tests relax `any` ban modestly ------------------------------
    {
      files: ['**/*.test.ts', '**/*.test.tsx', 'tests/**/*.ts', 'vitest.setup.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'warn',
      },
    },

    // -------- CommonJS config files ---------------------------------------
    {
      files: ['*.cjs'],
      env: { node: true },
      rules: {
        '@typescript-eslint/no-var-requires': 'off',
      },
    },
  ],
};
