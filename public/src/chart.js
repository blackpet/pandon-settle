/**
 * chart.js — 누적 잔액 꺾은선 (인라인 SVG)
 * 차트 라이브러리를 쓰지 않는다. 사람마다 선 하나, 0선 하나가 전부다.
 */

/** rounds → 사람별 누적 잔액 배열 (0에서 시작하므로 길이는 rounds.length + 1) */
export function series(rounds, n) {
  const out = Array.from({ length: n }, () => [0]);
  const acc = new Array(n).fill(0);
  for (const r of rounds) {
    r.deltas.forEach((v, i) => (acc[i] += v));
    for (let i = 0; i < n; i++) out[i].push(acc[i]);
  }
  return out;
}

export function chartSvg(rounds, players, { w = 350, h = 120, pad = 8 } = {}) {
  const n = players.length;
  const lines = series(rounds, n);
  const all = lines.flat();
  const max = Math.max(...all, 1);
  const min = Math.min(...all, -1);
  const steps = lines[0].length - 1;

  const x = (i) => (steps === 0 ? w / 2 : pad + (i * (w - pad * 2)) / steps);
  const y = (v) => pad + ((max - v) / (max - min)) * (h - pad * 2);

  const paths = players.map((p, i) => {
    const pts = lines[i].map((v, j) => `${x(j).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    const last = lines[i][lines[i].length - 1];
    return `<polyline points="${pts}" fill="none" stroke="${p.color}" stroke-width="2"
        stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${x(steps).toFixed(1)}" cy="${y(last).toFixed(1)}" r="3" fill="${p.color}"/>`;
  }).join("");

  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img"
      aria-label="판이 진행되면서 사람마다 잔액이 어떻게 움직였는지 보여주는 꺾은선 그래프">
    <line x1="${pad}" y1="${y(0).toFixed(1)}" x2="${w - pad}" y2="${y(0).toFixed(1)}"
      stroke="#2A2D3A" stroke-width="1" stroke-dasharray="3 4"/>
    ${paths}
  </svg>`;
}
