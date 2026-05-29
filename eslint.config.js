import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import reactPlugin from 'eslint-plugin-react'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    plugins: {
      react: reactPlugin,
    },
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
      'no-unused-vars': ['error', { varsIgnorePattern: '^_', argsIgnorePattern: '^_', ignoreRestSiblings: true }],
      // #312 — mark JSX-referenced imports as used so no-unused-vars doesn't flag them
      'react/jsx-uses-vars': 'error',
      // TODO: install and enable eslint-plugin-jsx-a11y for accessibility linting (#257)
    },
  },
  // Node.js globals override for serverless API files and Vite config (#312)
  {
    files: ['api/**/*.js', 'vite.config.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
])
