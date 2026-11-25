import { describe, expect, test } from "vite-plus/test";
import type { RoomCode } from "#lib/room/code.ts";
import { ConnectionStatus } from "#lib/room/connection.ts";
import type { MemberId } from "#lib/room/identity.ts";
import { createRoom, expireStale, joinRoom, leaveRoom, setConnection } from "#lib/room/room.ts";
import type { Member, Room, RoomConfig, RoomResult } from "#lib/room/types.ts";

const T0 = 1000;
const code = "K7P3QX" as RoomCode;
const id = (s: string) => s as MemberId;

function unwrap(result: RoomResult): Room {
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result.room;
}

function fresh(config: Partial<RoomConfig> = {}): Room {
  return unwrap(
    createRoom({
      code,
      name: "Jayden's Room",
      hostId: id("h"),
      hostName: "Jayden",
      now: T0,
      config,
    }),
  );
}

function setStatus(room: Room, memberId: string, connected: ConnectionStatus): Room {
  const member = room.members[id(memberId)];

  if (!member) throw new Error(`No member found matching ${memberId}`);

  return {
    ...room,
    members: {
      ...room.members,
      [id(memberId)]: {
        ...member,
        connected,
      },
    },
  };
}

function fullRoom(): Room {
  return unwrap(joinRoom(fresh({ maxMembers: 2 }), id("g1"), "Guest One", T0 + 1));
}

function setRole(room: Room, memberId: string, role: Member["role"]): Room {
  const member = room.members[id(memberId)];
  if (!member) throw new Error(`No member found matching ${memberId}`);
  return {
    ...room,
    members: { ...room.members, [id(memberId)]: { ...member, role } },
  };
}

// Joins each id as a guest, one ms apart, so joinedAt follows argument order
function joinAll(room: Room, ...ids: string[]): Room {
  return ids.reduce((r, g, i) => unwrap(joinRoom(r, id(g), g, T0 + 1 + i)), room);
}

describe("createRoom", () => {
  test("Makes the creator the connected host", () => {
    expect(fresh().members[id("h")]).toMatchObject({
      role: "host",
      connected: ConnectionStatus.Connected,
      joinedAt: T0,
    });
  });

  test("Start open, defaults overridden by a new config", () => {
    const room = fresh({ maxMembers: 5 });
    expect(room).toMatchObject({ joinable: true, closed: false });
    expect(room.config.maxMembers).toBe(5);
    expect(room.config.hostLeavePolicy).toBe("close");
  });

  test("Trims room name and host name", () => {
    const room = unwrap(
      createRoom({
        code,
        name: " Friday ",
        hostId: id("h"),
        hostName: " Jayden ",
        now: T0,
      }),
    );
    expect(room.name).toBe("Friday");
    expect(room.members[id("h")]?.name).toBe("Jayden");
  });

  test.each([
    ["Room name", { name: " ", hostName: "Jayden" }],
    ["Host name", { name: "Friday", hostName: " " }],
    ["Room name over 24 characters", { name: "a".repeat(25), hostName: "Jayden" }],
    ["Host name over 24 characters", { name: "Friday", hostName: "a".repeat(25) }],
  ])("Rejects an invalid %s", (_label, names) => {
    const result = createRoom({ code, hostId: id("h"), now: T0, ...names });
    expect(result).toMatchObject({ ok: false, code: "invalid_name" });
  });

  test("Accepts names of exactly 24 characters", () => {
    unwrap(
      createRoom({
        code,
        hostId: id("h"),
        name: "a".repeat(24),
        hostName: "b".repeat(24),
        now: T0,
      }),
    );
  });
});

describe("joinRoom", () => {
  test("Correctly adds a guest", () => {
    const room = unwrap(joinRoom(fresh(), id("g"), "Guest", T0 + 1));
    expect(room.members[id("g")]).toMatchObject({
      id: "g",
      name: "Guest",
      role: "guest",
      connected: ConnectionStatus.Connected,
      statusChangedAt: T0 + 1,
      joinedAt: T0 + 1,
    });
  });

  test("Trims the guest name", () => {
    const room = unwrap(joinRoom(fresh(), id("g"), " Guest ", T0 + 1));
    expect(room.members[id("g")]?.name).toBe("Guest");
  });

  test("Guest cannot join a locked room", () => {
    const locked = { ...fresh(), joinable: false };
    expect(joinRoom(locked, id("g"), "Guest", T0 + 1)).toMatchObject({
      ok: false,
      code: "room_locked",
    });
  });

  test("Guest cannot join a closed room", () => {
    const closed = { ...fresh(), closed: true };
    expect(joinRoom(closed, id("g"), "Guest", T0 + 1)).toMatchObject({
      ok: false,
      code: "room_closed",
    });
  });

  test.each([
    ["blank", " "],
    ["over 24 characters", "a".repeat(25)],
  ])("Rejects a %s guest name", (_label, name) => {
    expect(joinRoom(fresh(), id("g"), name, T0 + 1)).toMatchObject({
      ok: false,
      code: "invalid_name",
    });
  });

  test("Accepts a guest name of exactly 24 characters", () => {
    const room = unwrap(joinRoom(fresh(), id("g"), "a".repeat(24), T0 + 1));
    expect(room.members[id("g")]?.name).toBe("a".repeat(24));
  });

  test("Accepts the guest that fills the room exactly", () => {
    expect(Object.keys(fullRoom().members)).toHaveLength(2);
  });

  test("Rejects a new guest when the room is full", () => {
    expect(joinRoom(fullRoom(), id("g2"), "Two", T0 + 2)).toMatchObject({
      ok: false,
      code: "room_full",
    });
  });

  test("A Disconnected member frees their seat", () => {
    const room = setStatus(fullRoom(), "g1", ConnectionStatus.Disconnected);
    expect(joinRoom(room, id("g2"), "Two", T0 + 2)).toMatchObject({ ok: true });
  });

  test("A Reconnecting member keeps their seat", () => {
    const room = setStatus(fullRoom(), "g1", ConnectionStatus.Reconnecting);
    expect(joinRoom(room, id("g2"), "Two", T0 + 2)).toMatchObject({
      ok: false,
      code: "room_full",
    });
  });

  test("Closed beats locked, locked beats full, full beats a bad name", () => {
    const full = fullRoom();
    const locked = { ...full, joinable: false };
    const closed = { ...locked, closed: true };
    expect(joinRoom(closed, id("g2"), " ", T0 + 2)).toMatchObject({
      code: "room_closed",
    });
    expect(joinRoom(locked, id("g2"), " ", T0 + 2)).toMatchObject({
      code: "room_locked",
    });
    expect(joinRoom(full, id("g2"), " ", T0 + 2)).toMatchObject({
      code: "room_full",
    });
  });

  test("Doesn't mutate the room it was given", () => {
    const before = fullRoom();
    const snapshot = structuredClone(before);
    joinRoom(before, id("g2"), "Two", T0 + 2);
    expect(before).toEqual(snapshot);
  });
});

describe("joinRoom, returning members", () => {
  test("Reconnects a returning member, keeping their name, role and joinedAt", () => {
    const gone = setStatus(
      unwrap(joinRoom(fresh(), id("g"), "Guest", T0 + 1)),
      "g",
      ConnectionStatus.Disconnected,
    );
    const room = unwrap(joinRoom(gone, id("g"), "Different", T0 + 50));
    expect(room.members[id("g")]).toMatchObject({
      name: "Guest",
      role: "guest",
      joinedAt: T0 + 1,
      connected: ConnectionStatus.Connected,
      statusChangedAt: T0 + 50,
    });
  });

  test("A returning member can rejoin a locked room", () => {
    const gone = setStatus(fullRoom(), "g1", ConnectionStatus.Disconnected);
    const locked = { ...gone, joinable: false };
    expect(joinRoom(locked, id("g1"), "One", T0 + 5)).toMatchObject({
      ok: true,
    });
  });

  test("A returning member cannot rejoin a closed room", () => {
    const closed = { ...fullRoom(), closed: true };
    expect(joinRoom(closed, id("g1"), "One", T0 + 5)).toMatchObject({
      ok: false,
      code: "room_closed",
    });
  });

  test("A Disconnected member cannot return if their seat was taken", () => {
    let room = setStatus(fullRoom(), "g1", ConnectionStatus.Disconnected);
    room = unwrap(joinRoom(room, id("g2"), "Two", T0 + 2)); // takes the seat
    expect(joinRoom(room, id("g1"), "One", T0 + 3)).toMatchObject({
      ok: false,
      code: "room_full",
    });
  });

  test("A Reconnecting member can return to a full room", () => {
    const room = setStatus(fullRoom(), "g1", ConnectionStatus.Reconnecting);
    expect(joinRoom(room, id("g1"), "One", T0 + 5)).toMatchObject({ ok: true });
  });

  test("Rejoining while already Connected is a no-op", () => {
    const room = fullRoom();
    expect(unwrap(joinRoom(room, id("g1"), "Guest One", T0 + 5))).toBe(room);
  });
});

describe("setConnection", () => {
  test("Moves a member to Reconnecting and stamps the time", () => {
    const room = unwrap(
      setConnection(fullRoom(), id("g1"), ConnectionStatus.Reconnecting, T0 + 10),
    );
    expect(room.members[id("g1")]).toMatchObject({
      connected: ConnectionStatus.Reconnecting,
      statusChangedAt: T0 + 10,
    });
  });

  test("Setting the current status returns the same room", () => {
    const room = fullRoom();
    const result = setConnection(room, id("g1"), ConnectionStatus.Connected, T0 + 10);
    expect(unwrap(result)).toBe(room);
  });

  test("Rejects an unknown member", () => {
    expect(
      setConnection(fresh(), id("nobody"), ConnectionStatus.Reconnecting, T0 + 1),
    ).toMatchObject({ ok: false, code: "not_found" });
  });

  test("A Disconnected member must rejoin, not be set back", () => {
    const room = setStatus(fullRoom(), "g1", ConnectionStatus.Disconnected);
    expect(setConnection(room, id("g1"), ConnectionStatus.Connected, T0 + 10)).toMatchObject({
      ok: false,
      code: "rejoin_required",
    });
  });

  test("Rejects changes to a closed room", () => {
    const closed = { ...fullRoom(), closed: true };
    expect(setConnection(closed, id("g1"), ConnectionStatus.Reconnecting, T0 + 10)).toMatchObject({
      ok: false,
      code: "room_closed",
    });
  });

  test("The host disconnecting closes the room under the close policy", () => {
    const room = unwrap(setConnection(fresh(), id("h"), ConnectionStatus.Disconnected, T0 + 10));
    expect(room.closed).toBe(true);
  });

  test("A guest disconnecting leaves the room open", () => {
    const room = unwrap(
      setConnection(fullRoom(), id("g1"), ConnectionStatus.Disconnected, T0 + 10),
    );
    expect(room.closed).toBe(false);
  });

  test("The host going Reconnecting does not close the room", () => {
    const room = unwrap(setConnection(fresh(), id("h"), ConnectionStatus.Reconnecting, T0 + 10));
    expect(room.closed).toBe(false);
  });
});

describe("leaveRoom", () => {
  test("Marks the member Disconnected but keeps their entry", () => {
    const room = unwrap(leaveRoom(fullRoom(), id("g1"), T0 + 10));
    expect(room.members[id("g1")]?.connected).toBe(ConnectionStatus.Disconnected);
  });
});

describe("expireStale", () => {
  const GRACE = 1000;
  const reconnecting = () =>
    setStatus(
      fresh({ reconnectGraceMs: GRACE, maxMembers: 2 }),
      "h",
      ConnectionStatus.Reconnecting,
    ); // setStatus leaves statusChangedAt at T0

  test("Doesn't expire a member one ms before the grace period ends", () => {
    const room = reconnecting();
    expect(expireStale(room, T0 + GRACE - 1)).toBe(room);
  });

  test("Expires a member exactly at the grace period", () => {
    const room = expireStale(reconnecting(), T0 + GRACE);
    expect(room.members[id("h")]?.connected).toBe(ConnectionStatus.Disconnected);
  });

  test("Leaves Connected members alone", () => {
    const room = fresh();
    expect(expireStale(room, T0 + 999_999)).toBe(room);
  });

  test("An expired host closes the room", () => {
    expect(expireStale(reconnecting(), T0 + GRACE).closed).toBe(true);
  });

  test("An expired guest frees their seat", () => {
    const base = unwrap(
      joinRoom(fresh({ reconnectGraceMs: GRACE, maxMembers: 2 }), id("g1"), "One", T0 + 1),
    );
    const dropped = unwrap(setConnection(base, id("g1"), ConnectionStatus.Reconnecting, T0 + 2));
    expect(joinRoom(dropped, id("g2"), "Two", T0 + 3)).toMatchObject({
      code: "room_full",
    });
    const expired = expireStale(dropped, T0 + 2 + GRACE);
    expect(joinRoom(expired, id("g2"), "Two", T0 + 3 + GRACE)).toMatchObject({
      ok: true,
    });
  });
});

describe("host leave policy: promote", () => {
  const promoting = () => joinAll(fresh({ hostLeavePolicy: "promote" }), "g1", "g2");
  const hostLeaves = (room: Room) =>
    unwrap(setConnection(room, id("h"), ConnectionStatus.Disconnected, T0 + 10));

  test("Promotes the longest-connected guest and demotes the old host", () => {
    const room = hostLeaves(promoting());
    expect(room.closed).toBe(false);
    expect(room.members[id("g1")]?.role).toBe("host");
    expect(room.members[id("g2")]?.role).toBe("guest");
    expect(room.members[id("h")]).toMatchObject({
      role: "guest",
      connected: ConnectionStatus.Disconnected,
    });
  });

  test("Prefers a DJ over an earlier-joined guest", () => {
    const room = hostLeaves(setRole(promoting(), "g2", "dj"));
    expect(room.members[id("g2")]?.role).toBe("host");
  });

  test("Skips Reconnecting members", () => {
    const room = hostLeaves(setStatus(promoting(), "g1", ConnectionStatus.Reconnecting));
    expect(room.members[id("g2")]?.role).toBe("host");
  });

  test("Closes the room when nobody is eligible", () => {
    expect(hostLeaves(fresh({ hostLeavePolicy: "promote" })).closed).toBe(true);
    const onlyReconnecting = setStatus(
      joinAll(fresh({ hostLeavePolicy: "promote" }), "g1"),
      "g1",
      ConnectionStatus.Reconnecting,
    );
    expect(hostLeaves(onlyReconnecting).closed).toBe(true);
  });

  test("The host going Reconnecting promotes nobody yet", () => {
    const room = unwrap(
      setConnection(promoting(), id("h"), ConnectionStatus.Reconnecting, T0 + 10),
    );
    expect(room.members[id("h")]?.role).toBe("host");
  });

  test("Promotes when the host's grace period expires", () => {
    const room = setStatus(
      joinAll(fresh({ hostLeavePolicy: "promote", reconnectGraceMs: 1000 }), "g1"),
      "h",
      ConnectionStatus.Reconnecting,
    );
    expect(expireStale(room, T0 + 1000).members[id("g1")]?.role).toBe("host");
  });

  test("The old host rejoins as a guest, leaving exactly one host", () => {
    const room = unwrap(joinRoom(hostLeaves(promoting()), id("h"), "Jayden", T0 + 20));
    expect(room.members[id("h")]?.role).toBe("guest");
    const hosts = Object.values(room.members).filter((m) => m.role === "host");
    expect(hosts).toHaveLength(1);
  });
});
