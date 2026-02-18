import { FmuData } from "./fmuParser";

function esc(s: string | undefined): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDateTime(iso: string | undefined): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }) + " " + d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZoneName: "short",
    });
  } catch {
    return iso;
  }
}

function renderCapabilityTable(
  label: string,
  caps: Record<string, string>,
): string {
  const ident = caps.modelIdentifier;
  const flags = Object.entries(caps).filter(
    ([k]) => k !== "modelIdentifier",
  );
  if (flags.length === 0 && !ident) return "";

  let rows = "";
  if (ident) {
    rows += `<tr><td class="cap-name">modelIdentifier</td><td>${esc(ident)}</td></tr>`;
  }
  for (const [key, val] of flags) {
    const display =
      val === "true"
        ? '<span class="cap-true">&#x2713;</span>'
        : val === "false"
          ? '<span class="cap-false">&#x2717;</span>'
          : esc(val);
    rows += `<tr><td class="cap-name">${esc(key)}</td><td>${display}</td></tr>`;
  }

  return `
    <div class="capability-block">
      <h3>${esc(label)}</h3>
      <table class="cap-table">${rows}</table>
    </div>`;
}

function buildAsciiTree(entries: string[]): string {
  interface TreeNode {
    children: Map<string, TreeNode>;
  }
  const root: TreeNode = { children: new Map() };

  for (const entry of entries) {
    if (entry.endsWith("/")) continue; // skip directory-only entries for leaf counting
    const parts = entry.split("/").filter((p) => p.length > 0);
    let node = root;
    for (const part of parts) {
      if (!node.children.has(part)) {
        node.children.set(part, { children: new Map() });
      }
      node = node.children.get(part)!;
    }
  }

  const lines: string[] = [];
  function walk(node: TreeNode, prefix: string): void {
    const childEntries = Array.from(node.children.entries()).sort(([a, aNode], [b, bNode]) => {
      const aDir = aNode.children.size > 0;
      const bDir = bNode.children.size > 0;
      if (aDir !== bDir) return aDir ? -1 : 1;
      return a.localeCompare(b);
    });
    childEntries.forEach(([name, child], i) => {
      const isLast = i === childEntries.length - 1;
      const connector = isLast ? "\u2514\u2500\u2500 " : "\u251C\u2500\u2500 ";
      const isDir = child.children.size > 0;
      lines.push(prefix + connector + name + (isDir ? "/" : ""));
      if (isDir) {
        walk(child, prefix + (isLast ? "    " : "\u2502   "));
      }
    });
  }

  walk(root, "");
  return lines.join("\n");
}

export function generateWebviewHtml(data: FmuData, nonce: string): string {
  const versionBadge =
    data.fmiVersion === "3.0"
      ? '<span class="badge fmi3">FMI 3.0</span>'
      : '<span class="badge fmi2">FMI 2.0</span>';

  // Capabilities
  let capabilitiesHtml = "";
  if (data.modelExchange) {
    capabilitiesHtml += renderCapabilityTable("Model Exchange", data.modelExchange);
  }
  if (data.coSimulation) {
    capabilitiesHtml += renderCapabilityTable("Co-Simulation", data.coSimulation);
  }
  if (data.scheduledExecution) {
    capabilitiesHtml += renderCapabilityTable("Scheduled Execution", data.scheduledExecution);
  }

  // Platforms
  const platformsHtml = data.platforms
    .map((p) => `<span class="platform-chip">${esc(p)}</span>`)
    .join("");

  // Default experiment
  let experimentHtml = "";
  if (data.defaultExperiment) {
    const entries = Object.entries(data.defaultExperiment);
    if (entries.length > 0) {
      experimentHtml = `<div class="section">
        <h2 class="section-header" data-section="experiment">Default Experiment</h2>
        <div class="section-body" id="experiment">
          <table class="info-table">
            ${entries.map(([k, v]) => `<tr><td class="cap-name">${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}
          </table>
        </div>
      </div>`;
    }
  }

  // Contents — ASCII tree, collapsed by default
  let contentsHtml = "";
  const nonDirEntries = data.zipEntries.filter((e) => !e.endsWith("/"));
  if (nonDirEntries.length > 0) {
    const tree = buildAsciiTree(data.zipEntries);
    contentsHtml = `<div class="section">
      <h2 class="section-header collapsed" data-section="contents">Contents (${nonDirEntries.length} files)</h2>
      <div class="section-body hidden" id="contents"><pre class="file-tree">${esc(tree)}</pre></div>
    </div>`;
  }

  const varCount = data.variables.length;
  const formattedTime = formatDateTime(data.generationDateAndTime);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family, sans-serif);
    font-size: var(--vscode-font-size, 13px);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 16px 24px;
    line-height: 1.5;
  }
  h1 { font-size: 1.4em; margin-bottom: 4px; font-weight: 600; }
  h2 { font-size: 1.1em; margin-bottom: 8px; font-weight: 600; }
  h3 { font-size: 0.95em; margin-bottom: 4px; font-weight: 600; }
  .header { margin-bottom: 20px; }
  .header-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .meta { color: var(--vscode-descriptionForeground); font-size: 0.9em; margin-top: 4px; }
  .meta span { margin-right: 16px; }
  .badge {
    display: inline-block; padding: 2px 8px; border-radius: 3px;
    font-size: 0.85em; font-weight: 600;
  }
  .fmi2 { background: #2d5f9a; color: #fff; }
  .fmi3 { background: #1a8a4a; color: #fff; }
  .section { margin-bottom: 16px; }
  .section-header {
    cursor: pointer; user-select: none; padding: 6px 0;
    border-bottom: 1px solid var(--vscode-widget-border, #444);
  }
  .section-header::before {
    content: "\\25BC"; display: inline-block; width: 16px;
    font-size: 0.7em; vertical-align: middle; transition: transform 0.15s;
  }
  .section-header.collapsed::before { transform: rotate(-90deg); }
  .section-body { padding: 8px 0; }
  .section-body.hidden { display: none; }
  .capabilities { display: flex; gap: 24px; flex-wrap: wrap; }
  .capability-block { min-width: 260px; }
  .cap-table { border-collapse: collapse; width: 100%; }
  .cap-table td { padding: 2px 8px 2px 0; }
  .cap-name { color: var(--vscode-descriptionForeground); white-space: nowrap; }
  .cap-true { color: #4ec94e; }
  .cap-false { color: var(--vscode-descriptionForeground); opacity: 0.5; }
  .info-table { border-collapse: collapse; }
  .info-table td { padding: 2px 12px 2px 0; }
  .platform-chip {
    display: inline-block; padding: 2px 10px; margin: 2px 4px 2px 0;
    background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
    border-radius: 3px; font-size: 0.85em; font-family: var(--vscode-editor-font-family, monospace);
  }
  .file-tree {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 0.9em; line-height: 1.4;
    color: var(--vscode-foreground);
    white-space: pre;
  }
  .toolbar {
    display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
    margin-bottom: 8px;
  }
  .filter-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .filter-rows.hidden { display: none; }
  .filter-toggle {
    padding: 3px 10px; border: 1px solid var(--vscode-button-secondaryBorder, var(--vscode-widget-border, #555));
    background: var(--vscode-button-secondaryBackground, transparent);
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
    border-radius: 3px; cursor: pointer; font-size: 0.8em; white-space: nowrap;
  }
  .filter-toggle:hover { background: var(--vscode-button-secondaryHoverBackground, #ffffff15); }
  .filter-label {
    font-size: 0.8em; color: var(--vscode-descriptionForeground);
    min-width: 65px; font-weight: 600;
  }
  .search-box {
    padding: 4px 8px; border: 1px solid var(--vscode-input-border, #444);
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border-radius: 3px; font-size: 0.9em; min-width: 240px;
    outline: none;
  }
  .search-box:focus { border-color: var(--vscode-focusBorder); }
  .filter-btn {
    padding: 3px 10px; border: 1px solid var(--vscode-button-secondaryBorder, var(--vscode-widget-border, #555));
    background: var(--vscode-button-secondaryBackground, transparent);
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
    border-radius: 3px; cursor: pointer; font-size: 0.8em;
  }
  .filter-btn:hover { background: var(--vscode-button-secondaryHoverBackground, #ffffff15); }
  .filter-btn.active {
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    border-color: var(--vscode-button-background);
  }
  .var-status {
    color: var(--vscode-descriptionForeground); font-size: 0.85em; margin-left: auto;
    white-space: nowrap;
  }
  .vscroll-container {
    overflow-y: auto; position: relative;
    max-height: calc(100vh - 120px);
    border: 1px solid var(--vscode-widget-border, #333);
  }
  .var-table {
    width: 100%; border-collapse: collapse;
    font-size: 0.9em; table-layout: fixed;
  }
  .var-table th {
    text-align: left; padding: 4px 8px;
    border-bottom: 2px solid var(--vscode-widget-border, #444);
    position: sticky; top: 0; z-index: 1;
    background: var(--vscode-editor-background);
    cursor: pointer; user-select: none; white-space: nowrap;
    font-weight: 600;
  }
  .var-table th:hover { color: var(--vscode-textLink-foreground); }
  .var-table th .sort-arrow { font-size: 0.7em; margin-left: 4px; }
  .var-table td {
    padding: 3px 8px; height: 24px;
    border-bottom: 1px solid var(--vscode-widget-border, #333);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .var-table tr:hover td { background: var(--vscode-list-hoverBackground); }
  .col-name { width: 28%; font-family: var(--vscode-editor-font-family, monospace); }
  .col-type { width: 10%; }
  .col-vr { width: 8%; font-family: var(--vscode-editor-font-family, monospace); }
  .col-caus { width: 12%; }
  .col-var { width: 10%; }
  .col-start { width: 10%; }
  .col-unit { width: 7%; }
  .col-desc { width: 15%; }
  .copyable { cursor: pointer; }
  .copyable:hover { color: var(--vscode-textLink-foreground); text-decoration: underline; }
  .copy-toast {
    position: fixed; bottom: 16px; right: 16px;
    background: var(--vscode-notifications-background, #333);
    color: var(--vscode-notifications-foreground, #fff);
    padding: 6px 16px; border-radius: 4px;
    font-size: 0.85em; opacity: 0; transition: opacity 0.2s;
    pointer-events: none; z-index: 1000;
  }
  .copy-toast.show { opacity: 1; }
  .spacer td { border: none !important; padding: 0 !important; }
</style>
</head>
<body>
  <div class="header">
    <div class="header-row">
      <h1>${esc(data.modelName)}</h1>
      ${versionBadge}
    </div>
    ${data.description ? `<div class="meta"><span>${esc(data.description)}</span></div>` : ""}
    <div class="meta">
      ${data.generationTool ? `<span>Tool: ${esc(data.generationTool)}</span>` : ""}
      ${formattedTime ? `<span>Generated: ${esc(formattedTime)}</span>` : ""}
      ${data.guid ? `<span>${data.fmiVersion === "3.0" ? "Token" : "GUID"}: <code>${esc(data.guid)}</code></span>` : ""}
    </div>
    <div class="meta">
      ${data.author ? `<span>Author: ${esc(data.author)}</span>` : ""}
      ${data.version ? `<span>Version: ${esc(data.version)}</span>` : ""}
      ${data.copyright ? `<span>${esc(data.copyright)}</span>` : ""}
      ${data.license ? `<span>License: ${esc(data.license)}</span>` : ""}
    </div>
    ${data.numberOfContinuousStates !== undefined || data.numberOfEventIndicators !== undefined ? `<div class="meta">
      ${data.numberOfContinuousStates !== undefined ? `<span>Continuous states: ${data.numberOfContinuousStates}</span>` : ""}
      ${data.numberOfEventIndicators !== undefined ? `<span>Event indicators: ${data.numberOfEventIndicators}</span>` : ""}
    </div>` : ""}
  </div>

  ${capabilitiesHtml ? `<div class="section"><h2 class="section-header" data-section="capabilities">Interface Types &amp; Capabilities</h2><div class="section-body" id="capabilities"><div class="capabilities">${capabilitiesHtml}</div></div></div>` : ""}

  ${data.platforms.length > 0 ? `<div class="section"><h2 class="section-header" data-section="platforms">Platforms (${data.platforms.length})</h2><div class="section-body" id="platforms">${platformsHtml}</div></div>` : ""}

  ${experimentHtml}
  ${contentsHtml}

  <div class="section">
    <h2 class="section-header" data-section="variables">Variables (<span id="varTotal">${varCount}</span>)</h2>
    <div class="section-body" id="variables">
      <div class="toolbar">
        <input type="text" class="search-box" id="varSearch" placeholder="Filter by name or value reference...">
        <button class="filter-toggle" id="filterToggle">Filters &#x25BC;</button>
        <span class="var-status" id="varStatus">Loading...</span>
      </div>
      <div class="filter-rows hidden" id="filterRows">
        <div class="toolbar">
          <div class="filter-row">
            <span class="filter-label">Causality</span>
            <button class="filter-btn active" data-causality="all">All</button>
            <button class="filter-btn" data-causality="input">Input</button>
            <button class="filter-btn" data-causality="output">Output</button>
            <button class="filter-btn" data-causality="parameter">Parameter</button>
            <button class="filter-btn" data-causality="local">Local</button>
            <button class="filter-btn" data-causality="independent">Independent</button>
          </div>
        </div>
        <div class="toolbar">
          <div class="filter-row">
            <span class="filter-label">Variability</span>
            <button class="filter-btn active" data-variability="all">All</button>
            <button class="filter-btn" data-variability="constant">Constant</button>
            <button class="filter-btn" data-variability="fixed">Fixed</button>
            <button class="filter-btn" data-variability="tunable">Tunable</button>
            <button class="filter-btn" data-variability="discrete">Discrete</button>
            <button class="filter-btn" data-variability="continuous">Continuous</button>
          </div>
        </div>
      </div>
      <div class="vscroll-container" id="vscrollContainer">
        <table class="var-table">
          <thead>
            <tr>
              <th class="col-name" data-sort="n">Name <span class="sort-arrow"></span></th>
              <th class="col-type" data-sort="t">Type <span class="sort-arrow"></span></th>
              <th class="col-vr" data-sort="vr">VRef <span class="sort-arrow"></span></th>
              <th class="col-caus" data-sort="c">Causality <span class="sort-arrow"></span></th>
              <th class="col-var" data-sort="va">Variability <span class="sort-arrow"></span></th>
              <th class="col-start" data-sort="s">Start <span class="sort-arrow"></span></th>
              <th class="col-unit" data-sort="u">Unit <span class="sort-arrow"></span></th>
              <th class="col-desc" data-sort="d">Description <span class="sort-arrow"></span></th>
            </tr>
          </thead>
          <tbody id="varBody"></tbody>
        </table>
      </div>
    </div>
  </div>

  <div class="copy-toast" id="copyToast">Copied!</div>

<script nonce="${nonce}">
(function() {
  var ALL_VARS = [];
  var filtered = [];
  var sortKey = null;
  var sortAsc = true;
  var causalityFilter = 'all';
  var variabilityFilter = 'all';
  var searchTerm = '';
  var dataComplete = false;

  var ROW_HEIGHT = 24;
  var BUFFER_ROWS = 10;

  var tbody = document.getElementById('varBody');
  var statusEl = document.getElementById('varStatus');
  var totalEl = document.getElementById('varTotal');
  var searchBox = document.getElementById('varSearch');
  var toast = document.getElementById('copyToast');
  var scrollContainer = document.getElementById('vscrollContainer');

  // Spacer rows for virtual scrolling
  var topSpacer = document.createElement('tr');
  topSpacer.className = 'spacer';
  topSpacer.innerHTML = '<td colspan="8"></td>';
  var bottomSpacer = document.createElement('tr');
  bottomSpacer.className = 'spacer';
  bottomSpacer.innerHTML = '<td colspan="8"></td>';
  tbody.appendChild(topSpacer);
  tbody.appendChild(bottomSpacer);

  function e(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function causalityIcon(c) {
    switch(c) {
      case 'input': return '\\u2192';
      case 'output': return '\\u2190';
      case 'parameter': case 'calculatedParameter': return '\\u25C7';
      case 'structuralParameter': return '\\u25A1';
      case 'local': return '\\u25CB';
      case 'independent': return '\\u25CF';
      default: return '';
    }
  }

  function renderVisibleRows() {
    var scrollTop = scrollContainer.scrollTop;
    var viewHeight = scrollContainer.clientHeight;

    var startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER_ROWS);
    var endIdx = Math.min(filtered.length, Math.ceil((scrollTop + viewHeight) / ROW_HEIGHT) + BUFFER_ROWS);

    // Remove old data rows (keep spacers)
    while (tbody.children.length > 2) {
      tbody.removeChild(tbody.children[1]);
    }

    // Set spacer heights
    topSpacer.children[0].style.height = (startIdx * ROW_HEIGHT) + 'px';
    bottomSpacer.children[0].style.height = Math.max(0, (filtered.length - endIdx) * ROW_HEIGHT) + 'px';

    // Build rows
    var frag = document.createDocumentFragment();
    for (var i = startIdx; i < endIdx; i++) {
      var v = filtered[i];
      var tr = document.createElement('tr');
      tr.innerHTML =
          '<td class="col-name copyable" title="Click to copy" data-copy="' + e(v.n) + '">' + e(v.n) + '</td>'
        + '<td class="col-type">' + e(v.t) + '</td>'
        + '<td class="col-vr copyable" title="Click to copy" data-copy="' + e(v.vr) + '">' + e(v.vr) + '</td>'
        + '<td class="col-caus" title="' + e(v.c) + '">' + causalityIcon(v.c) + ' ' + e(v.c) + '</td>'
        + '<td class="col-var">' + e(v.va) + '</td>'
        + '<td class="col-start">' + e(v.s) + '</td>'
        + '<td class="col-unit">' + e(v.u) + '</td>'
        + '<td class="col-desc" title="' + e(v.d) + '">' + e(v.d) + '</td>';
      frag.appendChild(tr);
    }
    // Insert before bottom spacer
    tbody.insertBefore(frag, bottomSpacer);
  }

  var renderRAF = null;
  function scheduleRender() {
    if (renderRAF) return;
    renderRAF = requestAnimationFrame(function() {
      renderRAF = null;
      renderVisibleRows();
    });
  }

  function applyFilter() {
    var term = searchTerm.toLowerCase();
    filtered = ALL_VARS.filter(function(v) {
      // Causality filter
      if (causalityFilter !== 'all') {
        if (causalityFilter === 'parameter') {
          if (v.c !== 'parameter' && v.c !== 'calculatedParameter' && v.c !== 'structuralParameter') return false;
        } else if (v.c !== causalityFilter) return false;
      }
      // Variability filter
      if (variabilityFilter !== 'all') {
        if (v.va !== variabilityFilter) return false;
      }
      // Search term matches name or value reference
      if (term && v.n.toLowerCase().indexOf(term) === -1 && v.vr.indexOf(term) === -1) return false;
      return true;
    });
    if (sortKey) doSort();
    scrollContainer.scrollTop = 0;
    updateStatus();
    scheduleRender();
  }

  function updateStatus() {
    var text = filtered.length === ALL_VARS.length
      ? ALL_VARS.length + ' variables'
      : filtered.length + ' of ' + ALL_VARS.length + ' variables';
    if (!dataComplete) text += ' (loading...)';
    statusEl.textContent = text;
  }

  function doSort() {
    var key = sortKey;
    var dir = sortAsc ? 1 : -1;
    filtered.sort(function(a, b) {
      var av = a[key] || '';
      var bv = b[key] || '';
      if (key === 'vr') {
        var an = parseInt(av, 10);
        var bn = parseInt(bv, 10);
        if (!isNaN(an) && !isNaN(bn)) return (an - bn) * dir;
      }
      return av.localeCompare(bv) * dir;
    });
  }

  // Scroll event for virtual scrolling
  scrollContainer.addEventListener('scroll', scheduleRender);

  // Filter toggle
  var filterToggle = document.getElementById('filterToggle');
  var filterRows = document.getElementById('filterRows');
  filterToggle.addEventListener('click', function() {
    var hidden = filterRows.classList.toggle('hidden');
    filterToggle.innerHTML = hidden ? 'Filters &#x25BC;' : 'Filters &#x25B2;';
  });

  // Search with debounce
  var searchTimeout = null;
  searchBox.addEventListener('input', function() {
    searchTerm = this.value;
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(applyFilter, 150);
  });

  // Causality filter buttons
  document.querySelectorAll('.filter-btn[data-causality]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.filter-btn[data-causality]').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      causalityFilter = btn.dataset.causality;
      applyFilter();
    });
  });

  // Variability filter buttons
  document.querySelectorAll('.filter-btn[data-variability]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.filter-btn[data-variability]').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      variabilityFilter = btn.dataset.variability;
      applyFilter();
    });
  });

  // Sort
  document.querySelectorAll('.var-table th[data-sort]').forEach(function(th) {
    th.addEventListener('click', function() {
      var key = th.dataset.sort;
      if (sortKey === key) { sortAsc = !sortAsc; }
      else { sortKey = key; sortAsc = true; }
      document.querySelectorAll('.sort-arrow').forEach(function(el) { el.textContent = ''; });
      th.querySelector('.sort-arrow').textContent = sortAsc ? '\\u25B2' : '\\u25BC';
      doSort();
      scrollContainer.scrollTop = 0;
      scheduleRender();
    });
  });

  // Click to copy
  document.addEventListener('click', function(ev) {
    var cell = ev.target.closest('.copyable');
    if (!cell) return;
    var text = cell.dataset.copy;
    if (!text) return;
    navigator.clipboard.writeText(text).then(function() {
      toast.textContent = 'Copied: ' + text;
      toast.classList.add('show');
      setTimeout(function() { toast.classList.remove('show'); }, 1200);
    });
  });

  // Section collapse
  document.querySelectorAll('.section-header').forEach(function(header) {
    header.addEventListener('click', function() {
      var target = document.getElementById(header.dataset.section);
      if (!target) return;
      header.classList.toggle('collapsed');
      target.classList.toggle('hidden');
    });
  });

  // Receive variable data from extension via postMessage
  window.addEventListener('message', function(event) {
    var msg = event.data;
    if (msg.type === 'variables') {
      for (var i = 0; i < msg.chunk.length; i++) {
        ALL_VARS.push(msg.chunk[i]);
      }
      if (msg.done) dataComplete = true;
      totalEl.textContent = String(msg.total);
      applyFilter();
    }
  });
})();
</script>
</body>
</html>`;
}
