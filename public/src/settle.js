/**
 * settle.js — 최소 송금 정산 (순수 함수)
 *
 * 이 파일은 DOM 도 localStorage 도 rules.js 도 모른다. 잔액 배열만 본다.
 * 그래서 게임이 3종에서 5종으로 늘어도, 인원이 2명에서 5명이 되어도
 * 이 파일은 한 글자도 바뀌지 않는다.
 */

/**
 * 라운드 목록을 접어서 잔액을 만든다. 잔액은 어디에도 저장하지 않는다.
 * n 에 기본값을 두지 않는다 — 빠뜨렸을 때 조용히 3인으로 도는 것보다 그 자리에서 터지는 게 낫다.
 */
export function balances(rounds, n) {
  if (!Number.isInteger(n) || n < 2) throw new Error(`인원을 넘겨야 한다: ${n}`);
  const b = new Array(n).fill(0);
  for (const r of rounds) r.deltas.forEach((v, i) => (b[i] += v));
  return b;
}

/**
 * 잔액 배열 → 송금 목록.
 * 한 번 돌 때마다 최소 한 사람이 소진되므로 송금은 `인원 - 1` 건을 넘지 않는다.
 * 3인 이하에서는 그게 곧 최소 건수이기도 하다. 4인 이상에서 최소를 찾으려면 조합을
 * 뒤져야 하는데, 그 최적화는 하지 않는다 — 큰 사람부터 큰 사람에게가 설명하기 쉽다.
 */
export function settle(bal) {
  const plus = bal.map((v, i) => ({ i, v })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
  const minus = bal.map((v, i) => ({ i, v })).filter((x) => x.v < 0).sort((a, b) => a.v - b.v);
  const out = [];
  let p = 0, m = 0;
  while (p < plus.length && m < minus.length) {
    const amount = Math.min(plus[p].v, -minus[m].v);
    out.push({ from: minus[m].i, to: plus[p].i, amount });
    plus[p].v -= amount;
    minus[m].v += amount;
    if (plus[p].v === 0) p++;
    if (minus[m].v === 0) m++;
  }
  return out;   // length <= 인원 - 1
}
