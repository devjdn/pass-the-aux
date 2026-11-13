import type { Brand } from "./identity";

export const ROOM_CODE_LENGTH = 6;

/** No ambiguous chars included, e.g. 0/O or 1/I/L */
export const ROOM_CODE_CHARS = "23456789ABCDEFGHIJKLMNPQRSTUVWXYZ";

/** Matches the normalised code */
export const ROOM_CODE_PATTERN = /^[2-9AHJKMNP-Z]{6}$/;

export type RoomCode = Brand<string, "RoomCode">;
