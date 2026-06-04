// SVG diagram engine. renderDiagram({type, params}) -> SVG string.
// Pure functions; safe to inject into innerHTML (numbers/labels are escaped).

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
const C = {
  ink: "#1f2937", line: "#374151", accent: "#2563eb", fill: "#bfdbfe",
  shade: "#3b82f6", grid: "#cbd5e1", soft: "#e5e7eb", bar: "#60a5fa",
};

export function renderDiagram(d) {
  if (!d || !d.type) return "";
  const p = d.params || {};
  try {
    switch (d.type) {
      case "number_line": return numberLine(p);
      case "fraction_bar": return fractionBar(p);
      case "fraction_circle": return fractionCircle(p);
      case "array_dots": return arrayDots(p);
      case "bar_graph": return barGraph(p);
      case "picture_graph": return pictureGraph(p);
      case "clock": return clock(p);
      case "rectangle": return rectangle(p);
      case "shape": return shape(p);
      case "base_ten": return baseTen(p);
      case "data_table": return dataTable(p);
      case "image": return imageDiagram(p);
      default: return "";
    }
  } catch (e) {
    return `<div class="diagram-error">diagram error</div>`;
  }
}

const wrap = (w, h, inner) =>
  `<svg class="diagram" viewBox="0 0 ${w} ${h}" width="100%" style="max-width:${w}px" role="img" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;

// ── number line ──────────────────────────────────────────────────────────────
function numberLine(p) {
  const min = +p.min || 0, max = p.max == null ? 10 : +p.max, step = +p.step || 1;
  const W = 520, H = 110, padL = 30, padR = 30, y = 60;
  const span = max - min || 1;
  const x = (v) => padL + ((v - min) / span) * (W - padL - padR);
  let s = `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="${C.line}" stroke-width="2"/>`;
  // arrowheads
  s += `<polygon points="${padL - 6},${y} ${padL + 2},${y - 5} ${padL + 2},${y + 5}" fill="${C.line}"/>`;
  s += `<polygon points="${W - padR + 6},${y} ${W - padR - 2},${y - 5} ${W - padR - 2},${y + 5}" fill="${C.line}"/>`;
  for (let v = min; v <= max + 1e-9; v += step) {
    const xx = x(v);
    s += `<line x1="${xx}" y1="${y - 7}" x2="${xx}" y2="${y + 7}" stroke="${C.line}" stroke-width="2"/>`;
    s += `<text x="${xx}" y="${y + 26}" text-anchor="middle" font-size="14" fill="${C.ink}">${esc(fmtNum(v))}</text>`;
  }
  for (const mk of (p.marks || [])) {
    const xx = x(+mk.value);
    s += `<line x1="${xx}" y1="${y - 12}" x2="${xx}" y2="${y + 12}" stroke="${C.accent}" stroke-width="2.5"/>`;
    if (mk.label != null) s += `<text x="${xx}" y="${y - 18}" text-anchor="middle" font-size="14" font-weight="700" fill="${C.accent}">${esc(mk.label)}</text>`;
  }
  for (const iv of (p.intervals || [])) {
    const x1 = x(+iv.from), x2 = x(+iv.to), mx = (x1 + x2) / 2;
    s += `<path d="M ${x1} ${y - 14} Q ${mx} ${y - 40} ${x2} ${y - 14}" fill="none" stroke="${C.accent}" stroke-width="2"/>`;
    s += `<polygon points="${x2},${y - 14} ${x2 - 6},${y - 22} ${x2 + 4},${y - 24}" fill="${C.accent}"/>`;
    if (iv.label) s += `<text x="${mx}" y="${y - 30}" text-anchor="middle" font-size="13" fill="${C.accent}">${esc(iv.label)}</text>`;
  }
  if (p.point != null) {
    const xx = x(+p.point);
    s += `<circle cx="${xx}" cy="${y}" r="7" fill="${C.shade}" stroke="#fff" stroke-width="2"/>`;
  }
  return wrap(W, H, s);
}
function fmtNum(v) { return Math.round(v * 1000) / 1000; }

// ── fraction bar(s) ──────────────────────────────────────────────────────────
function fractionBar(p) {
  const bars = p.bars || [{ parts: p.parts, shaded: p.shaded, label: p.label }];
  const W = 420, rowH = 56, gap = 18, padT = 14;
  const H = padT * 2 + bars.length * rowH + (bars.length - 1) * gap;
  let s = "";
  bars.forEach((b, i) => {
    const parts = Math.max(1, +b.parts || 1), shaded = +b.shaded || 0;
    const y = padT + i * (rowH + gap), barW = b.label ? 320 : 380, x0 = 10;
    const cw = barW / parts;
    for (let k = 0; k < parts; k++) {
      const fill = k < shaded ? C.shade : "#fff";
      s += `<rect x="${x0 + k * cw}" y="${y}" width="${cw}" height="40" fill="${fill}" stroke="${C.line}" stroke-width="2"/>`;
    }
    if (b.label) s += `<text x="${x0 + barW + 14}" y="${y + 26}" font-size="16" font-weight="700" fill="${C.ink}">${esc(b.label)}</text>`;
  });
  return wrap(W, H, s);
}

// ── fraction circle ──────────────────────────────────────────────────────────
function fractionCircle(p) {
  const parts = Math.max(1, +p.parts || 1), shaded = +p.shaded || 0;
  const W = 180, H = 180, cx = 90, cy = 90, r = 72;
  let s = "";
  for (let k = 0; k < parts; k++) {
    const a0 = (k / parts) * 2 * Math.PI - Math.PI / 2;
    const a1 = ((k + 1) / parts) * 2 * Math.PI - Math.PI / 2;
    const x1 = cx + r * Math.cos(a0), y1 = cy + r * Math.sin(a0);
    const x2 = cx + r * Math.cos(a1), y2 = cy + r * Math.sin(a1);
    const large = (a1 - a0) > Math.PI ? 1 : 0;
    const fill = k < shaded ? C.shade : "#fff";
    if (parts === 1) {
      s += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${C.line}" stroke-width="2"/>`;
    } else {
      s += `<path d="M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z" fill="${fill}" stroke="${C.line}" stroke-width="2"/>`;
    }
  }
  return wrap(W, H, s);
}

// ── array of dots ────────────────────────────────────────────────────────────
function arrayDots(p) {
  const rows = Math.max(1, +p.rows || 1), cols = Math.max(1, +p.cols || 1);
  const cell = 30, padX = 16, padY = 16;
  const W = padX * 2 + cols * cell, H = padY * 2 + rows * cell;
  let s = "";
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      s += `<circle cx="${padX + c * cell + cell / 2}" cy="${padY + r * cell + cell / 2}" r="10" fill="${C.shade}"/>`;
  return wrap(W, H, s);
}

// ── bar graph ────────────────────────────────────────────────────────────────
function barGraph(p) {
  const bars = p.bars || [];
  const W = 460, H = 300, padL = 50, padB = 70, padT = 36, padR = 20;
  const plotH = H - padB - padT, plotW = W - padL - padR;
  const yMax = p.yMax || Math.max(1, ...bars.map((b) => +b.value)) ;
  const yStep = p.yStep || Math.max(1, Math.ceil(yMax / 5));
  let s = "";
  if (p.title) s += `<text x="${W / 2}" y="20" text-anchor="middle" font-size="15" font-weight="700" fill="${C.ink}">${esc(p.title)}</text>`;
  // y gridlines + labels
  for (let v = 0; v <= yMax + 1e-9; v += yStep) {
    const y = padT + plotH - (v / yMax) * plotH;
    s += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="${C.soft}" stroke-width="1"/>`;
    s += `<text x="${padL - 8}" y="${y + 4}" text-anchor="end" font-size="12" fill="${C.ink}">${esc(v)}</text>`;
  }
  // axes
  s += `<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="${C.line}" stroke-width="2"/>`;
  s += `<line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" stroke="${C.line}" stroke-width="2"/>`;
  const n = bars.length, slot = plotW / n, bw = Math.min(48, slot * 0.6);
  bars.forEach((b, i) => {
    const h = (+b.value / yMax) * plotH;
    const x = padL + i * slot + (slot - bw) / 2, y = padT + plotH - h;
    s += `<rect x="${x}" y="${y}" width="${bw}" height="${h}" fill="${C.bar}" stroke="${C.accent}" stroke-width="1.5"/>`;
    s += `<text x="${x + bw / 2}" y="${padT + plotH + 18}" text-anchor="middle" font-size="12" fill="${C.ink}">${esc(b.label)}</text>`;
  });
  if (p.yLabel) s += `<text x="14" y="${padT + plotH / 2}" text-anchor="middle" font-size="12" fill="${C.ink}" transform="rotate(-90 14 ${padT + plotH / 2})">${esc(p.yLabel)}</text>`;
  if (p.xLabel) s += `<text x="${padL + plotW / 2}" y="${H - 8}" text-anchor="middle" font-size="12" fill="${C.ink}">${esc(p.xLabel)}</text>`;
  return wrap(W, H, s);
}

// ── picture graph ────────────────────────────────────────────────────────────
function pictureGraph(p) {
  const rows = p.rows || [], sym = p.symbol || "⬛", unit = p.unitValue || 1;
  const W = 460, rowH = 40, padT = p.title ? 60 : 20, padL = 90;
  const H = padT + rows.length * rowH + 40;
  let s = "";
  if (p.title) s += `<text x="${W / 2}" y="22" text-anchor="middle" font-size="15" font-weight="700" fill="${C.ink}">${esc(p.title)}</text>`;
  rows.forEach((r, i) => {
    const y = padT + i * rowH;
    s += `<text x="10" y="${y + 22}" font-size="14" fill="${C.ink}">${esc(r.label)}</text>`;
    let icons = "";
    for (let k = 0; k < (+r.count || 0); k++) icons += sym;
    s += `<text x="${padL}" y="${y + 24}" font-size="22">${esc(icons)}</text>`;
  });
  s += `<text x="10" y="${H - 12}" font-size="13" fill="${C.line}">Key: ${esc(sym)} = ${esc(unit)}</text>`;
  return wrap(W, H, s);
}

// ── analog clock ─────────────────────────────────────────────────────────────
function clock(p) {
  const hour = +p.hour || 12, minute = +p.minute || 0;
  const W = 180, H = 180, cx = 90, cy = 90, r = 78;
  let s = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#fff" stroke="${C.line}" stroke-width="3"/>`;
  for (let m = 0; m < 60; m++) {
    const a = (m / 60) * 2 * Math.PI - Math.PI / 2;
    const big = m % 5 === 0;
    const r1 = big ? r - 10 : r - 5;
    s += `<line x1="${cx + r1 * Math.cos(a)}" y1="${cy + r1 * Math.sin(a)}" x2="${cx + r * Math.cos(a)}" y2="${cy + r * Math.sin(a)}" stroke="${C.line}" stroke-width="${big ? 2 : 1}"/>`;
  }
  for (let n = 1; n <= 12; n++) {
    const a = (n / 12) * 2 * Math.PI - Math.PI / 2;
    s += `<text x="${cx + (r - 22) * Math.cos(a)}" y="${cy + (r - 22) * Math.sin(a) + 5}" text-anchor="middle" font-size="15" font-weight="600" fill="${C.ink}">${n}</text>`;
  }
  const minA = (minute / 60) * 2 * Math.PI - Math.PI / 2;
  const hourA = (((hour % 12) + minute / 60) / 12) * 2 * Math.PI - Math.PI / 2;
  s += `<line x1="${cx}" y1="${cy}" x2="${cx + (r - 36) * Math.cos(hourA)}" y2="${cy + (r - 36) * Math.sin(hourA)}" stroke="${C.ink}" stroke-width="5" stroke-linecap="round"/>`;
  s += `<line x1="${cx}" y1="${cy}" x2="${cx + (r - 16) * Math.cos(minA)}" y2="${cy + (r - 16) * Math.sin(minA)}" stroke="${C.accent}" stroke-width="3.5" stroke-linecap="round"/>`;
  s += `<circle cx="${cx}" cy="${cy}" r="5" fill="${C.ink}"/>`;
  return wrap(W, H, s);
}

// ── rectangle (area / perimeter) ─────────────────────────────────────────────
function rectangle(p) {
  const w = Math.max(1, +p.width || 1), h = Math.max(1, +p.height || 1);
  const unit = p.unit || "", showGrid = !!p.showGrid;
  const maxPx = 320, cell = Math.max(18, Math.min(40, Math.floor(maxPx / Math.max(w, h))));
  const padX = 50, padY = 30;
  const W = padX * 2 + w * cell, H = padY * 2 + h * cell;
  const x0 = padX, y0 = padY;
  let s = `<rect x="${x0}" y="${y0}" width="${w * cell}" height="${h * cell}" fill="${C.fill}" fill-opacity="0.5" stroke="${C.line}" stroke-width="2.5"/>`;
  if (showGrid) {
    for (let c = 1; c < w; c++) s += `<line x1="${x0 + c * cell}" y1="${y0}" x2="${x0 + c * cell}" y2="${y0 + h * cell}" stroke="${C.grid}" stroke-width="1"/>`;
    for (let r = 1; r < h; r++) s += `<line x1="${x0}" y1="${y0 + r * cell}" x2="${x0 + w * cell}" y2="${y0 + r * cell}" stroke="${C.grid}" stroke-width="1"/>`;
  }
  s += `<text x="${x0 + w * cell / 2}" y="${y0 - 10}" text-anchor="middle" font-size="14" font-weight="600" fill="${C.ink}">${esc(w)} ${esc(unit)}</text>`;
  s += `<text x="${x0 - 12}" y="${y0 + h * cell / 2}" text-anchor="middle" font-size="14" font-weight="600" fill="${C.ink}" transform="rotate(-90 ${x0 - 12} ${y0 + h * cell / 2})">${esc(h)} ${esc(unit)}</text>`;
  if (p.label) s += `<text x="${x0 + w * cell / 2}" y="${y0 + h * cell + 22}" text-anchor="middle" font-size="13" fill="${C.line}">${esc(p.label)}</text>`;
  return wrap(W, H, s);
}

// ── geometry shape ───────────────────────────────────────────────────────────
function shape(p) {
  const kind = (p.kind || "quadrilateral").toLowerCase();
  const W = 240, H = 200, cx = 120, cy = 95;
  const presets = {
    triangle: [[120, 25], [215, 165], [25, 165]],
    square: [[55, 35], [185, 35], [185, 165], [55, 165]],
    rectangle: [[35, 50], [205, 50], [205, 150], [35, 150]],
    quadrilateral: [[40, 45], [200, 35], [185, 160], [55, 150]],
    trapezoid: [[70, 40], [170, 40], [210, 160], [30, 160]],
    rhombus: [[120, 25], [205, 95], [120, 165], [35, 95]],
    parallelogram: [[60, 45], [210, 45], [180, 160], [30, 160]],
    pentagon: poly(5, cx, cy, 78),
    hexagon: poly(6, cx, cy, 78),
  };
  const pts = p.points || presets[kind] || presets.quadrilateral;
  let s = `<polygon points="${pts.map((q) => q.join(",")).join(" ")}" fill="${C.fill}" fill-opacity="0.5" stroke="${C.line}" stroke-width="2.5"/>`;
  const labels = p.sideLabels || [];
  for (let i = 0; i < labels.length && i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    s += `<text x="${mx}" y="${my}" text-anchor="middle" font-size="13" font-weight="600" fill="${C.accent}" dy="-4">${esc(labels[i])}</text>`;
  }
  return wrap(W, H, s);
}
function poly(n, cx, cy, r) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI - Math.PI / 2;
    out.push([Math.round(cx + r * Math.cos(a)), Math.round(cy + r * Math.sin(a))]);
  }
  return out;
}

// ── base-ten blocks ──────────────────────────────────────────────────────────
function baseTen(p) {
  const hundreds = +p.hundreds || 0, tens = +p.tens || 0, ones = +p.ones || 0;
  const u = 9, gap = 16;
  let x = 12; const yTop = 14, W = 520, H = 130;
  let s = "";
  // hundreds: 10x10 grid
  for (let i = 0; i < hundreds; i++) {
    s += `<rect x="${x}" y="${yTop}" width="${u * 10}" height="${u * 10}" fill="${C.fill}" stroke="${C.accent}" stroke-width="1.5"/>`;
    for (let k = 1; k < 10; k++) {
      s += `<line x1="${x + k * u}" y1="${yTop}" x2="${x + k * u}" y2="${yTop + u * 10}" stroke="${C.accent}" stroke-width="0.5"/>`;
      s += `<line x1="${x}" y1="${yTop + k * u}" x2="${x + u * 10}" y2="${yTop + k * u}" stroke="${C.accent}" stroke-width="0.5"/>`;
    }
    x += u * 10 + gap;
  }
  // tens: 1x10 columns
  for (let i = 0; i < tens; i++) {
    s += `<rect x="${x}" y="${yTop}" width="${u}" height="${u * 10}" fill="${C.fill}" stroke="${C.accent}" stroke-width="1.5"/>`;
    for (let k = 1; k < 10; k++) s += `<line x1="${x}" y1="${yTop + k * u}" x2="${x + u}" y2="${yTop + k * u}" stroke="${C.accent}" stroke-width="0.5"/>`;
    x += u + 6;
  }
  x += gap;
  // ones: single squares
  let ox = x, oy = yTop;
  for (let i = 0; i < ones; i++) {
    s += `<rect x="${ox}" y="${oy}" width="${u}" height="${u}" fill="${C.shade}" stroke="${C.accent}" stroke-width="1"/>`;
    oy += u + 2;
    if ((i + 1) % 10 === 0) { oy = yTop; ox += u + 2; }
  }
  return wrap(W, H, s);
}

// ── image (e.g. a figure imported from a PDF) ────────────────────────────────
function imageDiagram(p) {
  if (!p || !p.src) return "";
  return `<img class="diagram-img" src="${esc(p.src)}" alt="${esc(p.alt || "figure")}" loading="lazy" />`;
}

// ── data table ───────────────────────────────────────────────────────────────
function dataTable(p) {
  const headers = p.headers || [], rows = p.rows || [];
  let s = `<table class="data-table"><thead><tr>`;
  for (const h of headers) s += `<th>${esc(h)}</th>`;
  s += `</tr></thead><tbody>`;
  for (const r of rows) {
    s += `<tr>`;
    for (const c of r) s += `<td>${esc(c)}</td>`;
    s += `</tr>`;
  }
  s += `</tbody></table>`;
  return s; // HTML table, not SVG
}
