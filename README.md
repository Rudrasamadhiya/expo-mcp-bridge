# expo-mcp-bridge

[![npm](https://img.shields.io/npm/v/expo-mcp-bridge)](https://www.npmjs.com/package/expo-mcp-bridge)
[![CI](https://github.com/Rudrasamadhiya/expo-mcp-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/Rudrasamadhiya/expo-mcp-bridge/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/expo-mcp-bridge)](LICENSE)

**Let your AI agent use your phone app the way it uses a browser.**

Claude Code, Antigravity, Cursor and any other [MCP](https://modelcontextprotocol.io) agent can **read the screen, tap, type and fill forms, scroll, take screenshots, read console errors and network requests, and press volume / back / home** in your Expo / React Native app, running live in **Expo Go on your real phone**. No more pasting screenshots into the chat.

- 📱 **Real devices, zero native setup** — Expo Go or a dev build, iPhone or Android, over Wi-Fi.
- 🪶 **Token-cheap** — the agent reads a compact outline of the *visible* screen; every action returns only what changed.
- ⚡ **Fast** — actions finish as soon as the UI settles; `app_batch` runs a whole flow in one call.
- 🔎 **Sees what's broken** — new JS errors and failed requests are attached to the action that caused them.
- 🤖 **Skill included** — `init` installs an agent skill (Claude Code) and an `AGENTS.md` guide (Antigravity, Cursor, Codex…).
- 🔒 **Dev only** — in production builds `<AgentBridge />` renders its children and nothing else.

```text
scroll [e1]
  button "icon:chevron-back" [e2]
  text "Welcome back"
  input "you@example.com" value="" [e3]
  input "••••••••" value="" (secure) [e4]
  button "icon:eye" [e5]
  button "Log In" [e7]
```
*What the agent sees of a real login screen: ~70 tokens instead of ~1,000 for a screenshot.* Tapping `e5` returns just:
```text
Tapped.
Changes (+ added, - removed):
~ input "••••••••" value="" [e4]
+ button "icon:eye-off" [e9]
- button "icon:eye" [e5]
```

---

## 🚀 Quick start

### Option A — let your AI do it (one shot)
Paste this to Claude Code, Antigravity or Cursor inside your Expo project:

> Read https://raw.githubusercontent.com/Rudrasamadhiya/expo-mcp-bridge/main/AI_SETUP.md and set it up in this project.

### Option B — by hand (2 minutes)
```bash
npx expo install expo-mcp-bridge react-native-view-shot
npx expo-mcp-bridge init
```
Mount the bridge once in your root layout (`app/_layout.tsx`):
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
Run `npx expo start` (LAN mode), open the app on your phone (same Wi-Fi), restart your agent and ask:

> *"Open the app, try the sign-up form with bad input, and tell me what breaks."*

### Agent configuration
`init` writes `.mcp.json` (Claude Code). Other agents:

| Agent | Config |
|---|---|
| Claude Code | `.mcp.json` from `init`, or `claude mcp add expo-app -- npx expo-mcp-bridge` |
| Cursor | `npx expo-mcp-bridge init --cursor` → `.cursor/mcp.json` |
| Antigravity / Windsurf / Cline | MCP settings: `{"mcpServers": {"expo-app": {"command": "npx", "args": ["expo-mcp-bridge"]}}}` |

On **Windows**: `"command": "cmd", "args": ["/c", "npx", "expo-mcp-bridge"]`.

---

## 🧰 Tools

| Tool | What it does |
|---|---|
| `app_status` | Connected device, OS, screen size |
| `app_snapshot` | Outline of the visible screen with stable refs (`[e3]`) |
| `app_tap` | Press by ref, `testID` or visible text (`long: true` for long-press) |
| `app_type` | Fill an input (`submit`, `append`) |
| `app_batch` | Several taps/types/scrolls/navigations in one call |
| `app_scroll` | down / up / top / bottom |
| `app_toggle` | Flip a `Switch` |
| `app_navigate` | expo-router path or deep link (`replace` to keep the stack shallow) |
| `app_wait` | Wait for text / testID to appear or disappear |
| `app_dismiss_keyboard` | Hide the keyboard |
| `app_screenshot` | JPEG of the visible screen; `saveTo` file; `fullScroll` = whole page as one tall image |
| `app_layout` | Element positions (dp) and font sizes |
| `app_logs` | Console logs and JS errors (cursor-based) |
| `app_network` | fetch/XHR requests with status, timing and bodies |
| `app_eval` | Run JS inside the app (dev only) |
| `app_reload` | Reload the JS bundle (tells you honestly if it can't) |
| `device_key` | `volume_up`, `volume_down`, `mute`, `back`, `home`, `power`… (Android via adb) |

## ⚙️ Props
```tsx
<AgentBridge
  router={router}      // expo-router's router, for exact app_navigate
  host="192.168.1.20"  // computer IP (auto-detected from Metro)
  port={8347}          // must match EXPO_MCP_PORT
  allowEval={false}    // disable app_eval
  enabled={false}      // turn the bridge off
/>
```

## 🔧 How it works
```text
 AI agent ──MCP (stdio)──▶ expo-mcp-bridge server ◀──WebSocket :8347── <AgentBridge /> in your app
```
The in-app component reads React's live component tree, so it sees exactly what you rendered: your `testID`s, labels, inputs and lists. It calls your real `onPress` / `onChangeText` handlers, so app logic runs exactly as if a user did it. Native-stack screens hidden under the current one are skipped, modals are captured as overlays, and screenshots capture the visible screen view (whole-window capture can return stale frames on Android).

## 🩺 Troubleshooting
| Symptom | Fix |
|---|---|
| `No app connected` | Same Wi-Fi, LAN mode (not `--tunnel`), firewall allows Node on 8347, `<AgentBridge />` mounted. USB-only Android: `adb reverse tcp:8347 tcp:8347` + `host="localhost"`. |
| `Port 8347 is already in use` | Another agent session runs the server — close it or set `EXPO_MCP_PORT` + `port` prop. |
| Metro: `Unable to resolve "expo-mcp-bridge"` after reinstalling | `npx expo start --clear` |
| `app_reload` can't reload | Metro was restarted; shake the phone → Reload once. |
| Screenshots fail | Install `react-native-view-shot` (rebuild the dev client if you use one). |

## 🎬 Make launch videos too
[**expo-launch-video**](https://github.com/Rudrasamadhiya/expo-launch-video) builds on this bridge: your agent records the app live from the phone and edits a launch video with motion graphics, pop-outs and sound, in a browser studio you can prompt.

## Limits
An in-app library controls your own app only; the OS blocks system dialogs and other apps. `device_key` covers hardware keys via adb on Android. Gestures that exist only in native code (a pan handler with no `onPress`) can't be triggered from JS.

## Contributing
`npm install && npm test` — the bridge runs in Node against the real MCP server. See [CONTRIBUTING.md](CONTRIBUTING.md). MIT licensed.
