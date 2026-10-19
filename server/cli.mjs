#!/usr/bin/env node
// `npx expo-mcp-bridge`        -> run the MCP server (agents launch this)
// `npx expo-mcp-bridge init`   -> wire the current Expo project up for AI agents
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cmd = process.argv[2];

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function writeMcpConfig(file, key = 'mcpServers') {
  const cfg = readJson(file) || {};
  cfg[key] = cfg[key] || {};
  cfg[key]['expo-app'] = process.platform === 'win32'
    ? { command: 'cmd', args: ['/c', 'npx', 'expo-mcp-bridge'] }
    : { command: 'npx', args: ['expo-mcp-bridge'] };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
}

function init() {
  const root = process.cwd();
  const pkg = readJson(path.join(root, 'package.json'));
  if (!pkg) {
    console.error('Run this inside your Expo project (no package.json found).');
    process.exit(1);
  }
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const done = [];

  writeMcpConfig(path.join(root, '.mcp.json'));
  done.push('.mcp.json                     (Claude Code)');
  if (fs.existsSync(path.join(root, '.cursor')) || process.argv.includes('--cursor')) {
    writeMcpConfig(path.join(root, '.cursor', 'mcp.json'));
    done.push('.cursor/mcp.json              (Cursor)');
  }

  const skillSrc = path.join(here, '..', 'skill', 'SKILL.md');
  const skillDst = path.join(root, '.claude', 'skills', 'expo-app-control', 'SKILL.md');
  fs.mkdirSync(path.dirname(skillDst), { recursive: true });
  fs.copyFileSync(skillSrc, skillDst);
  done.push('.claude/skills/expo-app-control/SKILL.md (how the agent drives the app)');

  // the same guide for other agents (Antigravity, Cursor, Codex…) via AGENTS.md
  const agents = path.join(root, 'AGENTS.md');
  const guide = fs.readFileSync(skillSrc, 'utf8').replace(/^---[\s\S]*?---\n/, '');
  const section = `<!-- expo-app-control:start -->\n${guide.trim()}\n<!-- expo-app-control:end -->\n`;
  const existing = fs.existsSync(agents) ? fs.readFileSync(agents, 'utf8') : '';
  fs.writeFileSync(agents, existing.includes('<!-- expo-app-control:start -->')
    ? existing.replace(/<!-- expo-app-control:start -->[\s\S]*?<!-- expo-app-control:end -->\n?/, section)
    : (existing ? existing.trimEnd() + '\n\n' : '') + section);
  done.push('AGENTS.md (expo-app-control section)  same guide for Antigravity, Cursor and others');

  const layout = ['app/_layout.tsx', 'app/_layout.jsx', 'app/_layout.js', 'src/app/_layout.tsx', 'App.tsx', 'App.js'].find((f) => fs.existsSync(path.join(root, f)));

  console.log('\n✔ expo-mcp-bridge set up:\n  ' + done.join('\n  '));
  if (!deps['react-native-view-shot']) {
    console.log('\n• For screenshots, install:  npx expo install react-native-view-shot');
  }
  console.log(`\n• Add the bridge to ${layout || 'your root component'}:\n
    import { AgentBridge } from 'expo-mcp-bridge';

    export default function RootLayout() {
      return (
        <>
          <Stack />
          <AgentBridge />
        </>
      );
    }
`);
  console.log('• Antigravity / other agents: add an MCP server with command `npx expo-mcp-bridge`.');
  console.log('• Then run `npx expo start`, open the app in Expo Go, restart your agent and ask it to test the app.\n');
}

if (cmd === 'init') init();
else if (cmd === '--help' || cmd === '-h' || cmd === 'help') {
  console.log('expo-mcp-bridge            run the MCP server (used by AI agents)\nexpo-mcp-bridge init       configure this Expo project (.mcp.json + agent skill)');
} else {
  const { startServer } = await import('./mcp.mjs');
  await startServer();
}
