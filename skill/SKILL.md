---
name: expo-app-control
description: See and drive the running Expo / React Native app on a real phone or emulator through the expo-app MCP tools - read the screen, take screenshots, tap, type and fill forms, scroll, toggle, navigate, wait, read console logs and network requests, run JS, reload, and press hardware keys (volume, back, home). Use to test the app, reproduce or debug a bug, verify a UI change, or check a screen.
---

# Controlling the running app

The `expo-app` MCP server talks to the app through `<AgentBridge />` (mounted in the app's root layout). Works in Expo Go and dev builds, on real phones over Wi-Fi.

## The loop
1. `app_status` — confirm the phone is connected. If not, show the user the help text it returns.
2. `app_snapshot` — the visible screen as a compact outline. Elements you can act on have refs like `[e4]` (refs stay stable between snapshots).
3. Act, targeting by `ref`, `testID`, or visible `text`:
   - `app_tap` (`long: true` for long-press) · `app_type` (`submit: true` presses enter, `append: true` keeps text) · `app_scroll` (down/up/top/bottom) · `app_toggle` (switches) · `app_navigate` (expo-router path or deep link, `replace: true` to keep the stack shallow) · `app_dismiss_keyboard`
   - Each action returns **only what changed** (`+` added, `-` removed, `~` changed) plus new JS errors and failed requests. Don't re-snapshot after an action.
4. Several steps (a form): one `app_batch` call, e.g. `[{action:"type", text:"Email", value:"…"}, {action:"type", text:"Password", value:"…"}, {action:"tap", text:"Log In"}]`.
5. Async content: `app_wait {text | testID, gone?}` instead of polling snapshots.

## Seeing more
- `app_screenshot` — only for visual questions (layout, colors, overlap). `saveTo` writes a file instead of returning the image; `fullScroll: true` captures a whole scrolling page as one tall image.
- `app_layout` — element positions (dp) and font sizes, for alignment/overflow checks.

## Debugging
- `app_logs {level:"error"}` and `app_network {failedOnly:true, bodies:true}`; use the `since` cursor to fetch only new entries.
- `app_eval` runs JS inside the app (dev only) to inspect state or storage.
- `app_reload` after code edits Fast Refresh didn't pick up. If it says the app can't reload (Metro was restarted), ask the user to shake the phone → Reload.

## Hardware keys (Android, via adb)
`device_key {key}`: `volume_up`, `volume_down`, `mute`, `back`, `home`, `app_switch`, `enter`, `tab`, `delete`, `power`, `menu`, `escape` (`repeat` for multiple presses). Needs adb with USB or Wi-Fi debugging.

## Rules
- Never type a real password or payment details. Use test accounts; ask the user to enter real credentials themselves.
- Native system dialogs (alerts, permission prompts) can't be pressed from JS — ask the user, or call the screen's own handler.
- Don't submit forms that change real data (orders, payments, submissions, deletions) without the user's go-ahead.
- If a modal stays open after a step, close it before moving on.

## Reporting
Name the screen, the steps you took, expected vs actual, and quote the relevant error lines or failed requests.
