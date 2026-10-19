# Contributing

Thanks for helping! Bug reports, fixes and new tools are all welcome.

## Setup

```bash
git clone https://github.com/Rudrasamadhiya/expo-mcp-bridge
cd expo-mcp-bridge
npm install
npm test
```

The tests render the real `<AgentBridge />` in Node with a fake `react-native` (`test/fake-rn.cjs`), start the real MCP server over stdio, and drive it with an MCP client. You don't need a phone to run them.

## Layout

| Path | What |
|---|---|
| `client/` | Runs inside the app. Plain CommonJS, no build step, so Metro and Node can both load it. |
| `client/tree.js` | Walks the React fiber tree → compact snapshot, and resolves refs back to live elements |
| `client/capture.js` | Console, error and network capture |
| `server/` | Runs on the developer's computer: the MCP server (`mcp.mjs`), WebSocket hub (`hub.mjs`), adb helper, CLI |
| `skill/SKILL.md` | Agent instructions copied into projects by `init` |

## Trying a change in a real app

```bash
npm pack
cd ../your-expo-app
npm i --no-save ../expo-mcp-bridge/expo-mcp-bridge-<version>.tgz
npx expo start --clear     # --clear is needed after reinstalling, or Metro can't find the package
```

## Guidelines

- Keep tool output short. Every token we return is paid for by the agent.
- Add a test in `test/e2e.test.mjs` for any new behaviour.
- The client must never crash the host app. Wrap anything that touches React internals in try/catch.

## Releasing

1. Bump `version` in `package.json`. Client and server both read it from there.
2. Add an entry to `CHANGELOG.md`.
3. `npm test && npm publish`, then tag: `git tag v<version> && git push --tags`.
