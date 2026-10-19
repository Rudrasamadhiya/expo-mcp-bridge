---
name: expo-ai-setup
description: One-shot setup of expo-mcp-bridge (AI control of a running Expo app on a real phone) and, optionally, expo-launch-video (AI-made launch videos) in an Expo / React Native project. Use when asked to "set up expo-mcp-bridge", "give the AI access to my app", or "set up launch videos".
---

# One-shot setup: AI access to an Expo app (+ launch videos)

You are an AI coding agent. Follow these steps in order inside the user's Expo project. Do every step yourself except where it says **ask the user**. Report what you did at the end.

## 0. Check the project
- `package.json` must list `expo`. If not, stop: this is for Expo / React Native apps.
- Node.js ≥ 20 (`node -v`).
- Decide the scope: **app control** (always) and **launch videos** (only if the user wants videos).

## 1. Install
```bash
npx expo install expo-mcp-bridge react-native-view-shot
```
For launch videos, also:
```bash
npm install --save-dev expo-launch-video
```
`react-native-view-shot` ships with Expo Go. In a custom dev build it is a native module: tell the user to rebuild the dev client once (`eas build --profile development` or `npx expo run:android`).

## 2. Mount the bridge in the app
Find the root component: `app/_layout.tsx` (expo-router; also `src/app/_layout.tsx`) or `App.tsx` / `App.js`.

1. Add the import:
   ```tsx
   import { AgentBridge } from 'expo-mcp-bridge';
   ```
   With expo-router, also import `router` from `'expo-router'` (add it to the existing import).
2. Render it once, as the **last child** of what the root component returns:
   ```tsx
   <AgentBridge router={router} />   {/* expo-router */}
   <AgentBridge />                    {/* plain React Navigation / no router */}
   ```
   If the root returns a single element (e.g. a provider tree), put `<AgentBridge />` inside the innermost provider's children, or wrap the return in a fragment `<>…</>`.
3. It only runs in development (`__DEV__`); in production it renders nothing extra. Don't wrap it in other conditions.

## 3. Configure the AI agent
Run one of these in the project root:
```bash
npx expo-mcp-bridge init        # app control only  → MCP server "expo-app"
npx expo-launch-video init      # app control + launch videos → MCP server "launch-video" (replaces "expo-app")
```
`init` writes `.mcp.json` (Claude Code), a skill in `.claude/skills/`, and the same guide in `AGENTS.md` (Antigravity, Cursor, Codex and others read it). Use `--cursor` to also write `.cursor/mcp.json`.

For agents configured by hand (Antigravity, Windsurf, Cline…), add an MCP server:
```json
{ "mcpServers": { "expo-app": { "command": "npx", "args": ["expo-mcp-bridge"] } } }
```
(or `"launch-video": { "command": "npx", "args": ["expo-launch-video"] }`). **On Windows** use `"command": "cmd", "args": ["/c", "npx", "expo-mcp-bridge"]`.

Only one of the two servers should run at a time: both listen on port 8347 for the phone.

## 4. Start and connect
1. `npx expo start` in **LAN** mode (not `--tunnel`). **Ask the user** to open the app on their phone (Expo Go or dev build) on the **same Wi-Fi** as the computer.
2. On Windows, allow Node.js through the firewall when prompted (port 8347).
3. Restart the agent so it loads the MCP server (Claude Code asks to approve the project server; approve it).
4. Verify: call `app_status` → "Connected: … (Expo Go)". Then `app_snapshot` should list the current screen.

USB-only Android: `adb reverse tcp:8347 tcp:8347` and use `<AgentBridge host="localhost" />`.

## 5. Troubleshooting
| Symptom | Fix |
|---|---|
| `No app connected` | Same Wi-Fi? LAN mode? Firewall allows Node on 8347? Is `<AgentBridge />` mounted? The app retries every 2 s. |
| `Port 8347 is already in use` | Another agent session runs the server; close it, or set `EXPO_MCP_PORT` and `<AgentBridge port={…} />`. |
| Metro: `Unable to resolve "expo-mcp-bridge"` after (re)installing | Restart Metro with `npx expo start --clear`. |
| `app_reload` says it can't reload | Metro was restarted; ask the user to shake the phone → Reload once. |
| Screens show empty lists | The app may need env vars in dev (e.g. `EXPO_PUBLIC_*` that only exist in `eas.json`); check `app_network` / the code, and start Metro with them set. |
| Screenshots fail | `react-native-view-shot` missing (or the dev build wasn't rebuilt after installing it). |

## 6. Rules while driving the app
- Never type real passwords, payment or ID details. Use test accounts; let the user type real credentials on the phone.
- Native system dialogs and permission prompts must be handled by the user.
- Ask before actions that change real data (submitting, purchasing, deleting, logging out).

## 7. Done — tell the user
- What you installed and where `<AgentBridge />` was added.
- How to start (`npx expo start`, open on the phone).
- What they can ask now, e.g. *"test the login flow"*, *"what's wrong on the profile screen?"*, and — with videos — *"make a 30 second launch video of the app"*.
