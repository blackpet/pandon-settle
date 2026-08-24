/**
 * store.js — 상태 보관 + localStorage
 *
 * 계산 규칙을 모른다. rules.js 를 import 하지 않는다 — 이미 계산된 deltas 를 받아 담을 뿐이다.
 * 저장은 이 파일 안에서만 일어난다. 화면 코드에 저장을 호출하는 자리를 만들지 않아야
 * "저장을 빠뜨렸다"가 구조적으로 불가능해진다.
 */
import { balances as fold } from "./settle.js";
import { DEFAULT_RULES, DEFAULT_POINT_VALUE, MIN_PLAYERS, MAX_PLAYERS } from "./rules.js";

export const KEY = "pandon-settle:v1";
export const BACKUP_PREFIX = "pandon-settle:backup:";
export const VERSION = 1;

/** 자리 순서대로 배정한다 — 같은 자리면 언제나 같은 색이다 */
export const PLAYER_COLORS = ["#4DA3FF", "#FFB84D", "#B47DFF", "#35D6C4", "#FF7EC7"];
export const PLAYER_EMOJI = ["🐶", "🐱", "🐰", "🦊", "🐻"];

function emptyState() {
  return {
    version: VERSION,
    players: [],
    game: "gostop",
    pointValue: { ...DEFAULT_POINT_VALUE },
    rules: structuredClone(DEFAULT_RULES),
    rounds: [],
    startedAt: null,
    screen: "home",
    draft: null,
  };
}

export function createStore({ storage, now = () => Date.now() } = {}) {
  const store = {
    state: emptyState(),
    saveBlocked: false,
    subscribe,
    newGame,
    addRound,
    undo,
    setScreen,
    setDraft,
    setRule,
    resetRules,
    setPointValue,
    setGame,
    balances: () => fold(store.state.rounds, Math.max(store.state.players.length, MIN_PLAYERS)),
    hasGame: () => store.state.players.length > 0,
  };

  const listeners = new Set();
  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  /** 모든 변경 함수는 이걸로 끝난다. 저장과 통지가 한 자리에 묶여 있다. */
  function commit() {
    save();
    for (const fn of listeners) fn(store.state);
  }

  function save() {
    if (!storage) return;
    try {
      storage.setItem(KEY, JSON.stringify(store.state));
      store.saveBlocked = false;
    } catch {
      // 사파리 프라이빗 모드 등. 앱을 죽이지 않고 메모리에서 계속 돌리되,
      // 화면 위쪽에 경고를 계속 띄운다 — 조용히 실패하면 하룻밤이 통째로 날아간다.
      store.saveBlocked = true;
    }
  }

  /** 못 읽을 데이터는 지우지 않는다. 백업 키로 옮긴 뒤 새로 시작한다. */
  function quarantine(raw) {
    try {
      storage.setItem(BACKUP_PREFIX + now(), raw);
      storage.removeItem(KEY);
    } catch {
      store.saveBlocked = true;
    }
  }

  function load() {
    if (!storage) return;
    const raw = storage.getItem(KEY);
    if (!raw) return;
    let saved;
    try {
      saved = JSON.parse(raw);
    } catch {
      return quarantine(raw);
    }
    if (!saved || saved.version !== VERSION || !Array.isArray(saved.rounds)) {
      return quarantine(raw);
    }
    // 화면만은 복원하지 않는다 — 앱을 열면 언제나 홈이고, 거기서 [이어서 하기] 를 고른다
    // (SPEC 2장). 정산 화면을 보다 닫았다고 정산부터 뜨면 새 판인지 헷갈린다.
    store.state = { ...emptyState(), ...saved, screen: "home" };
  }

  function newGame({ names = [], emoji = [], game = "gostop", pointValue } = {}) {
    const n = names.length;
    if (n < MIN_PLAYERS || n > MAX_PLAYERS) {
      throw new Error(`인원은 ${MIN_PLAYERS}~${MAX_PLAYERS}명이다: ${n}`);
    }
    const kept = store.state.rules; // 룰 설정은 판이 바뀌어도 유지한다
    store.state = {
      ...emptyState(),
      rules: kept,
      players: names.map((raw, i) => ({
        id: i,
        name: String(raw ?? "").trim() || `${i + 1}번`,
        emoji: emoji[i] || PLAYER_EMOJI[i],
        color: PLAYER_COLORS[i],
      })),
      game,
      pointValue: { ...DEFAULT_POINT_VALUE, ...pointValue },
      startedAt: now(),
      screen: "play",
    };
    commit();
  }

  function addRound(round) {
    const n = store.state.players.length;
    const deltas = round?.deltas;
    if (!Array.isArray(deltas) || deltas.length !== n) {
      throw new Error(`deltas 길이가 인원과 다르다: ${deltas?.length} ≠ ${n}`);
    }
    const sum = deltas.reduce((a, b) => a + b, 0);
    if (sum !== 0) throw new Error(`deltas 합이 0이 아니다: ${sum}`);
    store.state.rounds.push({ at: now(), ...round });
    store.state.draft = null;
    commit();
  }

  function undo() {
    if (store.state.rounds.length === 0) return;
    store.state.rounds.pop();
    commit();
  }

  function setScreen(screen) {
    store.state.screen = screen;
    commit();
  }

  /**
   * silent 는 입력 중인 칸을 위한 것이다. 타이핑마다 화면을 통째로 다시 그리면
   * 입력 노드가 교체되면서 빠르게 친 글자가 씹힌다. 저장은 그대로 하고 알림만 건너뛴다.
   */
  function setDraft(draft, { silent = false } = {}) {
    store.state.draft = draft;
    if (silent) return save();
    commit();
  }

  function setGame(game) {
    store.state.game = game;
    store.state.draft = null;
    commit();
  }

  function setRule(game, key, value) {
    store.state.rules[game][key] = value;
    commit();
  }

  /** 룰만 기본값으로. 진행중인 판은 건드리지 않는다 — 이미 끝난 판의 금액은 deltas 에 박혀 있다 */
  function resetRules() {
    store.state.rules = structuredClone(DEFAULT_RULES);
    commit();
  }

  function setPointValue(game, value) {
    store.state.pointValue[game] = value;
    commit();
  }

  load();
  return store;
}
