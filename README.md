<p align="center">
  <a href="https://rudrasamadhiya.github.io/expo-agent-kit/docs/bridge/">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Rudrasamadhiya/expo-mcp-bridge/main/.github/assets/banner-dark.svg">
      <img alt="expo-mcp-bridge — let your AI agent use your phone app the way it uses a browser" src="https://raw.githubusercontent.com/Rudrasamadhiya/expo-mcp-bridge/main/.github/assets/banner-light.svg" width="100%">
    </picture>
  </a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/expo-mcp-bridge"><img alt="npm version" src="https://img.shields.io/npm/v/expo-mcp-bridge?style=flat-square&labelColor=0b0b0b&color=ff2da8"></a>
  <a href="https://github.com/Rudrasamadhiya/expo-mcp-bridge/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/Rudrasamadhiya/expo-mcp-bridge/ci.yml?branch=main&style=flat-square&labelColor=0b0b0b&label=CI"></a>
  <a href="https://www.npmjs.com/package/expo-mcp-bridge"><img alt="node" src="https://img.shields.io/node/v/expo-mcp-bridge?style=flat-square&labelColor=0b0b0b&color=cbb3e8"></a>
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/npm/l/expo-mcp-bridge?style=flat-square&labelColor=0b0b0b&color=e34234"></a>
</p>

<p align="center">
  <a href="https://rudrasamadhiya.github.io/expo-agent-kit/"><b>Website</b></a> ·
  <a href="https://rudrasamadhiya.github.io/expo-agent-kit/docs/bridge/"><b>Docs</b></a> ·
  <a href="https://rudrasamadhiya.github.io/expo-agent-kit/docs/bridge/tools/"><b>Tools reference</b></a> ·
  <a href="https://rudrasamadhiya.github.io/expo-agent-kit/docs/ai-setup/"><b>One-shot AI setup</b></a> ·
  <a href="CHANGELOG.md"><b>Changelog</b></a>
</p>

---

**expo-mcp-bridge** gives AI agents — Claude Code, Antigravity, Cursor and any other [MCP](https://modelcontextprotocol.io) client — eyes and hands inside your Expo / React Native app, running live on **your real phone**. The agent reads the screen, taps, types, scrolls, takes screenshots, reads console errors and network requests, and presses hardware keys. No more pasting screenshots into the chat.

```tsx
import { Stack, router } from 'expo-router';
import { AgentBridge } from 'expo-mcp-bridge';

export default function RootLayout() {
  return (
    <>
      <Stack />
      <AgentBridge router={router} />
    </>
  );
}
```

> *"Open the app, try the sign-up form with bad input, and tell me what breaks."*

## Table of contents

- [Installation](#installation)
- [Quick start](#quick-start)
- [Features](#features)
- [What the agent sees](#what-the-agent-sees)
- [Connecting your agent](#connecting-your-agent)
- [Tools](#tools)
- [Component API](#component-api)
- [CLI and environment](#cli-and-environment)
- [How it works](#how-it-works)
- [Troubleshooting](#troubleshooting)
- [Limits](#limits)
- [Related](#related)
- [Contributing](#contributing)
- [License](#license)

## Installation

```bash
npx expo install expo-mcp-bridge react-native-view-shot
npx expo-mcp-bridge init
```

`react-native-view-shot` powers screenshots and ships with Expo Go; in a custom dev build, rebuild the client once after installing it. `init` writes your agent's MCP config, installs the agent skill and adds a guide to `AGENTS.md`.

**Requirements:** Node.js 20 or newer on your computer · an Expo (or React Native) app · phone and computer on the same Wi-Fi.

## Quick start

**The one-shot way.** Paste this into Claude Code, Antigravity or Cursor inside your Expo project and the agent installs, mounts and verifies everything itself:

```text
Read https://raw.githubusercontent.com/Rudrasamadhiya/expo-mcp-bridge/main/AI_SETUP.md and set it up in this project.
```

**By hand, in two minutes:**

1. Install the packages and run `init` (above).
2. Mount `<AgentBridge />` once, as the last child of your root layout (example at the top of this page).
3. Run `npx expo start` in LAN mode and open the app on your phone.
4. Restart your agent and ask it to do something in the app.

## Features

- **Real devices, zero native setup.** Expo Go or a dev build, iPhone or Android, over Wi-Fi. One component, no native linking.
- **Token-cheap by design.** The agent reads a compact outline of the *visible* screen — about 70 tokens instead of about 1,000 for a screenshot — and every action returns only what changed.
- **Fast flows.** Actions finish the moment the UI settles. `app_batch` fills a whole form in one call.
- **Sees what broke.** New JS errors and failed requests are attached to the action that caused them.
- **Full control.** Tap, type, scroll, toggle, navigate, wait, screenshots, layout, logs, network, eval — and volume / back / home keys.
- **Agent skill included.** `init` installs a skill for Claude Code and an `AGENTS.md` guide for Antigravity, Cursor, Codex and others, so agents use the tools well from the first message.
- **Dev only.** In production builds `<AgentBridge />` renders its children and nothing else.

## What the agent sees

A real login screen, as returned by `app_snapshot`:

```text
scroll [e1]
  button "icon:chevron-back" [e2]
  text "Welcome back"
  input "you@example.com" value="" [e3]
  input "••••••••" value="" (secure) [e4]
  button "icon:eye" [e5]
  button "Log In" [e7]
```

Tapping `e5` (show password) returns just the difference:

```text
Tapped.
Changes (+ added, - removed):
~ input "••••••••" value="" [e4]
+ button "icon:eye-off" [e9]
- button "icon:eye" [e5]
```

## Connecting your agent

`init` writes `.mcp.json` for Claude Code. Other agents use the same server:

| Agent | Configuration |
| --- | --- |
| Claude Code | `.mcp.json` from `init`, or `claude mcp add expo-app -- npx expo-mcp-bridge` |
| Cursor | `npx expo-mcp-bridge init --cursor` writes `.cursor/mcp.json` |
| Antigravity, Windsurf, Cline | MCP settings: `{"mcpServers": {"expo-app": {"command": "npx", "args": ["expo-mcp-bridge"]}}}` |

On Windows use `"command": "cmd", "args": ["/c", "npx", "expo-mcp-bridge"]`.

## Tools

Target elements by `ref` from a snapshot, by `testID`, or by visible `text`. Full parameters are in the [tools reference](https://rudrasamadhiya.github.io/expo-agent-kit/docs/bridge/tools/).

**Read**

| Tool | Description |
| --- | --- |
| `app_status` | Connected device, OS, screen size, SDK |
| `app_snapshot` | Outline of the visible screen with stable refs (`[e3]`) |
| `app_screenshot` | JPEG of the visible screen; `saveTo` a file; `fullScroll` for the whole page as one tall image |
| `app_layout` | Element positions (dp) and font sizes |

**Act**

| Tool | Description |
| --- | --- |
| `app_tap` | Press by ref, `testID` or text (`long: true` for a long press) |
| `app_type` | Fill an input (`submit`, `append`) |
| `app_batch` | Several taps, types, scrolls and navigations in one call |
| `app_scroll` | Scroll down, up, left, right, to the top or bottom |
| `app_toggle` | Flip or set a `Switch` |
| `app_navigate` | Open an expo-router path or deep link (`replace` keeps the stack shallow) |
| `app_wait` | Wait for text or a `testID` to appear or disappear |
| `app_dismiss_keyboard` | Hide the on-screen keyboard |

**Debug**

| Tool | Description |
| --- | --- |
| `app_logs` | Console logs and JS errors (cursor-based) |
| `app_network` | fetch / XHR requests with status, timing and bodies |
| `app_eval` | Run JavaScript inside the app (dev only) |
| `app_reload` | Reload the JS bundle, and say honestly if it couldn't |

**Device**

| Tool | Description |
| --- | --- |
| `device_key` | `volume_up`, `volume_down`, `mute`, `back`, `home`, `power` and more (Android, via adb) |

## Component API

```tsx
<AgentBridge
  router={router}      // expo-router's router, for exact app_navigate
  host="192.168.1.20"  // your computer's IP (auto-detected from Metro)
  port={8347}          // must match EXPO_MCP_PORT
  allowEval={false}    // disable app_eval
  enabled={false}      // turn the bridge off
/>
```

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `router` | expo-router `router` | — | Used by `app_navigate` for exact navigation |
| `host` | `string` | from Metro | Computer running the MCP server |
| `port` | `number` | `8347` | WebSocket port; must match `EXPO_MCP_PORT` |
| `allowEval` | `boolean` | `true` | Allow `app_eval` |
| `enabled` | `boolean` | `true` in dev | Turn the bridge on or off |

## CLI and environment

```bash
npx expo-mcp-bridge init            # .mcp.json + agent skill + AGENTS.md section
npx expo-mcp-bridge init --cursor   # also write .cursor/mcp.json
npx expo-mcp-bridge                 # run the MCP server (your agent starts this for you)
npx expo-mcp-bridge --help
```

| Variable | Default | Description |
| --- | --- | --- |
| `EXPO_MCP_PORT` | `8347` | WebSocket port the phone connects to (match `<AgentBridge port>`) |

You normally never run the server yourself — the agent launches it over stdio. To try it by hand, any MCP client works: `npx @modelcontextprotocol/inspector npx expo-mcp-bridge`.

## How it works

```text
AI agent  ──MCP (stdio)──▶  expo-mcp-bridge server  ◀──WebSocket :8347──  <AgentBridge /> in your app
```

The in-app component reads React's live component tree, so it sees exactly what you rendered: your `testID`s, labels, inputs and lists. It calls your real `onPress` and `onChangeText` handlers, so app logic runs exactly as if a user did it. Native-stack screens hidden under the current one are skipped, modals are captured as overlays, and screenshots capture the visible screen view.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `No app connected` | Same Wi-Fi, LAN mode (not `--tunnel`), firewall allows Node on 8347, `<AgentBridge />` mounted. USB-only Android: `adb reverse tcp:8347 tcp:8347` and `host="localhost"`. |
| `Port 8347 is already in use` | Another agent session runs the server — close it, or set `EXPO_MCP_PORT` and the `port` prop. |
| Metro: `Unable to resolve "expo-mcp-bridge"` | `npx expo start --clear` |
| `app_reload` can't reload | Metro was restarted; shake the phone and choose Reload once. |
| Screenshots fail | Install `react-native-view-shot` (rebuild the dev client if you use one). |

More in the [troubleshooting guide](https://rudrasamadhiya.github.io/expo-agent-kit/docs/bridge/troubleshooting/).

## Limits

An in-app library controls your own app only; the OS blocks system dialogs and other apps. `device_key` covers hardware keys via adb on Android. Gestures that exist only in native code (a pan handler with no `onPress`) can't be triggered from JavaScript.

## Related

- [**expo-launch-video**](https://github.com/Rudrasamadhiya/expo-launch-video) — builds on this bridge: your agent records the app live from the phone and cuts a launch video with motion graphics, pop-outs and sound, in a studio you can prompt.
- [**Expo Agent Kit**](https://rudrasamadhiya.github.io/expo-agent-kit/) — the website and full documentation for both libraries.

## Contributing

```bash
npm install
npm test
```

The tests run the bridge in Node against the real MCP server. See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## License

[MIT](LICENSE) © Rudra Samadhiya
