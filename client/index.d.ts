import * as React from 'react';

export interface AgentBridgeProps {
  children?: React.ReactNode;
  /** Computer running the MCP server. Auto-detected from the Metro host. */
  host?: string;
  /** WebSocket port of the MCP server. Default 8347. */
  port?: number;
  /** Set false to turn the bridge off (it is always off in production builds). */
  enabled?: boolean;
  /** Allow the agent to run JS in the app via app_eval. Default true (dev only). */
  allowEval?: boolean;
  /** expo-router's `router` (or anything with push(path)) for app_navigate. Falls back to deep links. */
  router?: { push(path: string): void };
}

export declare class AgentBridge extends React.Component<AgentBridgeProps> {}
export default AgentBridge;
