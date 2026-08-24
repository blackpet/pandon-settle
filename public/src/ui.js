/**
 * ui.js — 화면 렌더링과 이벤트
 *
 * 계산을 하지 않는다. rules.js 가 준 deltas 를 그리기만 한다.
 * 상태가 바뀌면 화면을 통째로 다시 그린다 — "상태는 바뀌었는데 화면 한구석이 옛날 값"
 * 이라는 부류의 버그를 통째로 없애는 대신, 다시 그리면 안 되는 두 가지만 예외로 둔다
 * (입력 중인 칸의 커서, 잔액 숫자 롤링).
 */
import { createStore, PLAYER_COLORS } from "./store.js";
import { compute, MIN_PLAYERS, MAX_PLAYERS } from "./rules.js";
import { settle } from "./settle.js";
import { chartSvg } from "./chart.js";

const app = document.getElementById("app");

/** 사파리 프라이빗 모드에서는 localStorage 접근 자체가 던진다 */
function safeStorage() {
  try {
    const s = window.localStorage;
    s.setItem("pandon-settle:probe", "1");
    s.removeItem("pandon-settle:probe");
    return s;
  } catch {
    return null;
  }
}

const store = createStore({ storage: safeStorage() });
const st = () => store.state;
const N = () => st().players.length;

const GAMES = { gostop: "🎴 고스톱", poker: "♠️ 포커", hoola: "🃏 훌라" };
/** 이모지는 서로게이트 페어라 slice(2) 하면 공백이 남는다 */
const gameName = (g) => GAMES[g].replace(/^\S+\s*/u, "");
const EMOJI_POOL = ["🐶", "🐱", "🐰", "🦊", "🐻", "🐼", "🐯", "🐸", "🐵", "🐷"];

// ── 표기 ────────────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const comma = (v) => Math.abs(v).toLocaleString("ko-KR");
const won = (v) => (v > 0 ? "+" : v < 0 ? "-" : "") + comma(v);
const cls = (v) => (v > 0 ? "win" : v < 0 ? "lose" : "even");
/** 스크린리더가 "마이너스 1800" 으로 읽게 한다 */
const wonLabel = (v) => (v > 0 ? "플러스 " : v < 0 ? "마이너스 " : "") + comma(v) + "원";

/**
 * 판 도중에 게임을 바꿀 수 있으므로(SPEC 12장 3번) "지금 고른 게임"과
 * "실제로 친 게임"이 다를 수 있다. 기록을 말할 때는 친 것을 말한다.
 */
function playedLabel() {
  const kinds = [...new Set(st().rounds.map((r) => r.game))];
  if (kinds.length === 0) return gameName(st().game);
  return kinds.map(gameName).join("·");
}

function dayLabel() {
  const d = new Date(st().startedAt ?? Date.now());
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

function moodOf(bals, i) {
  const v = bals[i];
  if (v === 0) return "😐";
  if (v > 0) return v === Math.max(...bals) ? "🤑" : "😏";
  return v === Math.min(...bals) ? "🫠" : "😥";
}

// ── 라운드 초안 ─────────────────────────────────────────────────────
function blankDraft(game) {
  if (game === "hoola") return { winner: null, losers: {}, winnerBonus: {} };
  if (game === "poker") return { winner: null, amount: 0 };
  return { winner: null, score: 0, go: 0, shake: 0, gobak: null, losers: {}, sitout: [] };
}
const draft = () => st().draft ?? blankDraft(st().game);
const patch = (o) => store.setDraft({ ...draft(), ...o });
/**
 * 타이핑 중에는 화면을 통째로 다시 그리지 않는다 — 입력 노드가 교체되면서
 * 빠르게 친 글자가 씹힌다. 값은 저장하고, 눈에 보여야 하는 미리보기만 갈아 끼운다.
 */
const patchTyping = (o) => {
  store.setDraft({ ...draft(), ...o }, { silent: true });
  refreshPreview();
};

function toRound(d) {
  return st().game === "poker"
    ? { game: "poker", mode: "simple", winner: d.winner, amount: d.amount }
    : { game: st().game, ...d };
}

function ready(d) {
  if (d.winner === null) return false;
  if (st().game === "gostop") return d.score > 0;
  if (st().game === "poker") return d.amount > 0;
  return true; // 훌라는 전원 0점(간발의 차)도 유효한 판이다
}

/** 미리보기와 확정이 같은 계산을 쓴다 — 두 값이 다를 자리가 없다 */
function previewDeltas() {
  const d = draft();
  if (!ready(d)) return null;
  try {
    return compute(toRound(d), st().rules, st().pointValue, N());
  } catch {
    return null;
  }
}

// ── 조각 ────────────────────────────────────────────────────────────
const avatar = (p) => `<span class="av" style="background:${p.color}22">${esc(p.emoji)}</span>`;

function balanceRow(p, v, i, bals, out = false) {
  return `<div class="bal${out ? " out" : ""}">
    <span class="tag" style="background:${p.color}"></span>
    ${avatar(p)}
    <span class="nm">${esc(p.name)}</span>
    <span class="amt ${cls(v)}" data-bal="${i}" aria-label="${esc(p.name)} ${wonLabel(v)}">${won(v)}</span>
    ${out ? '<span class="hint">빠짐</span>' : `<span class="mood" aria-hidden="true">${moodOf(bals, i)}</span>`}
  </div>`;
}

function whoButtons(selected, act = "pick") {
  // 4명이면 3+1 로 떨어져 마지막 하나가 붕 뜬다. 2×2 가 눈에 낫다.
  const cols = st().players.length === 4 ? 2 : 3;
  return `<div style="display:grid;grid-template-columns:repeat(${cols},minmax(0,1fr));gap:8px">${st().players.map((p) => `
    <button class="who" data-act="${act}" data-id="${p.id}" aria-pressed="${selected === p.id}"
      style="${selected === p.id ? `border-color:${p.color};background:${p.color}1A` : ""}">
      <span aria-hidden="true">${esc(p.emoji)}</span> <span>${esc(p.name)}</span>
    </button>`).join("")}</div>`;
}

const chip = (label, on, act, data = {}, extra = "", off = false) => {
  const attrs = Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(" ");
  return `<button class="chip ${extra}" data-act="${act}" ${attrs}
    aria-pressed="${!!on}"${off ? " disabled" : ""}>${esc(label)}</button>`;
};

function receipt(deltas, title, note) {
  const sit = new Set(draft().sitout ?? []);
  return `<div class="rc">
    <div class="rc-h"><span class="meta">${esc(title)}</span><span class="meta">${esc(note)}</span></div>
    <div class="tearwrap"><span class="tear"></span></div>
    <div class="rc-b">${st().players.map((p, i) => `
      <div class="rc-l${sit.has(p.id) ? " out" : ""}">
        <span class="nm">${esc(p.emoji)} ${esc(p.name)}</span>
        <span class="amt ${cls(deltas[i])}" aria-label="${wonLabel(deltas[i])}">${won(deltas[i])}</span>
      </div>`).join("")}</div>
  </div>`;
}

/** 어느 화면에서든 판돈·룰·새로고침에 닿는 길. 헤더 오른쪽 끝에 항상 있다. */
const moreBtn = `<button class="more" data-act="go" data-screen="menu" aria-label="더보기">⋯</button>`;

const presetsFor = (game) => (game === "hoola" ? [10, 50, 100] : [100, 500, 1000]);

let updateReady = false;
const updateBanner = () => updateReady ? `<div class="update" role="status">
    <span><b>새 버전이 준비됐어요</b></span>
    <button data-act="reload">지금 켜기</button>
  </div>` : "";

const warnBanner = () => store.saveBlocked ? `<div class="warn" role="alert">
    <b>저장이 꺼져 있습니다</b>
    <p>브라우저가 저장을 막고 있어요. 지금 판은 계속 칠 수 있지만 앱을 닫으면 사라집니다.
       시크릿 모드를 끄면 저장됩니다.</p>
  </div>` : "";

// ── 화면: 홈 ────────────────────────────────────────────────────────
function homeScreen() {
  const has = store.hasGame();
  const bals = has ? store.balances() : [];
  return `${updateBanner()}${warnBanner()}
  <div style="padding:88px 20px 0;text-align:center">
    <div style="font-size:34px" aria-hidden="true">🎴🪙</div>
    <h1 style="font-family:var(--fd);font-weight:700;font-size:34px;letter-spacing:.22em;text-indent:.22em;margin:20px 0 0">판돈정산</h1>
    <p style="font-family:var(--fd);font-size:13px;color:var(--text-dim);letter-spacing:.04em;margin:12px 0 0">동전은 없어도 계산은 정확하게</p>
  </div>
  ${has ? `<div class="sect" style="margin-top:44px">
    <div class="rc">
      <div class="rc-h">
        <span class="meta">진행중 · ${playedLabel()} ${st().rounds.length}판</span>
        <span class="meta">${dayLabel()}</span>
      </div>
      <div class="tearwrap"><span class="tear"></span></div>
      <div class="rc-b">${st().players.map((p, i) => `
        <div class="rc-l"><span class="nm">${esc(p.emoji)} ${esc(p.name)}</span>
        <span class="amt ${cls(bals[i])}" aria-label="${wonLabel(bals[i])}">${won(bals[i])}</span></div>`).join("")}</div>
    </div>
  </div>` : ""}
  <div class="sect stack" style="margin-top:${has ? 16 : 56}px;gap:10px">
    ${has ? `<button class="btn ghost" data-act="resume">이어서 하기</button>` : ""}
    <button class="btn primary" data-act="go" data-screen="setup">새 판 시작</button>
  </div>
  ${has ? `<p class="hint" style="text-align:center;margin-top:22px">새 판을 시작하면 지금 판은 사라집니다</p>` : ""}
  <div class="foot" style="justify-content:center;margin-top:8px">
    <button data-act="go" data-screen="menu">더보기 ⋯</button>
  </div>`;
}

// ── 화면: 세팅 ──────────────────────────────────────────────────────
// 세팅 값은 아직 판이 아니므로 store 에 넣지 않는다. 이름 입력이 재렌더를 유발하지 않아
// 커서가 튀는 문제도 여기서는 생기지 않는다.
let setup = null;
function initSetup() {
  const prev = st().players;
  setup = {
    count: prev.length || 3,
    names: Array.from({ length: MAX_PLAYERS }, (_, i) => prev[i]?.name ?? ""),
    emoji: Array.from({ length: MAX_PLAYERS }, (_, i) => prev[i]?.emoji ?? EMOJI_POOL[i]),
    game: st().game,
    pv: { ...st().pointValue },
  };
}

function setupScreen() {
  if (!setup) initSetup();
  const pv = setup.pv[setup.game];
  const presets = setup.game === "hoola" ? [10, 50, 100] : [100, 500, 1000];
  return `${updateBanner()}${warnBanner()}
  <div class="bar"><h1>새 판</h1><span class="meta">${setup.count}명</span></div>

  <div class="sect">
    <p class="label">몇 명이서</p>
    <div class="grid4">${[2, 3, 4, 5].map((n) =>
      chip(String(n), setup.count === n, "count", { n }, "num")).join("")}</div>
  </div>

  <div class="sect stack mt">
    <p class="label">누가 치나요<span class="hint">아바타를 눌러 바꿔요</span></p>
    ${Array.from({ length: setup.count }, (_, i) => `
      <div class="field">
        <button class="av" data-act="emoji" data-i="${i}" style="background:${PLAYER_COLORS[i]}22"
          aria-label="${i + 1}번 아바타 바꾸기">${esc(setup.emoji[i])}</button>
        <input data-act="name" data-i="${i}" data-focus="name-${i}" value="${esc(setup.names[i])}"
          placeholder="${i + 1}번" maxlength="8" aria-label="${i + 1}번 이름">
      </div>`).join("")}
  </div>

  <div class="sect mt">
    <p class="label">무슨 게임</p>
    <div class="seg">${Object.entries(GAMES).map(([k, v]) =>
      `<button data-act="game" data-game="${k}" aria-pressed="${setup.game === k}">${v}</button>`).join("")}</div>
  </div>

  <div class="sect mt">
    <p class="label">점당 금액</p>
    <div class="grid4">
      ${presets.map((v) => chip(comma(v), pv === v, "pv", { v }, "num")).join("")}
      ${chip("직접", !presets.includes(pv), "pv-custom")}
    </div>
    <p class="hint" style="margin:10px 2px 0">${setup.game === "hoola"
      ? `남은 점수 23점이면 ${comma(23 * pv)}원을 냅니다`
      : `7점 한 판이면 진 사람마다 ${comma(7 * pv)}원씩 받습니다`}</p>
  </div>

  <div class="divider"></div>
  <div class="sect">
    <button class="btn ghost" data-act="go" data-screen="rules"
      style="justify-content:space-between;padding:0 16px">
      <span>우리 룰 설정</span><span class="hint">기본값으로 시작 ›</span>
    </button>
  </div>

  <div class="sect" style="margin-top:28px">
    <button class="btn primary" data-act="start">시작</button>
  </div>
  <div class="foot"><button data-act="go" data-screen="home">‹ 홈</button><span></span></div>`;
}

// ── 화면: 입력 ──────────────────────────────────────────────────────
function playScreen() {
  const d = draft();
  const bals = store.balances();
  const sit = new Set(d.sitout ?? []);
  const deltas = previewDeltas();
  const game = st().game;

  return `${updateBanner()}${warnBanner()}
  <div class="bar">
    <h1>${st().rounds.length + 1}판째</h1>
    <span class="bar-r">
      <button class="meta" data-act="switch" style="min-height:44px"
        aria-label="게임 바꾸기. 지금은 ${gameName(game)}">
        ${gameName(game)} ▾ · ${N()}명 · 점당 ${comma(st().pointValue[game])}원
      </button>
      ${moreBtn}
    </span>
  </div>

  <div class="sect stack">
    ${st().players.map((p, i) => balanceRow(p, bals[i], i, bals, sit.has(p.id))).join("")}
  </div>

  <div class="sect mt">
    <p class="label">${game === "poker" ? "누가 땄어?" : "누가 났어?"}</p>
    ${whoButtons(d.winner)}
  </div>

  ${game === "gostop" ? gostopInput(d) : game === "hoola" ? hoolaInput(d) : pokerInput(d)}

  <div class="sect mt" id="preview">${previewBlock()}</div>

  <div class="foot">
    <button data-act="undo" ${st().rounds.length ? "" : "disabled"}>↩ 실행취소</button>
    <button data-act="go" data-screen="history">판 기록</button>
    <button data-act="go" data-screen="result">정산 ›</button>
  </div>`;
}

/** 입력 화면에서 유일하게 부분 갱신되는 조각 (patchTyping) */
function previewBlock() {
  const d = draft();
  const deltas = previewDeltas();
  return `${deltas
      ? receipt(deltas, "이번 판", summaryOf(d))
      : `<div class="rc"><div class="rc-b" style="padding:20px 16px">
           <p class="hint" style="margin:0;text-align:center">${esc(missingHint(d))}</p>
         </div></div>`}
    <button class="btn primary" data-act="confirm" ${deltas ? "" : "disabled"}
      style="margin-top:12px">확인</button>`;
}

function refreshPreview() {
  const el = document.getElementById("preview");
  if (el) el.innerHTML = previewBlock();
}

function missingHint(d) {
  if (d.winner === null) return st().game === "poker" ? "딴 사람을 골라 주세요" : "난 사람을 골라 주세요";
  if (st().game === "gostop") return "점수를 눌러 주세요";
  if (st().game === "poker") return "딴 금액을 넣어 주세요";
  return "";
}

function summaryOf(d) {
  const name = (id) => st().players[id]?.name ?? "";
  if (st().game === "gostop") {
    const bits = [`${d.score}점`];
    if (d.go) bits.push(`${d.go}고`);
    if (d.shake) bits.push(`흔들기 ${d.shake}회`);
    if (d.gobak !== null) bits.push(`${name(d.gobak)} 고박`);
    for (const [id, f] of Object.entries(d.losers)) {
      const tags = ["pibak", "gwangbak", "meongbak"].filter((k) => f[k]);
      if (tags.length) bits.push(`${name(id)} ${tags.map((t) => ({ pibak: "피박", gwangbak: "광박", meongbak: "멍박" }[t])).join("·")}`);
    }
    if (d.sitout?.length) bits.push(`${d.sitout.map(name).join("·")} 빠짐`);
    return bits.join(" · ");
  }
  if (st().game === "poker") return "진 사람들이 나눠서 부담";
  const bits = [];
  for (const [id, f] of Object.entries(d.losers)) {
    const tags = [f.dokbak && "독박", f.stopbak && "스톱박"].filter(Boolean);
    if (tags.length) bits.push(`${name(id)} ${tags.join("·")}`);
  }
  const bonus = [d.winnerBonus.hoola && "훌라", d.winnerBonus.sevenPoker && "7포카드", d.winnerBonus.ppang && "대빵/소빵"].filter(Boolean);
  if (bonus.length) bits.push(bonus.join("·"));
  return bits.join(" · ") || "남은 점수만큼";
}

function gostopInput(d) {
  const r = st().rules.gostop;
  const others = st().players.filter((p) => p.id !== d.winner);
  const sit = new Set(d.sitout ?? []);
  const BAK = [["pibak", "피박", r.pibak], ["gwangbak", "광박", r.gwangbak], ["meongbak", "멍박", r.meongbak]];

  return `
  <div class="sect mt">
    <p class="label">몇 점?
      <span class="num" style="font-size:30px;font-weight:600;line-height:1;color:${
        d.score ? "var(--accent)" : "var(--border)"}">${d.score}</span>
    </p>
    <div class="pad">
      ${[1,2,3,4,5,6,7,8,9].map((k) => `<button class="key" data-act="digit" data-d="${k}">${k}</button>`).join("")}
      <button class="key" data-act="back" aria-label="한 자리 지우기">←</button>
      <button class="key" data-act="digit" data-d="0">0</button>
      <button class="key" data-act="clear" style="color:var(--win)" aria-label="점수 지우기">✓</button>
    </div>
  </div>

  ${d.winner === null ? "" : `<div class="sect mt">
    <p class="label">그 밖에
      <span class="hint">해당될 때만 ·
        <button data-act="go" data-screen="rules" class="linkbtn">우리 룰 ›</button></span>
    </p>
    <div class="stack" style="gap:9px">
      <div class="row">
        <span class="hint" style="width:56px;flex:none">${esc(st().players[d.winner].emoji)} ${esc(st().players[d.winner].name)}</span>
        <div class="row wrap" style="gap:6px">
          ${[1,2,3,4,5].map((g) => chip(`${g}고`, d.go === g, "gocount", { g })).join("")}
          ${chip(`흔들기${d.shake ? ` ${d.shake}` : ""}`, d.shake > 0, "shake")}
        </div>
      </div>
      ${others.map((p) => `<div class="row">
        <span class="hint" style="width:56px;flex:none">${esc(p.emoji)} ${esc(p.name)}</span>
        <div class="row wrap" style="gap:6px">
          ${BAK.map(([k, label, mul]) => mul > 1
            ? chip(label, d.losers[p.id]?.[k], "bak", { who: p.id, key: k }, "", sit.has(p.id))
            : chip(`${label} 꺼짐`, false, "noop", {}, "off", true)).join("")}
          ${r.gobak ? chip("고박", d.gobak === p.id, "gobak", { who: p.id }, "dashed", sit.has(p.id)) : ""}
          ${N() > 3 ? chip("빠짐", sit.has(p.id), "sitout", { who: p.id }) : ""}
        </div>
      </div>`).join("")}
    </div>
  </div>`}`;
}

function hoolaInput(d) {
  const r = st().rules.hoola;
  const others = st().players.filter((p) => p.id !== d.winner);
  if (d.winner === null) return "";
  return `
  <div class="sect mt">
    <p class="label">손에 남은 점수<span class="hint">A=1 · J·Q·K=11·12·13</span></p>
    <div class="stack" style="gap:12px">
      ${others.map((p) => `<div>
        <div class="field">
          ${avatar(p)}<span class="nm">${esc(p.name)}</span>
          <input type="text" inputmode="numeric" data-act="score" data-who="${p.id}"
            data-focus="score-${p.id}" value="${d.losers[p.id]?.score ?? ""}" placeholder="0"
            maxlength="3" aria-label="${esc(p.name)} 남은 점수">
        </div>
        <div class="row" style="gap:6px;margin-top:8px;padding-left:2px">
          ${chip("독박", d.losers[p.id]?.dokbak, "bak", { who: p.id, key: "dokbak" })}
          ${chip("스톱박", d.losers[p.id]?.stopbak, "bak", { who: p.id, key: "stopbak" })}
        </div>
      </div>`).join("")}
    </div>
  </div>
  <div class="sect mt">
    <p class="label">${esc(st().players[d.winner].name)} 보너스
      <button data-act="go" data-screen="rules" class="linkbtn">우리 룰 ›</button>
    </p>
    <div class="row wrap" style="gap:6px">
      ${chip(`훌라 ×${r.hoolaBonus}`, d.winnerBonus.hoola, "bonus", { key: "hoola" })}
      ${r.sevenPoker > 1
        ? chip(`7포카드 ×${r.sevenPoker}`, d.winnerBonus.sevenPoker, "bonus", { key: "sevenPoker" })
        : chip("7포카드 · 꺼짐", false, "noop", {}, "off")}
      ${chip(`대빵/소빵 ×${r.ppangBonus}`, d.winnerBonus.ppang, "bonus", { key: "ppang" })}
    </div>
  </div>`;
}

function pokerInput(d) {
  return `
  <div class="sect mt">
    <p class="label">얼마 땄어?</p>
    <div class="field" style="height:64px">
      <input type="text" inputmode="numeric" data-act="amount" data-focus="amount"
        value="${d.amount ? comma(d.amount) : ""}" placeholder="0" maxlength="11"
        aria-label="딴 금액" style="font-size:28px">
      <span class="hint" style="font-size:15px">원</span>
    </div>
    <div class="row wrap" style="gap:6px;margin-top:10px">
      ${[1000, 5000, 10000].map((v) => chip(`+${comma(v)}`, false, "add", { v }, "num")).join("")}
      ${chip("지우기", false, "clear")}
    </div>
  </div>`;
}

// ── 화면: 정산 ──────────────────────────────────────────────────────
function resultScreen() {
  const bals = store.balances();
  const moves = settle(bals);
  const min = Math.min(...bals);
  const total = moves.reduce((a, m) => a + m.amount, 0);
  const stats = statsOf();

  return `${updateBanner()}${warnBanner()}
  <div style="padding:26px 20px 0;text-align:center">
    <p class="meta" style="margin:0">${dayLabel()} · ${playedLabel()} ${st().rounds.length}판</p>
    <h1 style="font-family:var(--fd);font-weight:700;font-size:26px;letter-spacing:.06em;margin:10px 0 0">오늘의 결과</h1>
  </div>

  <div class="sect stack mt">
    ${st().players.map((p, i) => balanceRow(p, bals[i], i, bals)).join("")}
    ${min < 0 ? `<p class="crown" style="text-align:right;margin:2px 4px 0">👑 오늘의 호구 · ${
      esc(st().players.filter((_, i) => bals[i] === min).map((p) => p.name).join(" · "))}</p>` : ""}
  </div>

  <div class="sect mt">
    <p class="label">이렇게 보내면 끝</p>
    ${moves.length === 0
      ? `<div class="rc"><div class="rc-b" style="padding:22px 16px">
           <p class="hint" style="margin:0;text-align:center">주고받을 게 없습니다. 정확히 본전이에요</p></div></div>`
      : `<div class="rc">
        <div class="rc-h"><span class="meta">송금 ${moves.length}건</span><span class="meta">합 ${comma(total)}원</span></div>
        <div class="tearwrap"><span class="tear"></span></div>
        <div class="rc-b" style="gap:14px">${moves.map((m) => `
          <div class="rc-l">
            <span class="nm">${esc(st().players[m.from].emoji)} ${esc(st().players[m.from].name)}
              <span class="hint">→</span>
              ${esc(st().players[m.to].emoji)} ${esc(st().players[m.to].name)}</span>
            <span class="amt" style="color:var(--accent)">${comma(m.amount)}</span>
          </div>`).join("")}</div>
      </div>`}
  </div>

  ${st().rounds.length ? `<div class="sect mt">
    <p class="label">누적 그래프<span class="hint">${st().rounds.length}판</span></p>
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:14px 12px">
      ${chartSvg(st().rounds, st().players)}
      <div class="row wrap" style="gap:14px;margin-top:10px;padding-left:2px">
        ${st().players.map((p) => `<span class="hint"><b style="color:${p.color}">━</b> ${esc(p.name)}</span>`).join("")}
      </div>
    </div>
  </div>

  <div class="sect mt">
    <p class="label">오늘의 기록</p>
    <div class="stack" style="gap:9px">
      ${stats.map((s) => `<div class="bal" style="justify-content:space-between">
        <span class="hint">${esc(s.label)}</span><span style="font-size:14px;font-weight:600">${s.value}</span>
      </div>`).join("")}
    </div>
  </div>` : ""}

  <div class="sect stack mt" style="gap:10px">
    <button class="btn primary" data-act="share">텍스트로 공유</button>
    <button class="btn ghost" data-act="go" data-screen="play">계속 치기</button>
  </div>
  <div class="foot">
    <button data-act="go" data-screen="home">‹ 홈</button>
    <button data-act="go" data-screen="menu">더보기 ⋯</button>
  </div>`;
}

function statsOf() {
  const rounds = st().rounds;
  const out = [];
  const name = (i) => esc(st().players[i]?.name ?? "");

  let bestV = 0, bestI = -1;
  for (const r of rounds) r.deltas.forEach((v, i) => { if (v > bestV) { bestV = v; bestI = i; } });
  if (bestI >= 0) out.push({ label: "최고 한 판", value: `${name(bestI)} <span class="num">${comma(bestV)}</span>원` });

  const wins = new Array(N()).fill(0);
  let counted = 0;
  for (const r of rounds) if (Number.isInteger(r.winner)) { wins[r.winner]++; counted++; }
  if (counted) {
    const best = Math.max(...wins);
    const tied = wins.map((v, i) => (v === best ? i : -1)).filter((i) => i >= 0);
    out.push({
      label: "승률",
      value: `${tied.slice(0, 2).map(name).join(" · ")}${tied.length > 2 ? " 외" : ""}
        <span class="num">${Math.round((best / counted) * 100)}</span>%`,
    });
  }

  const baks = new Array(N()).fill(0);
  for (const r of rounds) {
    for (const [id, f] of Object.entries(r.losers ?? {})) {
      if (f.pibak || f.gwangbak || f.meongbak || f.dokbak || f.stopbak) baks[Number(id)]++;
    }
  }
  const most = Math.max(...baks);
  if (most > 0) {
    const tied = baks.map((v, i) => (v === most ? i : -1)).filter((i) => i >= 0);
    out.push({
      label: "배수 최다",
      value: `${tied.slice(0, 2).map(name).join(" · ")}${tied.length > 2 ? " 외" : ""}
        <span class="num">${most}</span>회 💀`,
    });
  }
  return out;
}

function shareText() {
  const bals = store.balances();
  const moves = settle(bals);
  const d = new Date(st().startedAt);
  const pad = (v) => String(v).padStart(comma(Math.max(...bals.map((b) => Math.abs(b)))).length + 1, " ");
  const head = `🎴🪙 판돈정산 · ${d.getMonth() + 1}/${d.getDate()} · ${playedLabel()} ${st().rounds.length}판`;
  const people = st().players.map((p, i) => `${moodOf(bals, i)} ${p.name}  ${pad(won(bals[i]))}`).join("\n");
  const money = moves.length
    ? "\n\n💸 정산\n" + moves.map((m) =>
        `${st().players[m.from].name} → ${st().players[m.to].name}  ${comma(m.amount)}원`).join("\n")
    : "\n\n💸 주고받을 게 없습니다";
  return `${head}\n\n${people}${money}`;
}

// ── 화면: 판 기록 ───────────────────────────────────────────────────
function historyScreen() {
  const rounds = st().rounds;
  return `${updateBanner()}${warnBanner()}
  <div class="bar"><h1>판 기록</h1>
    <span class="bar-r"><span class="meta">${rounds.length}판</span>${moreBtn}</span></div>
  ${rounds.length === 0 ? `<div class="sect"><div class="empty">
      <div class="big" aria-hidden="true">🎴</div>
      <h2>아직 한 판도 안 쳤어요</h2>
      <p>첫 판이 끝나면 여기에 쌓입니다</p>
      <button class="btn ghost" style="margin-top:16px" data-act="go" data-screen="play">치러 가기</button>
    </div></div>` : `
  <div class="sect">
    <div class="row wrap" style="gap:12px;padding:0 14px 10px">
      ${st().players.map((p) => `<span class="hint" style="color:${p.color}">${esc(p.emoji)} ${esc(p.name)}</span>`).join("")}
    </div>
    <div class="stack">
      ${rounds.map((r, i) => `<div class="bal" style="display:block">
        <div style="display:flex;align-items:baseline;justify-content:space-between">
          <span style="font-size:14px;font-weight:600">${i + 1}판
            <span class="hint" style="font-weight:400">${gameName(r.game)}</span></span>
          <span class="meta">${esc(roundNote(r))}</span>
        </div>
        <div class="row wrap" style="gap:14px;margin-top:9px">
          ${r.deltas.map((v) => `<span class="amt ${cls(v)}" style="font-size:14px">${won(v)}</span>`).join("")}
        </div>
      </div>`).join("")}
    </div>
  </div>
  <div class="sect mt">
    <button class="btn ghost" data-act="undo">마지막 판 취소</button>
    <p class="hint" style="text-align:center;margin:12px 0 0">한 번에 한 판씩, 최근 판부터 지웁니다</p>
  </div>`}
  <div class="foot"><button data-act="go" data-screen="play">‹ 돌아가기</button><span></span></div>`;
}

function roundNote(r) {
  if (r.game === "gostop") {
    const bits = [`${r.score}점`];
    if (r.go) bits.push(`${r.go}고`);
    if (r.gobak !== null && r.gobak !== undefined) bits.push("고박");
    return bits.join(" · ");
  }
  if (r.game === "poker") return `${comma(r.amount ?? 0)}원`;
  const total = Object.values(r.losers ?? {}).reduce((a, f) => a + (f.score ?? 0), 0);
  return `남은 점수 ${total}`;
}

// ── 화면: 룰 ────────────────────────────────────────────────────────
const toggle = (on, act, data) => {
  const attrs = Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(" ");
  return `<button class="toggle" data-act="${act}" ${attrs} aria-pressed="${!!on}"><span></span></button>`;
};
const stepper = (v, act, data, unit = "×") => {
  const attrs = Object.entries(data).map(([k, x]) => `data-${k}="${esc(x)}"`).join(" ");
  return `<span class="stepper">
    <button data-act="${act}" ${attrs} data-step="-1" aria-label="줄이기">−</button>
    <span class="v num">${v > 1 ? unit + v : "안 씀"}</span>
    <button data-act="${act}" ${attrs} data-step="1" aria-label="늘리기">+</button>
  </span>`;
};
const ruleRow = (name, hint, control) => `<div class="bal rule">
  <span class="rule-t"><span style="display:block;font-size:15px;font-weight:600">${esc(name)}</span>
    <span class="hint" style="display:block;margin-top:3px">${esc(hint)}</span></span>${control}</div>`;

function rulesScreen() {
  const g = st().rules.gostop, h = st().rules.hoola, p = st().rules.poker;
  return `${updateBanner()}${warnBanner()}
  <div class="bar"><h1>우리 룰</h1>
    <span class="bar-r"><span class="meta">모임마다 다르니까</span>${moreBtn}</span></div>
  <div class="sect"><p class="hint" style="margin:0 0 18px;line-height:1.6">여기서 바꾼 값은
    <b style="color:var(--text)">다음 판부터</b> 적용됩니다. 이미 끝난 판의 금액은 그대로예요.</p></div>

  ${store.hasGame() ? `<div class="sect">
    <button class="btn ghost" data-act="go" data-screen="menu"
      style="justify-content:space-between;padding:0 16px">
      <span>판돈 바꾸기</span>
      <span class="hint">점당 ${comma(st().pointValue[st().game])}원 ›</span>
    </button>
  </div>` : ""}

  <div class="sect mt">
    <p class="label">🎴 고스톱</p>
    <div class="stack">
      ${ruleRow("피박", "승자가 피로 났고 그 사람 피가 5장 이하", stepper(g.pibak, "rule-step", { game: "gostop", key: "pibak" }))}
      ${ruleRow("광박", "승자가 광으로 났고 그 사람이 광이 없음", stepper(g.gwangbak, "rule-step", { game: "gostop", key: "gwangbak" }))}
      ${ruleRow("멍박", "승자 열끗 7장 이상, 그 사람은 열끗 없음", stepper(g.meongbak, "rule-step", { game: "gostop", key: "meongbak" }))}
      ${ruleRow("3고부터 2배", "끄면 고는 점수만 1점씩 더합니다", toggle(g.goDouble, "rule-toggle", { game: "gostop", key: "goDouble" }))}
      ${ruleRow("흔들기", "1회당 곱하는 배수", stepper(g.shake, "rule-step", { game: "gostop", key: "shake" }))}
      ${ruleRow("고박", "고 부르고 지면 혼자 뒤집어씀", toggle(g.gobak, "rule-toggle", { game: "gostop", key: "gobak" }))}
      ${ruleRow("점수 상한", "개인 배수를 곱하기 전에 걸립니다",
        `<span class="row" style="gap:6px">${[null, 10, 20].map((v) =>
          chip(v === null ? "없음" : `${v}점`, g.scoreCap === v, "cap", { v: v === null ? "" : v })).join("")}</span>`)}
    </div>
  </div>

  <div class="sect mt">
    <p class="label">🃏 훌라</p>
    <div class="stack">
      ${ruleRow("독박", "한 장도 못 내려놓고 끝남", stepper(h.dokbak, "rule-step", { game: "hoola", key: "dokbak" }))}
      ${ruleRow("독박 점수 계산", "남은 점수 그대로 · 고정 30점",
        `<span class="row" style="gap:6px">
          ${chip("그대로", h.dokbakMode === "multiply", "dokmode", { v: "multiply" })}
          ${chip("30점", h.dokbakMode === "fixed", "dokmode", { v: "fixed" })}</span>`)}
      ${ruleRow("훌라", "한 번에 다 내려놓고 남", stepper(h.hoolaBonus, "rule-step", { game: "hoola", key: "hoolaBonus" }))}
      ${ruleRow("7포카드", "숫자 7 카드 넉 장", stepper(h.sevenPoker, "rule-step", { game: "hoola", key: "sevenPoker" }))}
      ${ruleRow("스톱박", "스톱 불렀는데 더 낮은 사람이 있음", stepper(h.stopbak, "rule-step", { game: "hoola", key: "stopbak" }))}
      ${ruleRow("대빵/소빵", "등록 없이 83점 이상 · 15점 이하", stepper(h.ppangBonus, "rule-step", { game: "hoola", key: "ppangBonus" }))}
    </div>
  </div>

  <div class="sect mt">
    <p class="label">♠️ 포커</p>
    <div class="stack">
      ${ruleRow("나눠떨어지지 않으면", "남는 1원을 누가 부담할지",
        `<span class="row" style="gap:6px">
          ${chip("딴 사람", p.oddTo === "winner", "oddto", { v: "winner" })}
          ${chip("잃은 사람", p.oddTo === "loser", "oddto", { v: "loser" })}</span>`)}
    </div>
  </div>

  <div class="sect mt"><button class="btn ghost" data-act="rule-reset">기본값으로 되돌리기</button></div>
  <div class="foot"><button data-act="rule-back">‹ 돌아가기</button><span></span></div>`;
}

// ── 화면: 더보기 ────────────────────────────────────────────────────
function menuScreen() {
  const game = st().game;
  const pv = st().pointValue[game];
  const playing = store.hasGame();

  return `${updateBanner()}${warnBanner()}
  <div class="bar"><h1>더보기</h1>
    <span class="meta">${st().rounds.length ? `${st().rounds.length}판 진행중` : ""}</span></div>

  ${playing ? `<div class="sect">
    <p class="label">판돈<span class="hint">${gameName(game)} 점당 · 다음 판부터</span></p>
    <div class="grid4">
      ${presetsFor(game).map((v) => chip(comma(v), pv === v, "pv-set", { v }, "num")).join("")}
      ${chip("직접", !presetsFor(game).includes(pv), "pv-ask")}
    </div>
    <p class="hint" style="margin:10px 2px 0">${game === "hoola"
      ? `남은 점수 23점이면 ${comma(23 * pv)}원을 냅니다`
      : `7점 한 판이면 진 사람마다 ${comma(7 * pv)}원씩 받습니다`} ·
      이미 끝난 판의 금액은 그대로예요</p>
  </div>` : ""}

  <div class="sect mt">
    <div class="menu">
      <button data-act="go" data-screen="rules">우리 룰 설정<span class="sub">피박·독박 배수 ›</span></button>
      ${playing ? `<button data-act="go" data-screen="history">판 기록<span class="sub">${st().rounds.length}판 ›</span></button>` : ""}
      <button data-act="reload">앱 새로고침<span class="sub">최신 버전 받기</span></button>
      ${playing ? `<button data-act="go" data-screen="home">홈으로<span class="sub">판은 그대로 ›</span></button>` : ""}
    </div>
  </div>

  <div class="sect mt">
    <p class="hint" style="text-align:center;line-height:1.7">
      화면을 아래로 당겨도 새로고침됩니다.<br>
      새로고침해도 <b style="color:var(--text)">지금 판은 지워지지 않습니다.</b></p>
  </div>

  <div class="foot"><button data-act="menu-back">‹ 돌아가기</button><span></span></div>`;
}

// ── 렌더 ────────────────────────────────────────────────────────────
const SCREENS = { home: homeScreen, setup: setupScreen, play: playScreen,
  result: resultScreen, history: historyScreen, rules: rulesScreen, menu: menuScreen };
let prevBalances = [];

function captureFocus() {
  const el = document.activeElement;
  if (!el?.dataset?.focus) return null;
  let start = null, end = null;
  try { start = el.selectionStart; end = el.selectionEnd; } catch { /* number 입력 등 */ }
  return { key: el.dataset.focus, start, end };
}

function restoreFocus(f) {
  if (!f) return;
  const el = app.querySelector(`[data-focus="${f.key}"]`);
  if (!el) return;
  el.focus({ preventScroll: true });
  if (f.start !== null) { try { el.setSelectionRange(f.start, f.end); } catch { /* 무시 */ } }
}

function render() {
  const focus = captureFocus();
  app.innerHTML = (SCREENS[st().screen] ?? homeScreen)();
  restoreFocus(focus);

  // 잔액 숫자만 예외 — 통째로 다시 그려도 바뀐 줄에만 롤링을 붙인다
  const now = store.hasGame() ? store.balances() : [];
  app.querySelectorAll("[data-bal]").forEach((el) => {
    const i = Number(el.dataset.bal);
    if (prevBalances[i] !== undefined && prevBalances[i] !== now[i]) el.classList.add("roll");
  });
  prevBalances = now;
}

let toastTimer = null;
function toast(msg) {
  document.querySelector(".toast")?.remove();
  const el = document.createElement("div");
  el.className = "toast";
  el.setAttribute("role", "status");
  el.innerHTML = msg;
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 1500);
}

// ── 이벤트 — 컨테이너 하나에 위임한다 ────────────────────────────────
const digitsOf = (s) => Number(String(s).replace(/[^0-9]/g, "")) || 0;

app.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el || el.disabled) return;
  const { act } = el.dataset;
  const d = draft();

  switch (act) {
    case "noop": return;
    case "go": return store.setScreen(el.dataset.screen);
    case "resume": return store.setScreen("play");

    // 세팅
    case "count": setup.count = Number(el.dataset.n); return render();
    case "emoji": {
      const i = Number(el.dataset.i);
      const cur = EMOJI_POOL.indexOf(setup.emoji[i]);
      setup.emoji[i] = EMOJI_POOL[(cur + 1) % EMOJI_POOL.length];
      return render();
    }
    case "game": setup.game = el.dataset.game; return render();
    case "pv": setup.pv[setup.game] = Number(el.dataset.v); return render();
    case "pv-custom": {
      const v = prompt("점당 얼마로 할까요? (원)", String(setup.pv[setup.game]));
      if (v !== null && digitsOf(v) > 0) setup.pv[setup.game] = digitsOf(v);
      return render();
    }
    case "start": {
      store.newGame({
        names: setup.names.slice(0, setup.count),
        emoji: setup.emoji.slice(0, setup.count),
        game: setup.game,
        pointValue: setup.pv,
      });
      setup = null;
      return;
    }

    // 입력
    case "pick": {
      const id = Number(el.dataset.id);
      const next = { winner: d.winner === id ? null : id };
      // 승자는 빠진 사람일 수 없다 — 고르면 자동으로 자리에 앉힌다
      if (d.sitout?.includes(id)) next.sitout = d.sitout.filter((x) => x !== id);
      if (d.gobak === id) next.gobak = null;
      return patch(next);
    }
    case "digit": {
      const next = d.score * 10 + Number(el.dataset.d);
      return patch({ score: next > 99 ? d.score : next });
    }
    case "back": return patch({ score: Math.floor(d.score / 10) });
    case "clear": return patch(st().game === "poker" ? { amount: 0 } : { score: 0 });
    case "gocount": {
      const g = Number(el.dataset.g);
      return patch({ go: d.go === g ? 0 : g });
    }
    case "shake": return patch({ shake: d.shake > 0 ? 0 : 1 });
    case "bak": {
      const who = el.dataset.who, key = el.dataset.key;
      const cur = d.losers[who] ?? {};
      return patch({ losers: { ...d.losers, [who]: { ...cur, [key]: !cur[key] } } });
    }
    case "gobak": {
      const who = Number(el.dataset.who);
      return patch({ gobak: d.gobak === who ? null : who });
    }
    case "sitout": {
      const who = Number(el.dataset.who);
      const on = d.sitout.includes(who);
      const next = { sitout: on ? d.sitout.filter((x) => x !== who) : [...d.sitout, who] };
      if (!on && d.gobak === who) next.gobak = null;
      return patch(next);
    }
    case "bonus": {
      const key = el.dataset.key;
      return patch({ winnerBonus: { ...d.winnerBonus, [key]: !d.winnerBonus[key] } });
    }
    case "add": return patch({ amount: d.amount + Number(el.dataset.v) });

    case "confirm": {
      const deltas = previewDeltas();
      if (!deltas) return;
      store.addRound({ ...toRound(d), deltas });
      const note = summaryOf(d);
      const winner = st().players[d.winner];
      const gain = deltas[d.winner];
      toast(`${esc(winner.name)} <b class="num" style="color:var(--win)">${won(gain)}</b>${
        note ? ` <span style="color:var(--text-dim)">${esc(note)}</span>` : ""}`);
      return;
    }
    case "undo": {
      if (!st().rounds.length) return;
      store.undo();
      return toast("마지막 판을 취소했습니다");
    }

    // 룰
    case "rule-toggle":
      return store.setRule(el.dataset.game, el.dataset.key, !st().rules[el.dataset.game][el.dataset.key]);
    case "rule-step": {
      const { game, key } = el.dataset;
      const step = Number(el.dataset.step);
      const cur = st().rules[game][key];
      const next = Math.min(Math.max((cur <= 1 ? 1 : cur) + step, 1), 9);
      return store.setRule(game, key, next);
    }
    case "cap": {
      const v = el.dataset.v === "" ? null : Number(el.dataset.v);
      return store.setRule("gostop", "scoreCap", v);
    }
    case "pv-set": return store.setPointValue(st().game, Number(el.dataset.v));
    case "pv-ask": {
      const v = prompt("점당 얼마로 할까요? (원)", String(st().pointValue[st().game]));
      if (v !== null && digitsOf(v) > 0) store.setPointValue(st().game, digitsOf(v));
      return;
    }
    case "menu-back": return store.setScreen(store.hasGame() ? "play" : "home");
    case "reload": return hardReload();
    case "dokmode": return store.setRule("hoola", "dokbakMode", el.dataset.v);
    case "oddto": return store.setRule("poker", "oddTo", el.dataset.v);
    case "rule-reset": {
      if (!confirm("룰을 전부 기본값으로 되돌릴까요? 이미 끝난 판의 금액은 그대로입니다.")) return;
      store.resetRules();
      return toast("룰을 기본값으로 되돌렸습니다");
    }
    case "rule-back": return store.setScreen(store.hasGame() ? "play" : "setup");

    // 고스톱 치다가 훌라로 넘어가는 일이 실제로 있다 (SPEC 12장 3번)
    case "switch": {
      const order = Object.keys(GAMES);
      const next = order[(order.indexOf(st().game) + 1) % order.length];
      const dirty = d.winner !== null || d.score > 0 || d.amount > 0
        || Object.keys(d.losers ?? {}).length > 0;
      if (dirty && !confirm(`입력 중인 내용을 지우고 ${GAMES[next]}(으)로 바꿀까요?`)) return;
      store.setGame(next);
      return toast(`${GAMES[next]} · 점당 ${comma(st().pointValue[next])}원`);
    }

    case "share": return share();
  }

});

app.addEventListener("input", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const d = draft();
  if (el.dataset.act === "name") { setup.names[Number(el.dataset.i)] = el.value; return; }
  if (el.dataset.act === "score") {
    const who = el.dataset.who;
    const cur = d.losers[who] ?? {};
    return patchTyping({ losers: { ...d.losers, [who]: { ...cur, score: digitsOf(el.value) } } });
  }
  if (el.dataset.act === "amount") return patchTyping({ amount: digitsOf(el.value) });
});

/**
 * 홈 화면에 추가하면 주소창이 없어 새로고침할 방법이 사라진다.
 * 캐시를 비우고 다시 받되 localStorage 는 건드리지 않는다 — 판 기록이 날아가면 안 된다.
 * 오프라인일 때 캐시를 지우면 앱이 아예 안 뜨므로 그때는 다시 읽기만 한다.
 */
async function hardReload() {
  try {
    if (navigator.onLine) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
      await Promise.all(regs.map((r) => r.update()));
    }
  } catch {
    // 캐시를 못 지워도 새로고침은 한다
  }
  location.reload();
}

async function share() {
  const text = shareText();
  try {
    if (navigator.share) return await navigator.share({ text });
    await navigator.clipboard.writeText(text);
    toast("복사했습니다");
  } catch {
    toast("공유하지 못했습니다");
  }
}

store.subscribe(render);
render();

if ("serviceWorker" in navigator) {
  addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("./sw.js");
      reg.addEventListener("updatefound", () => {
        const sw = reg.installing;
        sw?.addEventListener("statechange", () => {
          // controller 가 이미 있다는 건 첫 설치가 아니라 갱신이라는 뜻이다
          if (sw.state === "installed" && navigator.serviceWorker.controller) {
            updateReady = true;
            render();
          }
        });
      });
    } catch {
      // 서비스워커가 없어도 앱은 돈다. 오프라인만 안 될 뿐이다.
    }
  });
}
