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
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    // Server-side code: Vercel serverless functions and the Node test suite run
    // in Node, not the browser. Without this they report `process` and `Buffer`
    // as undefined — noise that was masking real findings in the same files.
    files: ['api/**/*.js', 'tests/**/*.{js,mjs}', '*.config.js', 'middleware.js'],
    languageOptions: { globals: { ...globals.node } },
  },
])
