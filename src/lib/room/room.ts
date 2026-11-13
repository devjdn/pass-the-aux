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
  return name.length > 0 && name.length < MAX_NAME_LENGTH ? name : null;
}

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
