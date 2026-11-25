import type { RoomCode } from "./code";
import { ConnectionStatus } from "./connection";
import type { MemberId } from "./identity";
import type { Member, Room, RoomConfig, RoomErrorCode, RoomResult } from "./types";

export const DEFAULT_ROOM_CONFIG: RoomConfig = {
  maxMembers: 20,
  reconnectGraceMs: 30000,
  hostLeavePolicy: "close",
};

const MAX_NAME_LENGTH = 24;

const ok = (room: Room): RoomResult => ({ ok: true, room });

const fail = (code: RoomErrorCode, message: string): RoomResult => ({
  ok: false,
  code,
  message,
});

function cleanName(rawName: string) {
  const name = rawName.trim();
  return name.length > 0 && name.length <= MAX_NAME_LENGTH ? name : null;
}

/**
 * Returns a copy of `room` with `member` stored under `member.id`,
 * replacing the existing entry or adding a new one. Doesn't mutate `room`.
 */
function withMember(room: Room, member: Member) {
  const newMembers = { ...room.members, [member.id]: member };
  return { ...room, members: newMembers };
}

function currentMemberCount(room: Room) {
  return Object.values(room.members).filter((m) => m.connected !== ConnectionStatus.Disconnected)
    .length;
}

export interface CreateRoomInput {
  code: RoomCode;
  name: string;
  hostId: MemberId;
  hostName: string;
  now: number;
  config?: Partial<RoomConfig>;
}

export function createRoom(input: CreateRoomInput): RoomResult {
  const roomName = cleanName(input.name);
  const hostName = cleanName(input.hostName);

  if (!roomName || !hostName) {
    return fail("invalid_name", `Names must be 1-${MAX_NAME_LENGTH} characters`);
  }

  return ok({
    code: input.code,
    name: roomName,
    members: {
      [input.hostId]: {
        id: input.hostId,
        name: hostName,
        role: "host",
        connected: ConnectionStatus.Connected,
        statusChangedAt: input.now,
        joinedAt: input.now,
      },
    },
    joinable: true,
    config: { ...DEFAULT_ROOM_CONFIG, ...input.config },
    closed: false,
    createdAt: input.now,
  });
}

export function joinRoom(room: Room, memberId: MemberId, rawName: string, now: number): RoomResult {
  if (room.closed) return fail("room_closed", "This room has closed");

  const existing: Member | undefined = room.members[memberId];

  if (existing) {
    if (existing.connected === ConnectionStatus.Connected) return ok(room);

    const wasGone = existing.connected === ConnectionStatus.Disconnected;
    if (wasGone && currentMemberCount(room) >= room.config.maxMembers) {
      return fail("room_full", "The room is currently full.");
    }

    return ok(
      withMember(room, {
        ...existing,
        connected: ConnectionStatus.Connected,
        statusChangedAt: now,
      }),
    );
  }

  if (!room.joinable) {
    return fail("room_locked", "This room isn't accepting new members.");
  }

  if (currentMemberCount(room) >= room.config.maxMembers) {
    return fail("room_full", "This room is full.");
  }

  const name = cleanName(rawName);
  if (!name) {
    return fail("invalid_name", `Names must be 1-${MAX_NAME_LENGTH} characters.`);
  }

  return ok(
    withMember(room, {
      id: memberId,
      name,
      role: "guest",
      connected: ConnectionStatus.Connected,
      statusChangedAt: now,
      joinedAt: now,
    }),
  );
}

function pickHostSuccessor(room: Room): Member | undefined {
  const rank = (m: Member) => (m.role === "dj" ? 0 : 1);
  return Object.values(room.members)
    .filter((m) => m.role !== "host" && m.connected === ConnectionStatus.Connected)
    .sort((a, b) => rank(a) - rank(b) || a.joinedAt - b.joinedAt || a.id.localeCompare(b.id))[0];
}

function applyHostGone(room: Room, hostId: MemberId) {
  switch (room.config.hostLeavePolicy) {
    case "close":
      return { ...room, closed: true };
    case "promote":
      const successor = pickHostSuccessor(room);
      if (!successor) return { ...room, closed: true };
      let next = withMember(room, { ...successor, role: "host" });
      const oldHost = room.members[hostId];
      if (oldHost) next = withMember(next, { ...oldHost, role: "guest" });
      return next;
    default:
      return room;
  }
}

/**
 * Returns a copy of `room` with `member`'s connection status and
 * `statusChangedAt` updated. If the member is the host and the new status is
 * Disconnected, the host-leave policy is applied to the result (close the
 * room, or promote a successor). Doesn't mutate `room`.
 *
 * Doesn't validate the transition; callers such as `setConnection` do that.
 */
function markStatus(room: Room, member: Member, status: ConnectionStatus, now: number): Room {
  const updated = withMember(room, {
    ...member,
    connected: status,
    statusChangedAt: now,
  });

  const hostGone = member.role === "host" && status === ConnectionStatus.Disconnected;

  return hostGone ? applyHostGone(updated, member.id) : updated;
}

/**
 * Sets an existing member's connection status. Fails with `room_closed`,
 * `not_found` (member isn't in the room) or `rejoin_required` (member is
 * Disconnected and must use `joinRoom`, which checks capacity). Setting the
 * status a member already has is a no-op that returns the same room reference.
 * The host becoming Disconnected triggers the host-leave policy.
 */
export function setConnection(
  room: Room,
  memberId: MemberId,
  status: ConnectionStatus,
  now: number,
): RoomResult {
  if (room.closed) return fail("room_closed", "This room has closed");

  const member: Member | undefined = room.members[memberId];
  if (!member) return fail("not_found", "No such member in this room.");

  // same status check, if its the same it just returns the same room reference
  // keeps the statusChangedAt so repeated events can't reset a grace window
  if (member.connected === status) return ok(room);

  // Leaving Disconnected has to go through joinRoom (includes capacity check)
  if (member.connected === ConnectionStatus.Disconnected) {
    return fail("rejoin_required", "Disconnected members must rejoin");
  }

  return ok(markStatus(room, member, status, now));
}

export function leaveRoom(room: Room, memberId: MemberId, now: number): RoomResult {
  return setConnection(room, memberId, ConnectionStatus.Disconnected, now);
}

/**
 * Marks every Reconnecting member whose grace period has run out as
 * Disconnected, which frees their seat. Returns the same room reference if
 * nothing expired, so callers can skip persisting and broadcasting.
 * A closed room is returned unchanged.
 */
export function expireStale(room: Room, now: number): Room {
  if (room.closed) return room;

  let next = room;

  for (const memberId of Object.keys(room.members) as MemberId[]) {
    const member = next.members[memberId];
    if (!member) continue;

    const stale =
      member.connected === ConnectionStatus.Reconnecting &&
      now - member.statusChangedAt >= room.config.reconnectGraceMs;

    if (stale) next = markStatus(next, member, ConnectionStatus.Disconnected, now);
  }

  return next;
}
