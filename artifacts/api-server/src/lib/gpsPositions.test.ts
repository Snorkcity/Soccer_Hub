import assert from "node:assert/strict";
import { test } from "node:test";
import { GPS_POSITION_ROLES, isGpsRoleForPosition } from "@workspace/api-zod";

test("each specific role belongs to its agreed broad position", () => {
  for (const [position, roles] of Object.entries(GPS_POSITION_ROLES)) {
    for (const role of roles) assert.equal(isGpsRoleForPosition(position, role.value), true);
  }
  assert.equal(GPS_POSITION_ROLES.GK.length, 0);
});

test("mismatched, unknown and unset positions cannot carry a specific role", () => {
  for (const [position, role] of [
    ["Defender", "DM"], ["Midfielder", "CB"], ["Forward", "FB"],
    ["GK", "9"], ["Defender", "6"], ["", "CB"], [null, "CB"],
  ] as const) assert.equal(isGpsRoleForPosition(position, role), false);
});