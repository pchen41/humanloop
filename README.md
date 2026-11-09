# Humanloop

A Mac app for running many Claude Code sessions in parallel. Each task has its
own zsh tabs, and tasks sit in queues (Your turn, Agent's turn, Parked, Done)
sorted by priority, then by how long they have waited.

## Develop

```sh
npm install
npm run dev        # app with hot reload; uses ~/Library/Application Support/Humanloop Dev
npm test           # unit tests
npm run typecheck
```

## Package

```sh
npm run package    # dist/mac-arm64/Humanloop.app (ad-hoc signed)
npm run smoke      # package, then launch it headlessly and check a shell works
```

Data lives in `~/Library/Application Support/Humanloop`: `state.json` (tasks and
tabs, written by the app) and `settings.json` (what the Settings screen, ⌘,,
saves; you can also edit it by hand, and changes apply as soon as you save).
