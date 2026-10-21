# Changelog

## 0.3.1

- Docs and package page: new README with banner, grouped tool tables and component API table; homepage now points to the documentation site.
- No code changes.

## 0.3.0

- In-app screen recorder (`record` command): timed frames, smooth scrolling, a tap mid-recording, page loads recorded live; React Native `<Modal>`s captured as transparent overlays. Used by expo-launch-video.
- Captures go up to the device's real pixel density.
- The agent skill is now `expo-app-control` and covers every tool, including hardware keys; `init` also writes the same guide into `AGENTS.md` for Antigravity, Cursor and others.
- `AI_SETUP.md`: a one-shot setup guide an AI agent can follow.
- New `app_layout` tool: element positions (dp) and font sizes on the visible screen.
- `app_screenshot` accepts `fullScroll: true` to capture a scroll view's whole content as one tall image.
- `registerAppTools(server, hub)` is exported from `expo-mcp-bridge/server/mcp.mjs`, so other MCP servers (like `expo-launch-video`) can offer the same tools on one connection.

## 0.2.0

Faster, and far fewer tokens per step.

- Snapshots only include the visible screen. Screens kept mounted under a native stack are skipped.
- Refs are stable: `[e7]` keeps pointing at the same element across snapshots.
- Actions return a diff (`+` added, `-` removed, `~` changed) instead of the whole screen. Pass `full: true` for the whole screen.
- Adaptive settle: actions return as soon as the UI stops changing, instead of after a fixed delay.
- New `app_batch` tool: run a whole flow (type, type, tap…) in one call.
- `app_screenshot` accepts `saveTo` to write a file instead of returning image data.
- Screenshots capture the visible screen's own view. Whole-window capture returned stale frames on Android native stacks. Pass `area: "window"` for the old behaviour.
- `app_navigate` accepts `replace: true` to keep the stack shallow.
- `app_status` and other calls wait long enough for the app to reconnect; the app retries every 2s at most.
- `app_reload` waits for the app to come back with the new code and says so honestly when it cannot reload (for example after Metro was restarted).
- The snapshot format drops the `- ` line prefix.

## 0.1.0

First release.

- `<AgentBridge />` in-app component: connects to the MCP server over WebSocket in development, renders only its children in production.
- MCP tools: `app_status`, `app_snapshot`, `app_screenshot`, `app_tap`, `app_type`, `app_scroll`, `app_toggle`, `app_navigate`, `app_wait`, `app_logs`, `app_network`, `app_eval`, `app_reload`, `app_dismiss_keyboard`, `device_key`.
- Compact text snapshots with refs. Action tools return the updated screen, new errors and failed requests.
- Icon-only buttons are labelled by icon name (`icon:chevron-back`), and icon-font glyphs are hidden.
- `npx expo-mcp-bridge init` writes `.mcp.json` and an agent skill.
- Tested on a real Android 16 device with Expo SDK 54.
