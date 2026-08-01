import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // An underscore prefix is this codebase's existing marker for a binding
      // that exists only so something else can be expressed: the discarded half
      // of a destructure (`const { smtpPass: _smtpPass, ...rest }` in
      // lib/accounts.ts, which is how PublicAccount drops the password), or a
      // mock signature that has to match the real one it stands in for. Neither
      // can be deleted to satisfy the rule — the binding is load-bearing
      // precisely because it goes unused. Teaching the rule the convention the
      // code already follows beats rewriting working code around a linter that
      // was never told about it.
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
      }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
