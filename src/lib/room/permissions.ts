import type { ClientMessage } from "./protocol";
import type { Role } from "./types";

export type Action = Exclude<ClientMessage["type"], "join">;

const allowed: Record<Action, readonly Role[]> = {
  leave: ["host", "dj", "guest"],
  presence: ["host", "dj", "guest"],
  "room:lock": ["host"],
  "member:role": ["host"],
};

export function can(role: Role, action: Action): boolean {
  return allowed[action].includes(role);
}
