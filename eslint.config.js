import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const domainForbidden = [
  'fastify',
  '@fastify/*',
  'react',
  'react-dom',
  'pg',
  'pg-boss',
  'pino',
  'zod',
  '@ulysse/database',
  '@ulysse/connectors',
  '@ulysse/ai',
  '@ulysse/observability',
  '@ulysse/contracts',
];

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '.data/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      // Port implementations are async by contract even when a given adapter has nothing to await.
      '@typescript-eslint/require-await': 'off',
      eqeqeq: ['error', 'always'],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['**/test/**/*.ts', '**/src/testing/**/*.ts', '**/src/testing.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-confusing-void-expression': 'off',
      '@typescript-eslint/no-floating-promises': [
        'error',
        {
          allowForKnownSafeCalls: [
            { from: 'package', name: ['describe', 'test', 'it', 'suite'], package: 'node:test' },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/domain/src/**/*.ts'],
    ignores: ['packages/domain/src/testing/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: domainForbidden,
              message: 'The domain stays framework-, storage- and provider-free (BLUEPRINT §2).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    rules: { 'no-console': 'off' },
  },
);
