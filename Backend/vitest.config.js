const { defineConfig } = require('vitest/config');
module.exports = defineConfig({ test: { globals: true, environment: 'node', testTimeout: 60000, hookTimeout: 120000, sequence: { concurrent: false }, coverage: { reporter: ['text', 'html'] } } });
