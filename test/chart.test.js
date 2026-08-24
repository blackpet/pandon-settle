import { test } from "node:test";
import assert from "node:assert/strict";
import { series, chartSvg } from "../public/src/chart.js";

const players = [
  { name: "재호", color: "#4DA3FF" },
  { name: "철수", color: "#FFB84D" },
  { name: "영희", color: "#B47DFF" },
];

test("누적 선은 0에서 시작해 판마다 한 점씩 늘어난다", () => {
  const rounds = [{ deltas: [600, -300, -300] }, { deltas: [-200, 400, -200] }];
  assert.deepEqual(series(rounds, 3), [
    [0, 600, 400],
    [0, -300, 100],
    [0, -300, -500],
  ]);
});

test("어느 시점에서든 세로로 더하면 0이다", () => {
  const rounds = [{ deltas: [1000, -500, -500] }, { deltas: [-900, 1800, -900] }];
  const lines = series(rounds, 3);
  for (let j = 0; j < lines[0].length; j++) {
    assert.equal(lines.reduce((a, l) => a + l[j], 0), 0, `${j}번째 지점`);
  }
});

test("인원이 몇이든 사람 수만큼 선이 나온다", () => {
  for (const n of [2, 3, 4, 5]) {
    const ps = Array.from({ length: n }, (_, i) => ({ name: `${i}`, color: "#fff" }));
    const svg = chartSvg([{ deltas: new Array(n).fill(0) }], ps);
    assert.equal((svg.match(/<polyline/g) ?? []).length, n);
  }
});

test("판이 하나도 없어도 그래프를 그린다", () => {
  const svg = chartSvg([], players);
  assert.match(svg, /<svg/);
  assert.equal((svg.match(/<polyline/g) ?? []).length, 3);
  assert.doesNotMatch(svg, /NaN/, "좌표에 NaN 이 새지 않는다");
});

test("전원이 계속 본전이어도 좌표가 깨지지 않는다", () => {
  // max 와 min 이 같으면 0 으로 나누게 된다
  const svg = chartSvg([{ deltas: [0, 0, 0] }, { deltas: [0, 0, 0] }], players);
  assert.doesNotMatch(svg, /NaN|Infinity/);
});

test("0선을 그린다", () => {
  assert.match(chartSvg([{ deltas: [600, -300, -300] }], players), /stroke-dasharray/);
});

test("사람 색을 그대로 쓴다", () => {
  const svg = chartSvg([{ deltas: [600, -300, -300] }], players);
  for (const p of players) assert.ok(svg.includes(p.color), `${p.color} 가 없다`);
});
