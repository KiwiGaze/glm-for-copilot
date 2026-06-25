import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
	{
		ignores: ['dist/**', 'node_modules/**', 'out/**'],
	},
	{
		files: ['eslint.config.mjs'],
		...js.configs.recommended,
		languageOptions: {
			globals: globals.node,
		},
	},
	...tseslint.configs.recommended,
	{
		files: ['src/**/*.ts', 'vitest.config.ts'],
		rules: {
			'@typescript-eslint/no-unused-vars': [
				'error',
				{
					argsIgnorePattern: '^_',
					caughtErrorsIgnorePattern: '^_',
					varsIgnorePattern: '^_',
				},
			],
			'no-undef': 'off',
		},
	},
);
