// Flat config (ESLint 9+). Replaces the legacy .eslintrc.json.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'examples/**', 'tests/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: { ecmaVersion: 2020, sourceType: 'module' },
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // New in ESLint 10's recommended set; the providers intentionally rethrow
      // normalized errors. Not part of this package's original rule intent.
      'preserve-caught-error': 'off',
    },
  },
);
