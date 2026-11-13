export const ConnectionStatus = {
  /* Socket open and tab is active */
  Connected: "connected",
  /* Socket open but tab is inactive */
  Away: "away",
  /* Socket dropped, grace period still active, could still reconnect */
  Reconnecting: "reconnecting",
  /* Fully gone, grace period expired / left deliberately */
  Disconnected: "disconnected",
} as const;

export type ConnectionStatus = (typeof ConnectionStatus)[keyof typeof ConnectionStatus];

export function isActive(status: ConnectionStatus) {
  return status === ConnectionStatus.Connected || status === ConnectionStatus.Away;
}
