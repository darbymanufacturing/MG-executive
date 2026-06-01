import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import reactPlugin from 'eslint-plugin-react'
import a11y from 'eslint-plugin-jsx-a11y'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx,mjs}'],
    plugins: {
      react: reactPlugin,
      'jsx-a11y': a11y,
    },
    extends: [
      js.configs.recommended,
      reactPlugin.configs.flat.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      a11y.flatConfigs.recommended,
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
      // #312 — react/jsx-uses-vars and all other React rules now covered by reactPlugin.configs.flat.recommended above
      // #257 — jsx-a11y rules enabled via a11y.flatConfigs.recommended above
    },
  },
  // Node.js globals override for serverless API files and Vite config (#312)
  {
    files: ['api/**/*.js', 'vite.config.js', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: globals.node,
    },
  },
])
