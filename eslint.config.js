import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'legacy/**', 'data/**', '**/coverage/**', 'web/test-results/**', 'web/playwright-report/**', 'current_xls/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', ignoreRestSiblings: true }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['warn', { prefer: 'type-imports', fixStyle: 'inline-type-imports' }],
      'no-console': 'off',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
  { files: ['**/test/**', '**/e2e/**'], rules: { '@typescript-eslint/no-explicit-any': 'off', '@typescript-eslint/consistent-type-imports': 'off' } },
  { files: ['web/e2e/**', 'web/**/*.config.*', 'server/**/*.config.*', 'eslint.config.js'], languageOptions: { globals: { ...globals.node } } },
);
