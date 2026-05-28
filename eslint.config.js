import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      // #259 — removed duplicate top-level ecmaVersion: 2020; only parserOptions.ecmaVersion: 'latest' is used
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      // #258 — only ignore underscore-prefixed vars, not all uppercase (was '^[A-Z_]')
      'no-unused-vars': ['error', { varsIgnorePattern: '^_' }],
      // TODO: install and enable eslint-plugin-jsx-a11y for accessibility linting (#257)
    },
  },
])
