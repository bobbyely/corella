import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sameDay, shortAge } from "../when.ts";

// Noon local time, so adding or taking hours stays on the same day.
const noon = new Date(2026, 10, 20, 12, 0, 0).getTime();

describe("a chat's age in the sidebar", () => {
  it("says now, minutes, then hours within the day", () => {
    assert.equal(shortAge(noon - 20_000, noon), "now");
    assert.equal(shortAge(noon - 9 * 60_000, noon), "9 min");
    assert.equal(shortAge(noon - 3 * 3_600_000, noon), "3 h");
  });

  it("names the weekday within the week, and the date after that", () => {
    const tuesday = new Date(2026, 10, 17, 9, 0).getTime();
    assert.equal(shortAge(tuesday, noon), new Date(tuesday).toLocaleDateString(undefined, { weekday: "short" }));
    const older = new Date(2026, 10, 2, 9, 0).getTime();
    assert.equal(shortAge(older, noon), new Date(older).toLocaleDateString(undefined, { month: "short", day: "numeric" }));
  });

  it("splits Today from Earlier at local midnight", () => {
    assert.equal(sameDay(new Date(2026, 10, 20, 0, 5).getTime(), noon), true);
    assert.equal(sameDay(new Date(2026, 10, 19, 23, 55).getTime(), noon), false);
  });
});
