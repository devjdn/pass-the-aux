import type { RoomCode } from "./code";
import { type ConnectionStatus } from "./connection";
import type { MemberId } from "./identity";

export type Role = "host" | "dj" | "guest";

export interface Member {
  id: MemberId;
  name: string;
  role: Role;
  connected: ConnectionStatus;
  /** server timestamp in ms since last status change */
  statusChangedAt: number;
  /** server timestamp in ms when the member first joined */
  joinedAt: number;
}

export interface RoomConfig {
  maxMembers: number;
  reconnectGraceMs: number;
  /** Should the host leave, close room or promote a user */
  hostLeavePolicy: "close" | "promote";
}

export interface Room {
  code: RoomCode;
  name: string;
  members: Record<MemberId, Member>;
  config: RoomConfig;
  closed: boolean;
  joinable: boolean;
  createdAt: number;
}

export type RoomErrorCode =
  | "room_closed"
  | "room_locked"
  | "room_full"
  | "invalid_name"
  | "not_found"
  | "forbidden"
  | "rejoin_required";

export type RoomResult =
  | { ok: true; room: Room }
  | { ok: false; code: RoomErrorCode; message: string };
