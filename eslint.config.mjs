import javascriptConfig from '@playcanvas/eslint-config/javascript';
import globals from 'globals';

export default [
    ...javascriptConfig,
    {
        files: ['**/*.js', '**/*.mjs'],
        languageOptions: {
            ecmaVersion: 2024,
            sourceType: 'module'
        },
        rules: {
            'import/order': 'off'
        }
    },
    {
        // the harness runs in Node
        files: ['harness/*.mjs', 'eslint.config.mjs'],
        languageOptions: {
            globals: globals.node
        },
        rules: {
            // engines and bundles are built and checked one at a time on purpose: they share one
            // browser and one output folder, and their log lines have to stay in order
            'no-await-in-loop': 'off',
            'require-atomic-updates': 'off'
        }
    },
    {
        // scenarios and the report's pages run in a browser
        files: ['scenarios/**/*.js', 'harness/site/*.js'],
        languageOptions: {
            globals: globals.browser
        }
    },
    {
        // scenarios import the library under test, which the harness resolves at build time
        files: ['scenarios/**/*.js'],
        rules: {
            'import/no-unresolved': 'off'
        }
    },
    {
        // the report's scripts are plain scripts that share globals: chart.js, the page's data,
        // and each other's helpers
        files: ['harness/site/*.js'],
        languageOptions: {
            sourceType: 'script',
            globals: {
                Chart: 'readonly',
                DATA: 'readonly',
                SUMMARY: 'readonly',
                ROOT: 'readonly'
            }
        },
        rules: {
            'no-unused-vars': 'off',
            'no-undef': 'off',
            'no-implicit-globals': 'off',
            'strict': 'off'
        }
    },
    {
        // these pass functions to the browser, where window and document exist
        files: ['harness/verify.mjs', 'harness/environment.mjs'],
        languageOptions: {
            globals: { ...globals.node, window: 'readonly', document: 'readonly', navigator: 'readonly' }
        }
    },
    {
        ignores: ['dist/', '.cache/', 'node_modules/']
    }
];
