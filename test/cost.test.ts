import assert from "node:assert/strict";
import test from "node:test";
import { parseCost } from "../src/cost.js";

test("parseCost returns null when no marker exists", () => {
  assert.equal(parseCost(""), null);
  assert.equal(parseCost("nothing to see\nplain output"), null);
});

test("parseCost reads a plain number", () => {
  const cost = parseCost("ARENA_COST: 0.42\n");
  assert.equal(cost?.usd, 0.42);
});

test("parseCost reads an object with usd and token count", () => {
  const cost = parseCost('ARENA_COST: {"usd":0.5,"tokens":1200}');
  assert.equal(cost?.usd, 0.5);
  assert.equal(cost?.tokens, 1200);
});

test("parseCost keeps numeric token detail and drops the rest", () => {
  const cost = parseCost('ARENA_COST: {"tokens":{"in":10,"out":20,"note":"x"}}');
  assert.deepEqual(cost?.tokens, { in: 10, out: 20 });
  assert.equal(cost?.usd, undefined);
});

test("parseCost uses the last marker line", () => {
  const cost = parseCost('ARENA_COST: 0.1\nmore output\nARENA_COST: 0.9\n');
  assert.equal(cost?.usd, 0.9);
});

test("parseCost tolerates leading whitespace", () => {
  const cost = parseCost("   ARENA_COST: 0.1");
  assert.equal(cost?.usd, 0.1);
});

test("parseCost returns null for malformed payloads", () => {
  assert.equal(parseCost("ARENA_COST: {oops"), null);
  assert.equal(parseCost("ARENA_COST: abc"), null);
});

test("parseCost returns null when no usable fields exist", () => {
  assert.equal(parseCost('ARENA_COST: {"usd":"many"}'), null);
  assert.equal(parseCost("ARENA_COST: null"), null);
  assert.equal(parseCost("ARENA_COST: [1,2]"), null);
});