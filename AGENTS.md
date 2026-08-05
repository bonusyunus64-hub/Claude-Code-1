<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Known, accepted `npm audit` finding: `xlsx`

`npm audit` reports two high-severity advisories against `xlsx@0.18.5` (prototype
pollution, ReDoS) with **no fix available on npm** — SheetJS stopped publishing
there, so the registry copy is frozen and permanently unpatched. This is a
deliberate accept, not an oversight. Please don't "fix" it by deleting the
dependency; `scripts/parse-roster.mjs` imports it and would break.

Why it's accepted:

- It is a **devDependency**, imported only by `scripts/parse-roster.mjs`.
- That script is run by hand to regenerate `data/roster.json`. It is not in
  `package.json`'s scripts, not in the build, and not in `.github/workflows/ci.yml`.
- Nothing in `app/` or `lib/` imports it, so it never reaches the Vercel runtime.
  `npm audit --omit=dev` reports zero vulnerabilities.
- Both advisories require parsing a hostile spreadsheet. The only input is the
  roster file the operator downloads themselves and runs locally.

If that ever stops being true — if a spreadsheet from an untrusted source gets
parsed, or the script moves into CI or the build — switch to the maintained
SheetJS build, which is distributed from their own CDN rather than npm:

```
npm i --save-dev https://cdn.sheetjs.com/xlsx-<version>/xlsx-<version>.tgz
```

That fixes both advisories but makes installs depend on a non-registry host, so
it is the right trade only once the exposure is real.
