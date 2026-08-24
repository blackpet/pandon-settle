/**
 * rules.js — 게임별 "점수 → 금액" 계산 (순수 함수)
 *
 * 이 파일은 DOM 도 localStorage 도 모른다. 숫자만 안다.
 * 모든 배수는 인자로 받은 rules 를 거친다 — 상수를 여기 박지 않는다.
 * 모든 금액은 정수(원)다. 부동소수점을 쓰지 않는다.
 * 인원 n(2~5)도 인자로 받는다 — players 를 직접 읽지 않고, 기본값도 두지 않는다.
 */

/** SPEC 3장. 기본값만으로도 바로 한 판을 칠 수 있어야 한다. */
export const DEFAULT_RULES = {
  gostop: {
    pibak: 2,          // 피박 배수 (0·1이면 사용 안 함)
    gwangbak: 2,       // 광박 배수
    meongbak: 2,       // 멍박 배수
    goDouble: true,    // 3고부터 2배씩 (false 면 고당 +1점만)
    shake: 2,          // 흔들기 1회당 배수
    gobak: true,       // 고박 사용 여부
    scoreCap: null,    // 점수 상한 (null = 없음)
  },
  hoola: {
    dokbak: 2,
    dokbakMode: "multiply", // "multiply" = 잔여점수 그대로 | "fixed" = 고정점수
    dokbakFixed: 30,
    hoolaBonus: 4,
    sevenPoker: 0,     // 0 = 사용 안 함, 켜면 7
    stopbak: 2,
    ppangBonus: 2,
  },
  poker: {
    mode: "simple",    // "simple" = 승자+금액 | "detail" = 개별 입력
    oddTo: "winner",   // 반반이 안 나눠떨어질 때 1원 나머지 귀속
  },
};

/** 훌라는 잔여점수가 20~80까지 나와서 자릿수가 다르다. 게임별로 분리한다. */
export const DEFAULT_POINT_VALUE = { gostop: 100, poker: 100, hoola: 10 };

/** 배수 설정을 켜짐 여부와 함께 해석한다. 설정이 0·1이면 "사용 안 함"이다. */
function mul(setting, on) {
  return on && setting > 1 ? setting : 1;
}

function intOrThrow(v, what) {
  if (!Number.isInteger(v)) throw new Error(`${what}는 정수여야 한다: ${v}`);
  return v;
}

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 5;

function playerCountOrThrow(n) {
  if (!Number.isInteger(n)) throw new Error(`인원을 넘겨야 한다: ${n}`);
  if (n < MIN_PLAYERS || n > MAX_PLAYERS) throw new Error(`인원은 2~5명이다: ${n}`);
  return n;
}

function winnerOrThrow(round, n) {
  const w = round.winner;
  if (!Number.isInteger(w) || w < 0 || w >= n) throw new Error(`승자를 먼저 골라야 한다: ${w}`);
  return w;
}

/** SPEC 4장 불변식 — 반환 직전에 반드시 통과해야 한다. */
export function assertZeroSum(deltas) {
  const sum = deltas.reduce((a, b) => a + b, 0);
  if (sum !== 0) throw new Error(`deltas 합이 0이 아니다: [${deltas}] → ${sum}`);
  for (const v of deltas) intOrThrow(v, "금액");
  return deltas;
}

/** 라운드 초안 + 룰 + 점당 금액 + 인원 → 각자의 금액 변화량 (길이 n) */
export function compute(round, rules = DEFAULT_RULES, pointValue = DEFAULT_POINT_VALUE, n) {
  playerCountOrThrow(n);
  switch (round.game) {
    case "gostop": return computeGostop(round, rules.gostop, pointValue.gostop, n);
    case "poker":  return computePoker(round, rules.poker, pointValue.poker, n);
    case "hoola":  return computeHoola(round, rules.hoola, pointValue.hoola, n);
    default: throw new Error(`모르는 게임이다: ${round.game}`);
  }
}

// ── 🎴 고스톱 ────────────────────────────────────────────────────────
export function computeGostop(round, r, pv, n) {
  playerCountOrThrow(n);
  const winner = winnerOrThrow(round, n);

  // 4~5인이면 한 명이 광을 팔고 쉰다. 기본은 전원 참여라 sitout 은 보통 비어 있다.
  const sitout = new Set(round.sitout ?? []);
  if (sitout.has(winner)) throw new Error(`빠진 사람은 승자가 될 수 없다: ${winner}`);
  const playing = [];
  for (let i = 0; i < n; i++) if (!sitout.has(i)) playing.push(i);
  if (playing.length < 2) throw new Error(`혼자서는 판이 성립하지 않는다: ${playing.length}명`);

  const score = intOrThrow(round.score ?? 0, "점수");
  const go = intOrThrow(round.go ?? 0, "고 횟수");
  const shakeCount = intOrThrow(round.shake ?? 0, "흔들기 횟수");

  // 공통점수 = (기본점수 + 고횟수) × 고배수 × 흔들기배수
  const goMul = r.goDouble && go >= 3 ? 2 ** (go - 2) : 1;
  const shakeMul = mul(r.shake, shakeCount > 0) ** shakeCount;
  let common = (score + go) * goMul * shakeMul;
  // 상한은 개인 배수를 곱하기 전에 걸린다 (SPEC 5-1)
  if (Number.isInteger(r.scoreCap) && r.scoreCap > 0) common = Math.min(common, r.scoreCap);

  const personal = (id) => {
    const f = round.losers?.[id] ?? {};
    return mul(r.pibak, f.pibak) * mul(r.gwangbak, f.gwangbak) * mul(r.meongbak, f.meongbak);
  };

  const deltas = new Array(n).fill(0);
  const gobak = r.gobak && Number.isInteger(round.gobak) && !sitout.has(round.gobak)
    ? round.gobak
    : null;

  if (gobak !== null && gobak !== winner) {
    // 고를 외쳤다가 상대가 나버린 경우 — 고 외친 사람이 전부 뒤집어쓰고 나머지 패자는 0원
    const pay = common * 2 * personal(gobak) * pv;
    deltas[gobak] -= pay;   // 0 에서 빼야 -0 이 생기지 않는다 ("-0원" 표기 방지)
    deltas[winner] += pay;
  } else {
    for (const i of playing) {
      if (i === winner) continue;
      const pay = common * personal(i) * pv;
      deltas[i] -= pay;
      deltas[winner] += pay;
    }
  }
  return assertZeroSum(deltas);
}

// ── ♠️ 포커 ──────────────────────────────────────────────────────────
export function computePoker(round, r, pv, n) {
  playerCountOrThrow(n);
  const mode = round.mode ?? r.mode;

  if (mode === "detail") {
    // n명 중 n-1명만 입력받고 마지막 한 명은 자동 계산한다 → 합계가 0이 아닐 수가 없다
    const amounts = round.amounts ?? {};
    const entries = Object.entries(amounts);
    if (entries.length !== n - 1) {
      throw new Error(`detail 모드는 ${n - 1}명분만 입력한다: ${entries.length}명`);
    }
    const deltas = new Array(n).fill(0);
    for (const [id, v] of entries) deltas[Number(id)] = intOrThrow(v, "금액");
    const rest = deltas.findIndex((_, i) => !(String(i) in amounts));
    deltas[rest] -= deltas.reduce((a, b) => a + b, 0);
    return assertZeroSum(deltas);
  }

  const winner = winnerOrThrow(round, n);
  const amount = intOrThrow(round.amount ?? 0, "금액");
  if (amount < 0) throw new Error(`딴 금액은 0원 이상이어야 한다: ${amount}`);

  const losers = [];
  for (let i = 0; i < n; i++) if (i !== winner) losers.push(i);
  const share = Math.floor(amount / losers.length);
  const odd = amount - share * losers.length; // 0 이상 losers.length 미만

  const deltas = new Array(n).fill(0);
  // 기본(oddTo="winner")은 나머지를 승자가 흡수한다 — 패자 부담이 설정 때문에 늘지 않게.
  // "loser" 면 앞쪽 패자부터 1원씩 더 낸다.
  losers.forEach((id, idx) => {
    const extra = r.oddTo === "loser" && idx < odd ? 1 : 0;
    deltas[id] -= share + extra;
    deltas[winner] += share + extra;
  });
  return assertZeroSum(deltas);
}

// ── 🃏 훌라 ──────────────────────────────────────────────────────────
export function computeHoola(round, r, pv, n) {
  playerCountOrThrow(n);
  const winner = winnerOrThrow(round, n);
  const b = round.winnerBonus ?? {};
  const bonus = mul(r.hoolaBonus, b.hoola) * mul(r.sevenPoker, b.sevenPoker) * mul(r.ppangBonus, b.ppang);

  const deltas = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (i === winner) continue;
    const f = round.losers?.[i] ?? {};
    const left = intOrThrow(f.score ?? 0, "남은 점수");
    if (left < 0) throw new Error(`남은 점수는 0 이상이어야 한다: ${left}`);
    const effective = f.dokbak && r.dokbakMode === "fixed" ? r.dokbakFixed : left;
    const personal = mul(r.dokbak, f.dokbak) * mul(r.stopbak, f.stopbak);
    const pay = effective * personal * bonus * pv;
    deltas[i] -= pay;
    deltas[winner] += pay;
  }
  return assertZeroSum(deltas);
}
