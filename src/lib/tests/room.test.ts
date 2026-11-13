import { describe, expect, test } from "vite-plus/test";
import type { RoomCode } from "#lib/room/code.ts";
import { ConnectionStatus } from "#lib/room/connection.ts";
import type { MemberId } from "#lib/room/identity.ts";
import { createRoom, joinRoom } from "#lib/room/room.ts";
import type { Room, RoomConfig, RoomResult } from "#lib/room/types.ts";

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
    const result = createRoom({
      code,
      hostId: id("h"),
      name: "a".repeat(24),
      hostName: "b".repeat(24),
      now: T0,
    });
  });
});
