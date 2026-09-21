'use strict';

module.exports = [{
  files: ['src/**/*.js', 'tests/**/*.js'],
  ignores: ['node_modules/**', '.data/**'],
  languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: { process: 'readonly', Buffer: 'readonly', __dirname: 'readonly', require: 'readonly', module: 'readonly' } },
  rules: {
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  },
}];
