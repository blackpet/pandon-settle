import { test } from "node:test";
import assert from "node:assert/strict";
import { balances, settle } from "../public/src/settle.js";
import { assertSettleable } from "./helpers.js";

// 플레이어 순서는 SPEC 예시와 같다: 0=재호, 1=철수, 2=영희
test("balances - 라운드가 없으면 전원 0원", () => {
  assert.deepEqual(balances([], 3), [0, 0, 0]);
});

test("balances - 라운드의 deltas 를 접어서 잔액을 만든다", () => {
  const rounds = [
    { deltas: [2700, -1800, -900] },
    { deltas: [-2000, 4000, -2000] },
  ];
  assert.deepEqual(balances(rounds, 3), [700, 2200, -2900]);
});

test("balances - 인원 수를 지정할 수 있다", () => {
  assert.deepEqual(balances([], 4), [0, 0, 0, 0]);
});

test("settle - 한 명만 마이너스면 두 건으로 나눠 보낸다", () => {
  const out = assertSettleable([400, 1150, -1550]);
  assert.deepEqual(out, [
    { from: 2, to: 1, amount: 1150 },
    { from: 2, to: 0, amount: 400 },
  ]);
});

test("settle - 본전이 한 명 있으면 한 건으로 끝난다", () => {
  const out = assertSettleable([3000, -3000, 0]);
  assert.deepEqual(out, [{ from: 1, to: 0, amount: 3000 }]);
});

test("settle - 두 명이 플러스면 꼴찌가 각각에게 보낸다", () => {
  const out = assertSettleable([2500, 1500, -4000]);
  assert.deepEqual(out, [
    { from: 2, to: 0, amount: 2500 },
    { from: 2, to: 1, amount: 1500 },
  ]);
});

test("settle - 전원 본전이면 송금이 없다", () => {
  assert.deepEqual(settle([0, 0, 0]), []);
});

// ── 인원이 3명이 아닐 때 ────────────────────────────────────────────
test("balances - 인원은 반드시 넘겨야 한다", () => {
  assert.throws(() => balances([]), /인원/);
});

test("settle - 2인은 언제나 한 건으로 끝난다", () => {
  const out = assertSettleable([3000, -3000]);
  assert.deepEqual(out, [{ from: 1, to: 0, amount: 3000 }]);
});

test("settle - 2인 전원 본전이면 송금이 없다", () => {
  assert.deepEqual(settle([0, 0]), []);
});

test("settle - 5인은 인원-1건을 넘지 않는다", () => {
  const out = assertSettleable([5000, 2000, -1000, -2000, -4000]);
  assert.deepEqual(out, [
    { from: 4, to: 0, amount: 4000 },
    { from: 3, to: 0, amount: 1000 },
    { from: 3, to: 1, amount: 1000 },
    { from: 2, to: 1, amount: 1000 },
  ]);
});

test("settle - 4인에서 딱 맞물리면 두 건으로 끝난다", () => {
  const out = assertSettleable([6000, 4000, -4000, -6000]);
  assert.deepEqual(out, [
    { from: 3, to: 0, amount: 6000 },
    { from: 2, to: 1, amount: 4000 },
  ]);
});

test("balances - 5인 라운드를 접는다", () => {
  const rounds = [
    { deltas: [1500, -500, -500, -500, 0] },
    { deltas: [-400, 1600, -400, -400, -400] },
  ];
  assert.deepEqual(balances(rounds, 5), [1100, 1100, -900, -900, -400]);
});
