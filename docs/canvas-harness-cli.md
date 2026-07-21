# Canvas harness CLI

The CLI is a thin adapter over the same `CanvasSessionService` used by the Codex App Server
dynamic-tool transport. Commands emit JSON so fixtures and debugging scripts do not need a
second mutation implementation.

```sh
npm run harness -- --help
npm run harness -- script run --file src/lib/agent/harness/fixtures/accepted-source-unchanged.json
```

Single commands accept JSON directly or from standard input:

```sh
npm run harness -- session create --json - < session.json
npm run harness -- scene overview --session SESSION_ID --json '{}'
npm run harness -- candidate validate --session SESSION_ID
```

Because the current store is intentionally in-memory, use `script run` for a multi-command flow
in one process. Within a script, omit `sessionId` or set it to `$session` to address the most
recently created session. The script result includes `sourceUnchanged`; the fixture checks this is
`true` after candidate mutation, validation, and submission. Candidate changes are copy-on-write
and never alter the accepted input document.
