// When does your part of the world cross +2 °C?
// Map (left) and linked line chart (right) over CMIP6 GFDL-ESM4 temperature anomalies.

const SCEN = {
  ssp126: { name: "Low (SSP1-2.6)", color: "#2b7bba" },
  ssp245: { name: "Middle (SSP2-4.5)", color: "#d68a00" },
  ssp585: { name: "High (SSP5-8.5)", color: "#c0392b" },
};
const SMOOTH = 10; // years in the centred running mean
const W = 960, H = 500;

const state = { scenario: "ssp245", mode: "year", year: 2050, thresh: 2, cell: null, playing: null };

const fmtLat = v => `${Math.abs(v)}°${v >= 0 ? "N" : "S"}`;
const fmtLon = v => `${Math.abs(v)}°${v >= 0 ? "E" : "W"}`;
const fmtT = v => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)} °C`;

Promise.all([
  d3.json("data/tas.json"),
  d3.json("https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-110m.json"),
]).then(([data, world]) => init(data, world));

function init(data, world) {
  const lat = data.lat, lon = data.lon;
  const NLAT = lat.length, NLON = lon.length, NC = NLAT * NLON;
  const hist = data.runs.historical;
  const years = hist.years.concat(data.runs.ssp245.years); // 1850..2100
  const NY = years.length, Y0 = years[0];
  const baseTemp = data.baselineTemp;
  // the centred 10-year mean only has a full window from 1855 to 2095
  const FIRST = years.indexOf(1855), LAST = years.indexOf(2095);

  // ---------- series: raw + smoothed, per scenario, [year * NC + cell] ----------
  const raw = {}, smooth = {}, globalRaw = {}, globalSmooth = {};
  for (const k of Object.keys(SCEN)) {
    const rows = hist.cells.concat(data.runs[k].cells);
    const r = new Float32Array(NY * NC);
    rows.forEach((row, t) => row.forEach((v, c) => (r[t * NC + c] = v / 10)));
    raw[k] = r;
    smooth[k] = runningMean(r, NY, NC);
    globalRaw[k] = Float32Array.from(hist.global.concat(data.runs[k].global));
    globalSmooth[k] = runningMean(globalRaw[k], NY, 1);
  }

  function runningMean(arr, ny, nc) {
    const out = new Float32Array(ny * nc);
    const lo = Math.floor(SMOOTH / 2), hi = SMOOTH - lo - 1;
    for (let c = 0; c < nc; c++) {
      for (let t = 0; t < ny; t++) {
        let s = 0, n = 0;
        for (let u = Math.max(0, t - lo); u <= Math.min(ny - 1, t + hi); u++) { s += arr[u * nc + c]; n++; }
        out[t * nc + c] = s / n;
      }
    }
    return out;
  }

  // First year after which the smoothed series stays above the threshold through 2100 (null = never).
  const crossCache = new Map();
  function crossing(k, thresh) {
    const key = k + thresh;
    if (crossCache.has(key)) return crossCache.get(key);
    const sm = smooth[k], out = new Array(NC);
    for (let c = 0; c < NC; c++) {
      let t = LAST;
      while (t >= FIRST && sm[t * NC + c] > thresh) t--;
      out[c] = t === LAST ? null : years[t + 1];
    }
    crossCache.set(key, out);
    return out;
  }
  function globalCrossing(k, thresh) {
    const g = globalSmooth[k];
    let t = LAST;
    while (t >= FIRST && g[t] > thresh) t--;
    return t === LAST ? null : years[t + 1];
  }

  // ---------- map ----------
  const svg = d3.select("#map");
  const projection = d3.geoEqualEarth().fitExtent([[6, 6], [W - 6, H - 6]], { type: "Sphere" });
  const path = d3.geoPath(projection);
  const clipId = "sphere-clip";
  svg.append("defs").append("clipPath").attr("id", clipId).append("path").attr("d", path({ type: "Sphere" }));
  svg.append("path").attr("class", "sphere").attr("d", path({ type: "Sphere" }));

  const cells = d3.range(NC).map(i => {
    const la = lat[Math.floor(i / NLON)], lo = lon[i % NLON];
    return { i, lat: la, lon: lo, geo: box(lo - 2.5, la - 2.5, lo + 2.5, la + 2.5) };
  });
  function box(w, s, e, n) {
    const ring = [];
    for (let y = s; y <= n; y += 1) ring.push([w, y]);
    for (let x = w; x <= e; x += 1) ring.push([x, n]);
    for (let y = n; y >= s; y -= 1) ring.push([e, y]);
    for (let x = e; x >= w; x -= 1) ring.push([x, s]);
    const g = { type: "Polygon", coordinates: [ring] };
    if (d3.geoArea(g) > 2 * Math.PI) ring.reverse();
    return g;
  }

  const gCells = svg.append("g").attr("clip-path", `url(#${clipId})`);
  const cellSel = gCells.selectAll("path").data(cells).join("path")
    .attr("class", "cell")
    .attr("d", d => path(d.geo))
    .on("mousemove", (ev, d) => showTip(ev, d))
    .on("mouseleave", hideTip)
    .on("click", (ev, d) => selectCell(d.i));
  svg.append("path").attr("class", "land").attr("d", path(topojson.feature(world, world.objects.land)));
  const selOutline = svg.append("path").attr("class", "sel");

  // colour scales
  const yearColor = d3.scaleDiverging(t => d3.interpolateRdBu(1 - t)).domain([-3, 0, 9]).clamp(true);
  const crossColor = d3.scaleSequential(t => d3.interpolateYlOrRd(1 - t * 0.9)).domain([1900, 2100]).clamp(true);
  const NEVER = "#d9d9d9";

  function colorMap() {
    if (state.mode === "year") {
      const t = state.year - Y0, sm = smooth[state.scenario];
      cellSel.attr("fill", d => yearColor(sm[t * NC + d.i]));
    } else {
      const cr = crossing(state.scenario, state.thresh);
      cellSel.attr("fill", d => (cr[d.i] == null ? NEVER : crossColor(cr[d.i])));
    }
  }

  // ---------- legend ----------
  function drawLegend() {
    const lw = 420, lh = 48;
    const root = d3.select("#legend").html("").append("svg").attr("viewBox", `0 0 ${lw} ${lh}`).attr("width", lw).style("max-width", "100%");
    const id = "grad-" + state.mode;
    const grad = root.append("defs").append("linearGradient").attr("id", id);
    const scale = state.mode === "year" ? yearColor : crossColor;
    const [a, b] = state.mode === "year" ? [-3, 9] : [1900, 2100];
    d3.range(0, 1.0001, 0.05).forEach(f => grad.append("stop").attr("offset", f).attr("stop-color", scale(a + f * (b - a))));
    const barW = state.mode === "year" ? 360 : 300;
    const x = d3.scaleLinear().domain([a, b]).range([10, 10 + barW]);
    root.append("text").attr("x", 10).attr("y", 11).attr("font-size", 12).attr("fill", "#6b6b70")
      .text(state.mode === "year"
        ? `Change vs 1850–1900, 10-year mean around ${state.year}`
        : `Year the 10-year mean stays above +${state.thresh.toFixed(1)} °C`);
    root.append("rect").attr("x", 10).attr("y", 16).attr("width", barW).attr("height", 10).attr("fill", `url(#${id})`);
    const ax = state.mode === "year"
      ? d3.axisBottom(x).tickValues([-3, 0, 1.5, 3, 6, 9]).tickFormat(d => (d > 0 ? "+" : "") + d + "°")
      : d3.axisBottom(x).tickValues([1900, 1950, 2000, 2050, 2100]).tickFormat(d3.format("d"));
    root.append("g").attr("transform", "translate(0,26)").call(ax.tickSize(4)).call(g => g.select(".domain").remove())
      .selectAll("text").attr("fill", "#6b6b70");
    if (state.mode === "cross") {
      root.append("rect").attr("x", 330).attr("y", 16).attr("width", 14).attr("height", 10).attr("fill", NEVER);
      root.append("text").attr("x", 348).attr("y", 25).attr("font-size", 12).attr("fill", "#6b6b70").text("not by 2095");
    }
  }

  // ---------- tooltip ----------
  const tip = d3.select("#tip");
  function cellName(d) { return `${fmtLat(d.lat - 2.5)}–${fmtLat(d.lat + 2.5)}, ${fmtLon(d.lon - 2.5)}–${fmtLon(d.lon + 2.5)}`; }
  function showTip(ev, d) {
    let line;
    if (state.mode === "year") {
      const v = smooth[state.scenario][(state.year - Y0) * NC + d.i];
      line = `<b>${fmtT(v)}</b> around ${state.year}`;
    } else {
      const y = crossing(state.scenario, state.thresh)[d.i];
      line = y == null ? `Not above +${state.thresh.toFixed(1)} °C for good by 2095` : `Stays above +${state.thresh.toFixed(1)} °C from <b>${y}</b>`;
    }
    tip.attr("hidden", null).html(`${cellName(d)}<br>${line}<br><span style="opacity:.7">${SCEN[state.scenario].name} · 1850–1900 average ${baseTemp[d.i].toFixed(1)} °C</span>`)
      .style("left", Math.min(ev.clientX + 14, window.innerWidth - 250) + "px").style("top", ev.clientY + 14 + "px");
  }
  function hideTip() { tip.attr("hidden", true); }

  // ---------- line chart ----------
  const lsvg = d3.select("#line");
  const LW = 420, LH = 300, m = { t: 12, r: 14, b: 26, l: 40 };
  const x = d3.scaleLinear().domain([Y0, 2100]).range([m.l, LW - m.r]);
  const y = d3.scaleLinear().range([LH - m.b, m.t]);
  const gx = lsvg.append("g").attr("class", "axis").attr("transform", `translate(0,${LH - m.b})`);
  const gy = lsvg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`);
  const gZero = lsvg.append("line").attr("stroke", "#999").attr("stroke-width", 0.8);
  const gThresh = lsvg.append("g");
  const gLines = lsvg.append("g");
  const gDot = lsvg.append("g");
  const rule = lsvg.append("line").attr("stroke", "#000").attr("stroke-width", 1).attr("y1", m.t).attr("y2", LH - m.b);
  const ruleLabel = lsvg.append("text").attr("font-size", 11).attr("y", m.t + 10);
  gx.call(d3.axisBottom(x).ticks(6).tickFormat(d3.format("d")));
  lsvg.append("rect").attr("x", m.l).attr("y", m.t).attr("width", LW - m.l - m.r).attr("height", LH - m.t - m.b)
    .attr("fill", "transparent")
    .on("click", ev => {
      const yr = Math.round(x.invert(d3.pointer(ev)[0]));
      setMode("year");
      setYear(Math.max(1855, Math.min(2095, yr)));
    });

  function drawLine() {
    const c = state.cell;
    if (c == null) return;
    const series = (arr, k, from, to) => d3.range(from, to + 1).map(t => [years[t], arr[k][t * NC + c]]);
    const tSplit = hist.years.length - 1; // 2014
    let lo = 0, hi = 0;
    for (const k of Object.keys(SCEN)) for (let t = 0; t < NY; t++) { const v = raw[k][t * NC + c]; lo = Math.min(lo, v); hi = Math.max(hi, v); }
    hi = Math.max(hi, d3.max(globalSmooth[state.scenario].subarray(FIRST, LAST + 1)));
    y.domain([Math.min(-1, lo), Math.max(3, hi)]).nice();
    gy.call(d3.axisLeft(y).ticks(6).tickFormat(d => (d > 0 ? "+" : "") + d + "°"));
    gZero.attr("x1", m.l).attr("x2", LW - m.r).attr("y1", y(0)).attr("y2", y(0));

    const line = d3.line().x(d => x(d[0])).y(d => y(d[1]));
    const layers = [{ key: "hist", color: "#555", raw: series(raw, "ssp245", 0, tSplit), sm: series(smooth, "ssp245", FIRST, tSplit) }];
    for (const k of Object.keys(SCEN)) {
      layers.push({ key: k, color: SCEN[k].color, raw: series(raw, k, tSplit, NY - 1), sm: series(smooth, k, tSplit, LAST) });
    }
    const gsm = d3.range(FIRST, LAST + 1).map(t => [years[t], globalSmooth[state.scenario][t]]);

    gLines.selectAll("*").remove();
    for (const L of layers) {
      const on = L.key === "hist" || L.key === state.scenario;
      gLines.append("path").attr("d", line(L.raw)).attr("fill", "none").attr("stroke", L.color).attr("stroke-width", 1).attr("opacity", on ? 0.3 : 0.12);
    }
    gLines.append("path").attr("d", line(gsm)).attr("fill", "none").attr("stroke", "#222").attr("stroke-width", 1.3).attr("stroke-dasharray", "4 3");
    for (const L of layers) {
      const on = L.key === "hist" || L.key === state.scenario;
      gLines.append("path").attr("d", line(L.sm)).attr("fill", "none").attr("stroke", L.color).attr("stroke-width", on ? 2.6 : 1.4).attr("opacity", on ? 1 : 0.55);
    }

    gThresh.selectAll("*").remove();
    gDot.selectAll("*").remove();
    if (state.mode === "cross") {
      gThresh.append("line").attr("x1", m.l).attr("x2", LW - m.r).attr("y1", y(state.thresh)).attr("y2", y(state.thresh))
        .attr("stroke", "#000").attr("stroke-dasharray", "2 3");
      gThresh.append("text").attr("x", m.l + 4).attr("y", y(state.thresh) - 4).attr("font-size", 11).text(`+${state.thresh.toFixed(1)} °C`);
      const yr = crossing(state.scenario, state.thresh)[c];
      if (yr != null) gDot.append("circle").attr("cx", x(yr)).attr("cy", y(state.thresh)).attr("r", 4.5).attr("fill", SCEN[state.scenario].color).attr("stroke", "#fff");
    }
    updateRule();
    updateStat();
  }

  function updateRule() {
    const show = state.mode === "year" && state.cell != null;
    rule.attr("display", show ? null : "none").attr("x1", x(state.year)).attr("x2", x(state.year));
    ruleLabel.attr("display", show ? null : "none").attr("x", x(state.year) + (state.year > 2060 ? -4 : 4))
      .attr("text-anchor", state.year > 2060 ? "end" : "start").text(state.year);
  }

  function updateStat() {
    const c = state.cell;
    const d = cells[c];
    d3.select("#detailTitle").text(cellName(d));
    const last = (k) => d3.mean(d3.range(NY - 20, NY), t => raw[k][t * NC + c]);
    const g = d3.mean(d3.range(NY - 20, NY), t => globalRaw[state.scenario][t]);
    const k = state.scenario;
    const ratio = last(k) / g;
    const th = state.mode === "cross" ? state.thresh : 2;
    const yr = crossing(k, th)[c], gy = globalCrossing(k, th);
    const crossTxt = yr == null
      ? `does not stay above <b>+${th.toFixed(1)} °C</b> by 2095`
      : `stays above <b>+${th.toFixed(1)} °C</b> from <b>${yr}</b>` + (gy ? ` (the global average: ${gy})` : " (the global average never does)");
    d3.select("#detailStat").html(
      `By 2081–2100 this cell ${last(k) >= 0 ? "warms" : "cools"} <b>${fmtT(last(k))}</b> on the ${SCEN[k].name.split(" ")[0].toLowerCase()} path, ` +
      (ratio > 0.05 ? `<b>${ratio.toFixed(1)}×</b> the global average` : `while the world warms <b>${fmtT(g)}</b>`) + `. It ${crossTxt}. ` +
      `Low / middle / high: ${["ssp126", "ssp245", "ssp585"].map(s => fmtT(last(s))).join(" / ")}.`);
  }

  function selectCell(i) {
    state.cell = i;
    selOutline.attr("d", path(cells[i].geo));
    drawLine();
  }

  // ---------- controls ----------
  function setYear(yr) {
    state.year = yr;
    d3.select("#year").property("value", yr);
    d3.select("#yearOut").text(yr);
    colorMap();
    drawLegendYearOnly();
    updateRule();
  }
  function drawLegendYearOnly() { d3.select("#legend text").text(`Change vs 1850–1900, 10-year mean around ${state.year}`); }
  function setMode(mode) {
    if (state.mode === mode) return;
    state.mode = mode;
    d3.selectAll("#mode button").classed("on", function () { return this.dataset.k === mode; });
    d3.select("#yearGroup").classed("hidden", mode !== "year");
    d3.select("#threshGroup").classed("hidden", mode !== "cross");
    if (mode !== "year") stop();
    colorMap(); drawLegend(); drawLine();
  }

  d3.selectAll("#scenario button").on("click", function () {
    state.scenario = this.dataset.k;
    d3.selectAll("#scenario button").classed("on", function () { return this.dataset.k === state.scenario; });
    colorMap(); drawLine();
  });
  d3.selectAll("#mode button").on("click", function () { setMode(this.dataset.k); });
  d3.select("#year").on("input", function () { stop(); setYear(+this.value); });
  d3.select("#thresh").on("input", function () {
    state.thresh = +this.value;
    d3.select("#threshOut").text(`+${state.thresh.toFixed(1)} °C`);
    colorMap(); drawLegend(); drawLine();
  });
  d3.select("#play").on("click", () => (state.playing ? stop() : play()));
  function play() {
    if (state.year >= 2095) setYear(1855);
    d3.select("#play").text("❚❚").attr("aria-label", "Pause");
    state.playing = setInterval(() => {
      if (state.year >= 2095) return stop();
      setYear(state.year + 1);
    }, 70);
  }
  function stop() {
    if (state.playing) clearInterval(state.playing);
    state.playing = null;
    d3.select("#play").text("▶").attr("aria-label", "Play");
  }
  d3.selectAll(".tours button").on("click", function () {
    const la = +this.dataset.lat, lo = +this.dataset.lon;
    const i = cells.findIndex(c => c.lat === la && c.lon === lo);
    if (i >= 0) selectCell(i);
  });

  colorMap();
  drawLegend();
  selectCell(cells.findIndex(c => c.lat === 32.5 && c.lon === -117.5)); // start on San Diego
}
