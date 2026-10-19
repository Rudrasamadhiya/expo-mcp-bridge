// Optional hardware-level control for Android devices/emulators through adb.
// Only used for things an in-app library cannot do (volume, home, back, power).
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

export const KEYS = {
  volume_up: 24, volume_down: 25, mute: 164, back: 4, home: 3, app_switch: 187,
  enter: 66, tab: 61, delete: 67, power: 26, menu: 82, escape: 111,
};

function adbPath() {
  const exe = process.platform === 'win32' ? 'adb.exe' : 'adb';
  for (const root of [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk'),
    process.env.HOME && path.join(process.env.HOME, 'Library', 'Android', 'sdk')]) {
    if (root && existsSync(path.join(root, 'platform-tools', exe))) return path.join(root, 'platform-tools', exe);
  }
  return 'adb';
}

export function adb(args, { timeout = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(adbPath(), args, { timeout, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        const hint = err.code === 'ENOENT' ? 'adb not found. Install Android platform-tools and connect the phone with USB debugging (or `adb pair` over Wi-Fi).' : (stderr || err.message).trim();
        reject(new Error(hint));
      } else resolve(String(stdout).trim());
    });
  });
}

export async function pressKey(key, repeat = 1) {
  const code = KEYS[key];
  if (code == null) throw new Error(`unknown key "${key}". Known: ${Object.keys(KEYS).join(', ')}`);
  for (let i = 0; i < repeat; i++) await adb(['shell', 'input', 'keyevent', String(code)]);
}
