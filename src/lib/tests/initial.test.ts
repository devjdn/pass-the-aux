import { describe, expect, vi, test } from "vite-plus/test";

function sum(a: number, b: number) {
  return a + b;
}

describe("throwaway tests", () => {
  test("3 and 4 = 7", () => {
    expect(sum(3, 4)).toBe(7);
  });

  test("8 and 4 = 12", () => {
    expect(sum(8, 4)).toBe(12);
  });
});
