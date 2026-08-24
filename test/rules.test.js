import { test } from "node:test";
import assert from "node:assert/strict";
import { compute, DEFAULT_RULES, DEFAULT_POINT_VALUE } from "../public/src/rules.js";
import { assertDeltas, assertInvariants } from "./helpers.js";

// 0=재호(승자로 자주 등장), 1=철수, 2=영희
const R = DEFAULT_RULES;
const PV = { ...DEFAULT_POINT_VALUE, gostop: 100, poker: 100, hoola: 100 };

const gostop = (o) => ({ game: "gostop", winner: 0, score: 0, go: 0, shake: 0, gobak: null, losers: { 1: {}, 2: {} }, ...o });

// ── 고스톱: SPEC 11장 "검증 완료된 기대값" ───────────────────────────
test("고스톱 - 7점 2고, 철수 피박", () => {
  const d = compute(gostop({ score: 7, go: 2, losers: { 1: { pibak: true }, 2: {} } }), R, PV, 3);
  assertDeltas(d, [2700, -1800, -900]);
});

test("고스톱 - 7점 3고, 배수 없음 (3고부터 2배)", () => {
  const d = compute(gostop({ score: 7, go: 3 }), R, PV, 3);
  assertDeltas(d, [4000, -2000, -2000]);
});

test("고스톱 - 5점, 철수 피박+광박", () => {
  const d = compute(gostop({ score: 5, losers: { 1: { pibak: true, gwangbak: true }, 2: {} } }), R, PV, 3);
  assertDeltas(d, [2500, -2000, -500]);
});

test("고스톱 - 4점 흔들기 1회, 영희 광박", () => {
  const d = compute(gostop({ score: 4, shake: 1, losers: { 1: {}, 2: { gwangbak: true } } }), R, PV, 3);
  assertDeltas(d, [2400, -800, -1600]);
});

// ── 고스톱: 룰 설정이 계산에 반영되는가 ──────────────────────────────
test("고스톱 - 4고는 ×4 (2^(go-2))", () => {
  const d = compute(gostop({ score: 3, go: 4 }), R, PV, 3);
  assertDeltas(d, [5600, -2800, -2800]); // (3+4)=7 ×4 =28점
});

test("고스톱 - goDouble 을 끄면 고는 점수만 더한다", () => {
  const rules = { ...R, gostop: { ...R.gostop, goDouble: false } };
  const d = compute(gostop({ score: 7, go: 3 }), rules, PV, 3);
  assertDeltas(d, [2000, -1000, -1000]); // 10점, 배수 없음
});

test("고스톱 - scoreCap 은 개인 배수 적용 전에 걸린다", () => {
  const rules = { ...R, gostop: { ...R.gostop, scoreCap: 10 } };
  const d = compute(gostop({ score: 7, go: 3, losers: { 1: { pibak: true }, 2: {} } }), rules, PV, 3);
  assertDeltas(d, [3000, -2000, -1000]); // 20점 → 10점 상한 → 철수만 ×2
});

test("고스톱 - 멍박도 패자별로 적용된다", () => {
  const d = compute(gostop({ score: 3, losers: { 1: { meongbak: true }, 2: { meongbak: true } } }), R, PV, 3);
  assertDeltas(d, [1200, -600, -600]);
});

test("고스톱 - 흔들기 2회는 2^2", () => {
  const d = compute(gostop({ score: 4, shake: 2 }), R, PV, 3);
  assertDeltas(d, [3200, -1600, -1600]); // 16점
});

test("고스톱 - 고박이면 고 외친 사람이 전부 뒤집어쓰고 제3자는 0원", () => {
  const d = compute(gostop({ score: 5, go: 2, gobak: 1 }), R, PV, 3);
  assertDeltas(d, [1400, -1400, 0]); // (5+2)=7점 ×2(고박) ×100
});

test("고스톱 - 고박자의 개인 배수는 그대로 곱해진다", () => {
  const d = compute(gostop({ score: 5, go: 2, gobak: 1, losers: { 1: { pibak: true }, 2: {} } }), R, PV, 3);
  assertDeltas(d, [2800, -2800, 0]);
});

test("고스톱 - gobak 룰을 끄면 고박 입력을 무시한다", () => {
  const rules = { ...R, gostop: { ...R.gostop, gobak: false } };
  const d = compute(gostop({ score: 5, go: 2, gobak: 1 }), rules, PV, 3);
  assertDeltas(d, [1400, -700, -700]);
});

test("고스톱 - 점당 금액이 다르면 그만큼 곱해진다", () => {
  const d = compute(gostop({ score: 3 }), R, { ...PV, gostop: 500 }, 3);
  assertDeltas(d, [3000, -1500, -1500]);
});

// ── 포커 ────────────────────────────────────────────────────────────
test("포커 simple - 딴 금액을 두 패자가 반씩 낸다", () => {
  const d = compute({ game: "poker", mode: "simple", winner: 0, amount: 5000 }, R, PV, 3);
  assertDeltas(d, [5000, -2500, -2500]);
});

test("포커 simple - 홀수 금액의 나머지는 기본적으로 승자가 흡수한다", () => {
  const d = compute({ game: "poker", mode: "simple", winner: 1, amount: 5001 }, R, PV, 3);
  assertDeltas(d, [-2500, 5000, -2500]);
});

test("포커 simple - oddTo=loser 면 앞 패자가 1원을 더 낸다", () => {
  const rules = { ...R, poker: { ...R.poker, oddTo: "loser" } };
  const d = compute({ game: "poker", mode: "simple", winner: 0, amount: 5001 }, rules, PV, 3);
  assertDeltas(d, [5001, -2501, -2500]);
});

test("포커 detail - 두 명만 입력하면 세 번째는 자동 계산된다", () => {
  const d = compute({ game: "poker", mode: "detail", amounts: { 0: 5000, 1: -2000 } }, R, PV, 3);
  assertDeltas(d, [5000, -2000, -3000]);
});

// ── 훌라 ────────────────────────────────────────────────────────────
const hoola = (o) => ({ game: "hoola", winner: 0, losers: {}, winnerBonus: {}, ...o });

test("훌라 - 패자는 남은 점수만큼 내고 독박은 두 배", () => {
  const d = compute(hoola({
    losers: { 1: { score: 23 }, 2: { score: 40, dokbak: true } },
  }), R, PV, 3);
  assertDeltas(d, [10300, -2300, -8000]);
});

test("훌라 - dokbakMode=fixed 면 잔여점수 대신 고정점수를 쓴다", () => {
  const rules = { ...R, hoola: { ...R.hoola, dokbakMode: "fixed", dokbakFixed: 30 } };
  const d = compute(hoola({ losers: { 1: { score: 10 }, 2: { score: 70, dokbak: true } } }), rules, PV, 3);
  assertDeltas(d, [7000, -1000, -6000]); // 영희 30 ×2 ×100
});

test("훌라 - 스톱박은 개인 배수로 곱해진다", () => {
  const d = compute(hoola({ losers: { 1: { score: 10, stopbak: true }, 2: { score: 5 } } }), R, PV, 3);
  assertDeltas(d, [2500, -2000, -500]);
});

test("훌라 - 훌라 보너스는 두 패자 모두에게 곱해진다", () => {
  const d = compute(hoola({
    losers: { 1: { score: 10 }, 2: { score: 5 } },
    winnerBonus: { hoola: true },
  }), R, PV, 3);
  assertDeltas(d, [6000, -4000, -2000]);
});

test("훌라 - 7포카드는 기본이 꺼져 있어 배수가 붙지 않는다", () => {
  const d = compute(hoola({
    losers: { 1: { score: 10 }, 2: { score: 10 } },
    winnerBonus: { sevenPoker: true },
  }), R, PV, 3);
  assertDeltas(d, [2000, -1000, -1000]);
});

test("훌라 - 7포카드를 켜면 ×7 이 된다", () => {
  const rules = { ...R, hoola: { ...R.hoola, sevenPoker: 7 } };
  const d = compute(hoola({
    losers: { 1: { score: 10 }, 2: { score: 10 } },
    winnerBonus: { sevenPoker: true },
  }), rules, PV, 3);
  assertDeltas(d, [14000, -7000, -7000]);
});

test("훌라 - 대빵/소빵 보너스", () => {
  const d = compute(hoola({
    losers: { 1: { score: 3 }, 2: { score: 4 } },
    winnerBonus: { ppang: true },
  }), R, PV, 3);
  assertDeltas(d, [1400, -600, -800]);
});

test("훌라 - 점당 금액 기본값(10원)이 게임별로 따로 적용된다", () => {
  const d = compute(hoola({ losers: { 1: { score: 23 }, 2: { score: 40 } } }), R, DEFAULT_POINT_VALUE, 3);
  assertDeltas(d, [630, -230, -400]);
});

test("훌라 - 잔여점수 0(간발의 차)도 그대로 0원", () => {
  const d = compute(hoola({ losers: { 1: { score: 0 }, 2: { score: 12 } } }), R, PV, 3);
  assertDeltas(d, [1200, 0, -1200]);
});

// ── 입력이 틀렸을 때 ─────────────────────────────────────────────────
test("모르는 게임이면 계산하지 않고 에러를 던진다", () => {
  assert.throws(() => compute({ game: "sutda", winner: 0 }, R, PV, 3), /sutda/);
});

test("승자가 없으면 에러를 던진다", () => {
  assert.throws(() => compute(gostop({ winner: null, score: 3 }), R, PV, 3), /승자/);
});

test("점수가 정수가 아니면 에러를 던진다", () => {
  assert.throws(() => compute(gostop({ score: 3.5 }), R, PV, 3), /정수/);
});

test("포커 detail 에 입력이 2명분이 아니면 에러를 던진다", () => {
  assert.throws(() => compute({ game: "poker", mode: "detail", amounts: { 0: 5000 } }, R, PV, 3), /2명/);
});

// ── 인원이 3명이 아닐 때 (SPEC 11장) ─────────────────────────────────
test("고스톱 - 2인이면 패자 한 명에게만 받는다", () => {
  const d = compute({ ...gostop({ score: 3 }), losers: { 1: {} } }, R, PV, 2);
  assertDeltas(d, [300, -300]);
});

test("고스톱 - 4인이면 세 명 각각에게 받는다", () => {
  const d = compute(gostop({ score: 5, losers: { 1: {}, 2: {}, 3: {} } }), R, PV, 4);
  assertDeltas(d, [1500, -500, -500, -500]);
});

test("고스톱 - 빠진 사람은 0원이고 승자 몫에도 끼지 않는다", () => {
  const d = compute(gostop({ score: 5, losers: { 1: {}, 2: {}, 3: {} }, sitout: [4] }), R, PV, 5);
  assertDeltas(d, [1500, -500, -500, -500, 0]);
});

test("고스톱 - 두 명이 빠져도 나머지끼리 계산된다", () => {
  const d = compute(gostop({ score: 4, sitout: [3, 4] }), R, PV, 5);
  assertDeltas(d, [800, -400, -400, 0, 0]);
});

test("고스톱 - 빠진 사람은 배수 칩을 눌러도 여전히 0원이다", () => {
  const d = compute(gostop({ score: 4, losers: { 1: { pibak: true } }, sitout: [1] }), R, PV, 3);
  assertDeltas(d, [400, 0, -400]);
});

test("고스톱 - 승자가 빠져 있으면 에러를 던진다", () => {
  assert.throws(() => compute(gostop({ score: 4, sitout: [0] }), R, PV, 3), /빠진/);
});

test("고스톱 - 혼자만 남으면 받을 사람이 없어 에러를 던진다", () => {
  assert.throws(() => compute(gostop({ score: 4, sitout: [1, 2] }), R, PV, 3), /혼자/);
});

test("고스톱 - 4인 고박이면 고박자만 내고 나머지 패자는 0원", () => {
  const d = compute(gostop({ score: 5, go: 2, gobak: 2 }), R, PV, 4);
  assertDeltas(d, [1400, 0, -1400, 0]);
});

test("포커 simple - 4인이면 셋이 나눠 내고 나머지는 승자가 흡수한다", () => {
  const d = compute({ game: "poker", mode: "simple", winner: 0, amount: 5000 }, R, PV, 4);
  assertDeltas(d, [4998, -1666, -1666, -1666]);
});

test("포커 simple - 4인 oddTo=loser 면 앞쪽 패자부터 1원씩 더 낸다", () => {
  const rules = { ...R, poker: { ...R.poker, oddTo: "loser" } };
  const d = compute({ game: "poker", mode: "simple", winner: 0, amount: 5000 }, rules, PV, 4);
  assertDeltas(d, [5000, -1667, -1667, -1666]);
});

test("포커 simple - 2인이면 딴 만큼 그대로 주고받는다", () => {
  const d = compute({ game: "poker", mode: "simple", winner: 1, amount: 3000 }, R, PV, 2);
  assertDeltas(d, [-3000, 3000]);
});

test("포커 detail - 4인이면 세 명을 입력받고 나머지가 자동 계산된다", () => {
  const d = compute({ game: "poker", mode: "detail", amounts: { 0: 5000, 1: -2000, 2: -1000 } }, R, PV, 4);
  assertDeltas(d, [5000, -2000, -1000, -2000]);
});

test("포커 detail - 입력이 인원-1명분이 아니면 에러를 던진다", () => {
  assert.throws(() => compute({ game: "poker", mode: "detail", amounts: { 0: 5000 } }, R, PV, 4), /3명/);
});

test("훌라 - 4인이면 패자 셋이 각자 남은 점수만큼 낸다", () => {
  const d = compute(hoola({ losers: { 1: { score: 10 }, 2: { score: 20 }, 3: { score: 30 } } }), R, DEFAULT_POINT_VALUE, 4);
  assertDeltas(d, [600, -100, -200, -300]);
});

test("훌라 - 2인도 그대로 돈다", () => {
  const d = compute(hoola({ winner: 1, losers: { 0: { score: 15 } } }), R, PV, 2);
  assertDeltas(d, [-1500, 1500]);
});

test("인원을 넘기지 않으면 에러를 던진다", () => {
  assert.throws(() => compute(gostop({ score: 3 }), R, PV), /인원/);
});

test("인원이 2~5명 밖이면 에러를 던진다", () => {
  assert.throws(() => compute(gostop({ score: 3 }), R, PV, 6), /2~5/);
  assert.throws(() => compute(gostop({ score: 3 }), R, PV, 1), /2~5/);
});

test("승자가 인원 밖이면 에러를 던진다", () => {
  assert.throws(() => compute(gostop({ winner: 3, score: 3 }), R, PV, 3), /승자/);
});

// ── 인원 스윕 — 2·3·4·5 전부에서 불변식이 서는가 (SPEC 11장) ─────────
for (const n of [2, 3, 4, 5]) {
  test(`${n}인 - 고스톱 모든 배수 조합에서 불변식이 선다`, () => {
    for (let winner = 0; winner < n; winner++) {
      for (const score of [1, 7, 12]) {
        for (const go of [0, 3]) {
          const losers = {};
          for (let i = 0; i < n; i++) if (i !== winner) losers[i] = { pibak: i % 2 === 0, gwangbak: i % 3 === 0 };
          assertInvariants(compute(gostop({ winner, score, go, losers }), R, PV, n), n);
        }
      }
    }
  });

  test(`${n}인 - 빠진 사람이 있어도 불변식이 선다`, () => {
    // 승자 0, 나머지 중 한 명씩 돌아가며 빠뜨린다 (참여 2명은 남겨둔다)
    for (let out = 1; out < n; out++) {
      if (n - 1 < 2) continue;
      const d = assertInvariants(compute(gostop({ score: 5, sitout: [out] }), R, PV, n), n);
      assert.equal(d[out], 0, "빠진 사람은 0원이다");
    }
  });

  test(`${n}인 - 포커 simple 은 나머지 원이 남아도 합이 0이다`, () => {
    for (const amount of [0, 1, 999, 5000, 10007]) {
      for (const oddTo of ["winner", "loser"]) {
        const rules = { ...R, poker: { ...R.poker, oddTo } };
        const d = assertInvariants(compute({ game: "poker", mode: "simple", winner: 0, amount }, rules, PV, n), n);
        for (let i = 1; i < n; i++) assert.ok(d[i] <= 0, "패자가 돈을 받지는 않는다");
      }
    }
  });

  test(`${n}인 - 훌라 잔여점수가 어떻든 합이 0이다`, () => {
    for (const base of [0, 7, 40, 83]) {
      const losers = {};
      for (let i = 1; i < n; i++) losers[i] = { score: base + i, dokbak: i === 1, stopbak: i === 2 };
      assertInvariants(compute(hoola({ losers }), R, DEFAULT_POINT_VALUE, n), n);
    }
  });
}
