import { test } from "node:test";
import assert from "node:assert/strict";
import { isVoteOpen, tallyVotes, VOTE_CUTOFF_MS } from "../../src/domain/vote.ts";

const start = new Date("2026-12-01T18:00:00Z");

test("cutoff is five minutes", () => {
  assert.equal(VOTE_CUTOFF_MS, 300000);
});

test("isVoteOpen: open at start minus 5:01", () => {
  assert.equal(isVoteOpen(start, new Date(start.getTime() - 301000)), true);
});

test("isVoteOpen: closed at exactly start minus 5:00", () => {
  assert.equal(isVoteOpen(start, new Date(start.getTime() - 300000)), false);
});

test("isVoteOpen: closed after the cutoff and after the start", () => {
  assert.equal(isVoteOpen(start, new Date(start.getTime() - 1000)), false);
  assert.equal(isVoteOpen(start, new Date(start.getTime() + 1000)), false);
});

test("tallyVotes: 3 split 2 regear is split", () => {
  assert.deepEqual(tallyVotes(["split", "split", "split", "regear", "regear"]), {
    split: 3,
    regear: 2,
    result: "split",
  });
});

test("tallyVotes: 2-2 is a tie", () => {
  assert.equal(tallyVotes(["split", "split", "regear", "regear"]).result, "tie");
});

test("tallyVotes: regear wins and none", () => {
  assert.equal(tallyVotes(["regear"]).result, "regear");
  assert.deepEqual(tallyVotes([]), { split: 0, regear: 0, result: "none" });
});
