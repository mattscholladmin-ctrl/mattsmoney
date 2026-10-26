
### Product verification

`npm test` runs the current app's budget, planning, review, shopping, isolated SQL,
auth/data, sign-out, and preview tests. `npm run typecheck` checks TypeScript and
checked JavaScript. `npm run build` produces the Vercel app.

The six original Grok distribution assembly test files are retained under
`npm run test:legacy-template`. They assume the original `.grok` distribution,
its branding skill sources, and a fresh auth-off template. Those inputs and
assumptions do not describe this existing Supabase-authenticated budget app;
they are not release gates for it. This separate command is expected to fail
without that original distribution. The runtime source and startup script remain.
