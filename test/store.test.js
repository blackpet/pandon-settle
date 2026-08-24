import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore, KEY, BACKUP_PREFIX } from "../public/src/store.js";

/** localStorage 흉내. 브라우저 없이 저장 로직을 그대로 돌린다. */
function fakeStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    keys: () => [...m.keys()],
    raw: m,
  };
}
/** 사파리 프라이빗 모드처럼 쓰기가 막힌 저장소 */
function brokenStorage() {
  const s = fakeStorage();
  s.setItem = () => { throw new Error("QuotaExceededError"); };
  return s;
}
const at = () => 1755993600000;
const mk = (storage = fakeStorage()) => createStore({ storage, now: at });

const NAMES3 = ["재호", "철수", "영희"];
const round = (deltas) => ({ game: "gostop", winner: 0, score: 3, deltas, at: at() });

test("새 판을 시작하면 인원·게임·점당금액이 잡히고 라운드는 비어 있다", () => {
  const s = mk();
  s.newGame({ names: NAMES3, game: "gostop" });
  assert.equal(s.state.players.length, 3);
  assert.deepEqual(s.state.players.map((p) => p.name), NAMES3);
  assert.equal(s.state.game, "gostop");
  assert.deepEqual(s.state.rounds, []);
  assert.equal(s.state.startedAt, at());
});

test("플레이어마다 자리 순서대로 색과 이모지가 붙는다", () => {
  const s = mk();
  s.newGame({ names: ["가", "나", "다", "라", "마"] });
  const colors = s.state.players.map((p) => p.color);
  assert.equal(new Set(colors).size, 5, "다섯 명이 서로 다른 색을 가진다");
  assert.equal(colors[0], "#4DA3FF");
  assert.ok(s.state.players.every((p) => p.emoji));
});

test("이름을 비워두면 자리 번호로 채운다", () => {
  const s = mk();
  s.newGame({ names: ["재호", "  ", ""] });
  assert.deepEqual(s.state.players.map((p) => p.name), ["재호", "2번", "3번"]);
});

test("인원이 2~5명 밖이면 거절한다", () => {
  const s = mk();
  assert.throws(() => s.newGame({ names: ["혼자"] }), /2~5/);
  assert.throws(() => s.newGame({ names: ["가","나","다","라","마","바"] }), /2~5/);
});

test("상태가 바뀔 때마다 즉시 저장한다", () => {
  const storage = fakeStorage();
  const s = mk(storage);
  s.newGame({ names: NAMES3 });
  assert.ok(storage.getItem(KEY), "새 판 직후 저장돼 있다");
  s.addRound(round([600, -300, -300]));
  const saved = JSON.parse(storage.getItem(KEY));
  assert.equal(saved.rounds.length, 1);
});

test("저장된 판을 그대로 복원한다", () => {
  const storage = fakeStorage();
  const a = mk(storage);
  a.newGame({ names: NAMES3 });
  a.addRound(round([600, -300, -300]));

  const b = mk(storage);
  assert.equal(b.state.rounds.length, 1);
  assert.deepEqual(b.balances(), [600, -300, -300]);
});

test("잔액은 라운드를 접어서 구한다", () => {
  const s = mk();
  s.newGame({ names: NAMES3 });
  s.addRound(round([600, -300, -300]));
  s.addRound(round([-200, 400, -200]));
  assert.deepEqual(s.balances(), [400, 100, -500]);
});

test("합이 0이 아닌 라운드는 저장하지 않고 거절한다", () => {
  const s = mk();
  s.newGame({ names: NAMES3 });
  assert.throws(() => s.addRound(round([600, -300, -100])), /0/);
  assert.equal(s.state.rounds.length, 0);
});

test("인원과 길이가 다른 deltas 는 거절한다", () => {
  const s = mk();
  s.newGame({ names: NAMES3 });
  assert.throws(() => s.addRound(round([600, -600])), /인원/);
});

test("실행취소는 마지막 판만 지운다", () => {
  const s = mk();
  s.newGame({ names: NAMES3 });
  s.addRound(round([600, -300, -300]));
  s.addRound(round([-200, 400, -200]));
  s.undo();
  assert.equal(s.state.rounds.length, 1);
  assert.deepEqual(s.balances(), [600, -300, -300]);
});

test("실행취소할 판이 없으면 아무 일도 일어나지 않는다", () => {
  const s = mk();
  s.newGame({ names: NAMES3 });
  s.undo();
  assert.deepEqual(s.state.rounds, []);
});

test("구독자는 상태가 바뀔 때마다 불린다", () => {
  const s = mk();
  let calls = 0;
  const off = s.subscribe(() => calls++);
  s.newGame({ names: NAMES3 });
  s.addRound(round([600, -300, -300]));
  assert.equal(calls, 2);
  off();
  s.undo();
  assert.equal(calls, 2, "구독을 끊으면 더 이상 안 불린다");
});

test("저장이 막혀도 앱은 죽지 않고 경고 상태가 켜진다", () => {
  const s = mk(brokenStorage());
  s.newGame({ names: NAMES3 });
  s.addRound(round([600, -300, -300]));
  assert.equal(s.saveBlocked, true);
  assert.deepEqual(s.balances(), [600, -300, -300], "메모리에서는 계속 돈다");
});

test("깨진 데이터는 지우지 않고 백업으로 옮긴 뒤 새로 시작한다", () => {
  const storage = fakeStorage({ [KEY]: "{이건 JSON 이 아니다" });
  const s = mk(storage);
  assert.equal(s.state.rounds.length, 0);
  const backup = storage.keys().find((k) => k.startsWith(BACKUP_PREFIX));
  assert.ok(backup, "백업 키로 옮겨져 있다");
  assert.equal(storage.getItem(backup), "{이건 JSON 이 아니다");
});

test("모르는 버전도 백업으로 옮긴 뒤 새로 시작한다", () => {
  const storage = fakeStorage({ [KEY]: JSON.stringify({ version: 99, rounds: [1, 2, 3] }) });
  const s = mk(storage);
  assert.equal(s.state.rounds.length, 0);
  assert.ok(storage.keys().some((k) => k.startsWith(BACKUP_PREFIX)));
});

test("이어서 할 판이 있는지 알려준다", () => {
  const storage = fakeStorage();
  assert.equal(mk(storage).hasGame(), false);
  const s = mk(storage);
  s.newGame({ names: NAMES3 });
  s.addRound(round([600, -300, -300]));
  assert.equal(mk(storage).hasGame(), true);
});

test("룰과 점당 금액을 바꿔도 이미 끝난 판의 금액은 그대로다", () => {
  const s = mk();
  s.newGame({ names: NAMES3, pointValue: { gostop: 100 } });
  s.addRound(round([600, -300, -300]));
  s.setPointValue("gostop", 1000);
  s.setRule("gostop", "pibak", 3);
  assert.deepEqual(s.balances(), [600, -300, -300]);
  assert.equal(s.state.pointValue.gostop, 1000);
  assert.equal(s.state.rules.gostop.pibak, 3);
});

test("새 판을 시작하면 지난 판이 사라진다", () => {
  const s = mk();
  s.newGame({ names: NAMES3 });
  s.addRound(round([600, -300, -300]));
  s.newGame({ names: ["가", "나"] });
  assert.deepEqual(s.state.rounds, []);
  assert.equal(s.state.players.length, 2);
});

test("아바타 이모지를 지정하면 그대로 쓴다", () => {
  const s = mk();
  s.newGame({ names: NAMES3, emoji: ["🐼", "🐯", "🐸"] });
  assert.deepEqual(s.state.players.map((p) => p.emoji), ["🐼", "🐯", "🐸"]);
});

test("이모지를 안 주면 자리 순서대로 기본값이 붙는다", () => {
  const s = mk();
  s.newGame({ names: NAMES3 });
  assert.equal(s.state.players[0].emoji, "🐶");
});

test("룰을 기본값으로 되돌려도 진행중인 판은 그대로다", () => {
  const s = mk();
  s.newGame({ names: NAMES3 });
  s.addRound(round([600, -300, -300]));
  s.setRule("gostop", "pibak", 5);
  s.setRule("hoola", "dokbakMode", "fixed");
  s.resetRules();
  assert.equal(s.state.rules.gostop.pibak, 2);
  assert.equal(s.state.rules.hoola.dokbakMode, "multiply");
  assert.equal(s.state.rounds.length, 1, "판 기록은 건드리지 않는다");
});

test("되돌린 룰도 즉시 저장된다", () => {
  const storage = fakeStorage();
  const s = mk(storage);
  s.newGame({ names: NAMES3 });
  s.setRule("gostop", "pibak", 5);
  s.resetRules();
  assert.equal(JSON.parse(storage.getItem(KEY)).rules.gostop.pibak, 2);
});

test("조용한 초안 갱신은 저장은 하되 화면을 다시 그리지 않는다", () => {
  // 입력 중인 칸을 통째로 다시 그리면 노드가 교체되면서 키가 씹힌다.
  // 그래서 타이핑 중에는 저장만 하고 구독자를 깨우지 않는다.
  const storage = fakeStorage();
  const s = mk(storage);
  s.newGame({ names: NAMES3 });
  let calls = 0;
  s.subscribe(() => calls++);

  s.setDraft({ winner: 0, losers: { 1: { score: 12 } } }, { silent: true });
  assert.equal(calls, 0, "구독자는 불리지 않는다");
  assert.equal(JSON.parse(storage.getItem(KEY)).draft.losers[1].score, 12, "저장은 된다");

  s.setDraft({ winner: 0 });
  assert.equal(calls, 1, "조용하지 않은 갱신은 평소대로 알린다");
});

test("앱을 다시 열면 마지막 화면이 아니라 홈에서 시작한다", () => {
  // SPEC 2장: 저장된 판이 있으면 홈에서 [이어서 하기] 를 보여준다.
  // 정산 화면을 보다 앱을 닫았다고 정산부터 뜨면 "새 판인가?" 하고 헷갈린다.
  const storage = fakeStorage();
  const a = mk(storage);
  a.newGame({ names: NAMES3 });
  a.addRound(round([600, -300, -300]));
  a.setScreen("result");

  const b = mk(storage);
  assert.equal(b.state.screen, "home");
  assert.equal(b.state.rounds.length, 1, "판은 그대로 살아 있다");
  assert.equal(b.hasGame(), true);
});
