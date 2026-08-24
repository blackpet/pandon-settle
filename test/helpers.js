import assert from "node:assert/strict";
import { settle } from "../public/src/settle.js";

/**
 * SPEC.md 11장 "불변식 테스트 (모든 케이스에 공통 적용)".
 * 계산 결과 하나가 나올 때마다 무조건 이 검사를 통과해야 한다.
 */
export function assertDeltas(deltas, expected) {
  assert.deepEqual(deltas, expected);
  assert.equal(deltas.length, expected.length, "deltas 길이는 인원과 같다");
  assertInvariants(deltas);
}

/** 기대값과 무관하게 계산 결과 자체가 지켜야 하는 것들. */
export function assertInvariants(deltas, n) {
  if (n !== undefined) assert.equal(deltas.length, n, "deltas 길이는 인원과 같다");
  assert.equal(deltas.reduce((a, b) => a + b, 0), 0, "deltas 합은 반드시 0이다");
  for (const v of deltas) {
    assert.ok(Number.isInteger(v), `금액은 정수(원 단위)여야 한다: ${v}`);
    assert.ok(!Object.is(v, -0), "0원은 -0 이 아니다");
  }
  assertSettleable(deltas);
  return deltas;
}

/** 잔액 배열이 어떤 값이든 정산 불변식을 지키는지 본다. */
export function assertSettleable(balances) {
  const out = settle(balances);
  const cap = Math.max(balances.length - 1, 0);
  assert.ok(out.length <= cap, `${balances.length}인 정산은 ${cap}건 이하여야 한다: ${out.length}건`);
  const sentTotal = out.reduce((a, t) => a + t.amount, 0);
  const plusTotal = balances.filter((v) => v > 0).reduce((a, b) => a + b, 0);
  assert.equal(sentTotal, plusTotal, "송금액 합계 = 플러스 잔액 합계");
  for (const t of out) {
    assert.ok(t.amount > 0, "0원 송금은 만들지 않는다");
    assert.ok(Number.isInteger(t.amount), "송금액도 정수다");
    assert.notEqual(t.from, t.to, "자기 자신에게 보내지 않는다");
  }
  return out;
}
