import type { ConnectionStatus } from "./connection";
import type { MemberCredentials, MemberId, MemberToken } from "./identity";
import type { Role, Room, RoomErrorCode } from "./types";

/** Contains only the statuses that a client can say */
export type ClientPresence = Extract<ConnectionStatus, "connected" | "away">;

/** Client-to-server */
export type ClientMessage =
  /** Anyone. A stored token resumes an existing member; otherwise a new guest is created. */
  | { type: "join"; name: string; token?: MemberToken }
  /** Any member. Skips the reconnect grace period and leaves straight away. */
  | { type: "leave" }
  /** Any member. Reports whether the tab is visible. */
  | { type: "presence"; status: ClientPresence }
  /** Host only. Sets whether new members can join. */
  | { type: "room:lock"; joinable: boolean }
  /** Host only. Changes another member's role; the host role can't be assigned this way. */
  | { type: "member:role"; memberId: MemberId; role: Exclude<Role, "host"> };

/** Errors caused by a malformed or out-of-sequence message, not by room rules. */
export type ProtocolErrorCode = "invalid_message" | "not_joined";
export type ErrorCode = RoomErrorCode | ProtocolErrorCode;

/** Server-to-client */
export type ServerMessage =
  /** Only to the member who just joined, since it carries their private credentials. */
  | { type: "joined"; credentials: MemberCredentials; room: Room }
  /** To everyone in the room after any change, so all clients stay in sync. */
  | { type: "state"; room: Room }
  /** Only to the connection whose message caused it. */
  | { type: "error"; code: ErrorCode; message: string };

// TODO: queue/vote/playback-related protocols and stuff related to kicking/banning
