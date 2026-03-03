const vscode = acquireVsCodeApi();

// ── Tab switching ──
let activeTab = "overview";
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    activeTab = btn.dataset.tab;
    document.querySelectorAll(".tab-btn").forEach((b) => {
      b.classList.remove("active");
      b.setAttribute("aria-selected", "false");
    });
    document
      .querySelectorAll(".tab-content")
      .forEach((c) => c.classList.remove("active"));
    btn.classList.add("active");
    btn.setAttribute("aria-selected", "true");
    document.getElementById("tab-" + activeTab).classList.add("active");
  });
});

// ── Refresh button ──
document.getElementById("btn-refresh").addEventListener("click", () => {
  vscode.postMessage({ type: "refresh" });
});

// ── Filter toggles ──
document
  .getElementById("filter-hide-system")
  .addEventListener("change", sendFilters);
document
  .getElementById("filter-public-only")
  .addEventListener("change", sendFilters);
document
  .getElementById("filter-show-udp")
  .addEventListener("change", sendFilters);

function sendFilters() {
  vscode.postMessage({
    type: "filterChange",
    filters: {
      hideSystem: document.getElementById("filter-hide-system").checked,
      publicOnly: document.getElementById("filter-public-only").checked,
      showUdp: document.getElementById("filter-show-udp").checked,
    },
  });
}

document.getElementById("sort-mode").addEventListener("change", (e) => {
  vscode.postMessage({ type: "sortChange", sort: e.target.value });
});

document
  .getElementById("toggle-auto-refresh")
  .addEventListener("change", (e) => {
    vscode.postMessage({
      type: "autoRefreshChange",
      enabled: e.target.checked,
    });
  });

// ── ORCHESTRATION EVENT LISTENERS ──
let orchDetectStartTime = 0;
const ORCH_DETECT_MIN_MS = 700;

document.getElementById("btn-orch-detect").addEventListener("click", () => {
  const btn = document.getElementById("btn-orch-detect");
  btn.disabled = true;
  btn.classList.add("orch-detecting");
  btn.innerHTML =
    '<svg class="orch-spin" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2a10 10 0 0 1 10 10"/></svg> Scanning...';
  orchDetectStartTime = Date.now();
  vscode.postMessage({ type: "orchDetect" });
});

document.getElementById("btn-orch-create").addEventListener("click", () => {
  orchShowModal();
});

document
  .getElementById("btn-orch-modal-cancel")
  .addEventListener("click", orchCloseModal);

document
  .getElementById("btn-orch-modal-close")
  .addEventListener("click", orchCloseModal);

document.getElementById("btn-orch-modal-save").addEventListener("click", () => {
  orchFormSubmit();
});

// Enter key submits modal (except in textareas)
document.getElementById("orch-modal").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.tagName !== "TEXTAREA") {
    e.preventDefault();
    orchFormSubmit();
  }
});

// Close modal when clicking overlay
document.getElementById("orch-modal").addEventListener("click", (e) => {
  if (e.target.id === "orch-modal") {
    orchCloseModal();
  }
});

// Detected services section toggle
let orchDetectedUserToggled = false;
document
  .getElementById("orch-detected-toggle")
  .addEventListener("click", () => {
    const section = document.getElementById("orch-detected-section");
    section.classList.toggle("collapsed");
    orchDetectedUserToggled = true;
  });

// Saved services section toggle
let orchSavedUserToggled = false;
document.getElementById("orch-saved-toggle").addEventListener("click", () => {
  const section = document.getElementById("orch-saved-section");
  section.classList.toggle("collapsed");
  orchSavedUserToggled = true;
});

// Load initial orchestration data
vscode.postMessage({ type: "orchLoad" });

// Quick filter for orchestration
let orchFilterText = "";
document.getElementById("orch-filter").addEventListener("input", function () {
  orchFilterText = this.value.toLowerCase();
  if (lastOrchData) {
    renderOrchestration(
      lastOrchData.detected,
      lastOrchData.saved,
      lastOrchData.groups,
    );
  }
});

let lastOrchData = null;
// Track collapsed stacks (group names)
const orchCollapsedStacks = new Set();

// ── Semantic colors ──
function getProcessDotClass(proc) {
  const name = proc.name.toLowerCase();
  if (name.includes("system") || proc.pid === 0 || proc.pid === 4)
    return "dot-gray";
  if (proc.ports.some((p) => p.local_ip === "0.0.0.0")) return "dot-orange";
  if (proc.ports.every((p) => p.protocol === "UDP")) return "dot-purple";
  return "dot-green";
}

function getPortColorClass(port) {
  if (port.protocol === "UDP") return "port-udp";
  if (port.local_ip === "0.0.0.0") return "port-public";
  if (port.local_ip === "127.0.0.1" || port.local_ip === "::1")
    return "port-local";
  return "port-other";
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── LIVE state ──
let expandedPids = new Set();
let currentLiveData = [];
let newPidSet = new Set();
let currentResources = {}; // pid → { cpu, memoryMB }

function renderLive(data) {
  currentLiveData = data;
  const el = document.getElementById("live-content");

  if (!data || data.length === 0) {
    el.innerHTML =
      '<div class="empty-state"><div class="icon"><svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15 15 0 0 1 4 10 15 15 0 0 1-4 10 15 15 0 0 1-4-10 15 15 0 0 1 4-10z"/></svg></div><div>No listening ports found</div></div>';
    return;
  }

  let html = "";
  data.forEach((proc) => {
    const dotClass = getProcessDotClass(proc);
    const isOpen = expandedPids.has(proc.pid);
    const portCount = proc.ports.length;
    const isNew = newPidSet.has(proc.pid);

    html +=
      '<div class="process-row' +
      (isNew ? " highlight" : "") +
      '" data-row-pid="' +
      proc.pid +
      '">';
    html += '<div class="process-header" data-pid="' + proc.pid + '">';
    html +=
      '<span class="process-chevron ' + (isOpen ? "open" : "") + '">▶</span>';
    html += '<span class="process-dot ' + dotClass + '"></span>';
    html += '<div class="process-info">';
    html += '<span class="process-name">' + escapeHtml(proc.name) + "</span>";
    html +=
      '<span class="process-meta">' +
      portCount +
      " port" +
      (portCount !== 1 ? "s" : "") +
      " · PID " +
      proc.pid +
      "</span>";
    html += "</div>";

    // Resource badges (CPU / memory)
    const res = currentResources[proc.pid];
    if (res) {
      html += '<div class="resource-badges">';
      const cpuClass = res.cpu > 80 ? 'res-high' : res.cpu > 40 ? 'res-med' : 'res-low';
      html += '<span class="badge-resource ' + cpuClass + '" title="CPU usage">' +
        '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></svg> ' +
        res.cpu.toFixed(1) + '%</span>';
      html += '<span class="badge-resource res-mem" title="Memory usage">' +
        '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="3" width="12" height="18" rx="1"/><line x1="6" y1="7" x2="18" y2="7"/><line x1="6" y1="11" x2="18" y2="11"/></svg> ' +
        res.memoryMB.toFixed(1) + ' MB</span>';
      html += '</div>';
    }

    html += '<div class="process-actions">';
    html +=
      '<button class="btn-action kill-btn" data-kill-pid="' +
      proc.pid +
      '" data-kill-name="' +
      escapeHtml(proc.name) +
      '" data-kill-ports="' +
      portCount +
      '" title="Kill Process"><svg class="icon-svg" viewBox="0 0 24 24"><path d="M3 6H21"/><path d="M8 6V4C8 3.448 8.448 3 9 3H15C15.552 3 16 3.448 16 4V6"/><path d="M19 6L18.2 19C18.138 19.877 17.406 20.5 16.526 20.5H7.474C6.594 20.5 5.862 19.877 5.8 19L5 6"/><path d="M10 11V17"/><path d="M14 11V17"/></svg></button>';
    html += "</div>";
    html += "</div>";

    if (isOpen) {
      html += '<div class="port-list">';
      proc.ports.forEach((port) => {
        const isPublic = port.local_ip === "0.0.0.0";
        const address = isPublic ? "0.0.0.0" : "Localhost";
        const pColor = getPortColorClass(port);
        html += '<div class="port-row">';
        html += '<div class="port-left">';
        html +=
          '<span class="port-icon"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/></svg></span>';
        html +=
          '<span class="port-number ' +
          pColor +
          '">' +
          port.local_port +
          "</span>";
        html +=
          '<span class="port-detail">· ' +
          address +
          " · " +
          port.protocol +
          "</span>";
        if (isPublic) {
          html +=
            '<span class="badge-public"><svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15 15 0 0 1 4 10 15 15 0 0 1-4 10 15 15 0 0 1-4-10 15 15 0 0 1 4-10z"/></svg> Public</span>';
        }
        if (port.frameworkHint) {
          html +=
            '<span class="badge-framework">' +
            escapeHtml(port.frameworkHint) +
            "</span>";
        }
        html += "</div>";
        html += '<div class="port-right">';
        if (port.protocol === "TCP") {
          html +=
            '<button class="btn-action open-btn" data-open-port="' +
            port.local_port +
            '" data-open-ip="' +
            port.local_ip +
            '" title="Open in Browser"><svg class="icon-svg icon-fill" viewBox="0 0 24 24"><path d="M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14V3zM5 5h5V3H3v7h2V5zm0 14h14V9h2v12H3V9h2v10z"/></svg></button>';
        }
        html += "</div>";
        html += "</div>";
      });
      html += "</div>";
    }

    html += "</div>";
  });

  el.innerHTML = html;
  bindLiveEvents();

  if (newPidSet.size > 0) {
    setTimeout(() => {
      document.querySelectorAll(".process-row.highlight").forEach((el) => {
        el.classList.add("highlight-fade");
        el.classList.remove("highlight");
      });
      newPidSet.clear();
    }, 1500);
  }
}

function bindLiveEvents() {
  document.querySelectorAll(".process-header").forEach((el) => {
    el.addEventListener("click", () => {
      const pid = Number(el.dataset.pid);
      if (expandedPids.has(pid)) {
        expandedPids.delete(pid);
      } else {
        expandedPids.add(pid);
      }
      renderLive(currentLiveData);
    });
  });

  document.querySelectorAll("[data-kill-pid]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      vscode.postMessage({
        type: "kill",
        pid: Number(el.dataset.killPid),
        processName: el.dataset.killName,
        portCount: Number(el.dataset.killPorts),
      });
    });
  });

  document.querySelectorAll("[data-open-port]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      vscode.postMessage({
        type: "open",
        port: Number(el.dataset.openPort),
        ip: el.dataset.openIp,
      });
    });
  });
}

// ── OVERVIEW render ──
function renderOverview(data) {
  const el = document.getElementById("tab-overview");
  if (!data) {
    el.innerHTML = '<div class="loading-state">No data available</div>';
    return;
  }

  let html = "";

  html += '<div class="ov-section">';
  html += '<div class="ov-section-title">Summary</div>';
  html += '<div class="ov-grid">';
  html += ovCard(data.listeningPorts, "Listening Ports", "blue", "primary");
  html += ovCard(data.publicPorts, "Public Ports", "orange", "secondary");
  html += ovCard(data.totalProcesses, "Processes", "green", "tertiary");
  html += ovCard(data.udpPorts, "UDP Ports", "purple", "tertiary");
  html +=
    '<div class="ov-card full"><div class="ov-val">Last updated: ' +
    data.lastUpdated +
    "</div></div>";
  html += "</div></div>";

  html += '<div class="ov-section">';
  html += '<div class="ov-section-title">Risk Insight — Public Services</div>';
  if (data.riskServices.length === 0) {
    html += '<div class="ov-risk-empty">✅ No publicly exposed services</div>';
  } else {
    data.riskServices.forEach((svc) => {
      const ports = svc.ports.join(", ");
      const sevClass = "severity-" + svc.severity;
      const sevLabel =
        svc.severity === "high"
          ? "HIGH"
          : svc.severity === "medium"
            ? "MED"
            : "LOW";
      html += '<div class="ov-risk-item">';
      html += '<span class="ov-risk-dot ' + sevClass + '"></span>';
      html += '<div class="ov-risk-info">';
      html += '<div class="ov-risk-name">' + escapeHtml(svc.name) + "</div>";
      html +=
        '<div class="ov-risk-detail">PID ' +
        svc.pid +
        " · Ports: " +
        ports +
        "</div>";
      html += "</div>";
      html += '<span class="ov-risk-badge">' + sevLabel + "</span>";
      html += "</div>";
    });
  }
  html += "</div>";

  el.innerHTML = html;
}

function ovCard(value, label, cls, tier) {
  return (
    '<div class="ov-card ' +
    (tier || "") +
    '"><div class="ov-val ' +
    cls +
    '">' +
    value +
    '</div><div class="ov-lbl">' +
    label +
    "</div></div>"
  );
}

// ── Footer ──
function updateFooter(summary) {
  const footer = document.getElementById("footer");
  if (!summary) {
    footer.textContent = "";
    return;
  }
  const parts = [];
  parts.push(
    summary.processes + " process" + (summary.processes !== 1 ? "es" : ""),
  );
  parts.push(
    summary.ports + " listening port" + (summary.ports !== 1 ? "s" : ""),
  );
  if (summary.publicPorts > 0) {
    parts.push(summary.publicPorts + " public");
  }
  footer.textContent = parts.join(" • ");
}

// ════════════════════════════════
// SNAPSHOT TAB LOGIC
// ════════════════════════════════

let snapshotData = [];
let activeDropdownId = null;

// Save buttons (top bar + CTA)
document.getElementById("btn-save-snapshot").addEventListener("click", () => {
  vscode.postMessage({ type: "snapshotSave" });
});
document
  .getElementById("btn-save-snapshot-cta")
  .addEventListener("click", () => {
    vscode.postMessage({ type: "snapshotSave" });
  });

// Compare button
document.getElementById("btn-snap-compare").addEventListener("click", () => {
  const idA = document.getElementById("snap-compare-a").value;
  const idB = document.getElementById("snap-compare-b").value;
  if (!idA || !idB || idA === idB) {
    return;
  }
  vscode.postMessage({ type: "snapshotCompare", idA, idB });
});

// Compare with current button
document
  .getElementById("btn-snap-compare-current")
  .addEventListener("click", () => {
    const idA = document.getElementById("snap-compare-a").value;
    if (!idA) {
      return;
    }
    vscode.postMessage({ type: "snapshotCompareWithCurrent", id: idA });
  });

// Swap button
document.getElementById("btn-snap-swap").addEventListener("click", () => {
  const selA = document.getElementById("snap-compare-a");
  const selB = document.getElementById("snap-compare-b");
  const tmp = selA.value;
  selA.value = selB.value;
  selB.value = tmp;
  updateCompareState();
});

// Validate compare state on select change
document
  .getElementById("snap-compare-a")
  .addEventListener("change", updateCompareState);
document
  .getElementById("snap-compare-b")
  .addEventListener("change", updateCompareState);

function updateCompareState() {
  const idA = document.getElementById("snap-compare-a").value;
  const idB = document.getElementById("snap-compare-b").value;
  const btn = document.getElementById("btn-snap-compare");
  const helper = document.getElementById("snap-compare-helper");

  if (idA === idB && idA) {
    btn.disabled = true;
    helper.textContent = "Select two different snapshots";
  } else if (!idA || !idB) {
    btn.disabled = true;
    helper.textContent = "";
  } else {
    btn.disabled = false;
    helper.textContent = "";
  }
}

// Close dropdowns on outside click
document.addEventListener("click", () => {
  closeDropdowns();
});

function closeDropdowns() {
  document.querySelectorAll(".snap-dropdown").forEach((d) => d.remove());
  activeDropdownId = null;
}

function timeAgo(isoStr) {
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return mins + " min ago";
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + "h ago";
  const days = Math.floor(hrs / 24);
  if (days < 30) return days + "d ago";
  return new Date(isoStr).toLocaleDateString();
}

function getSnapDotColor(index) {
  const colors = ["green", "blue", "orange", "purple"];
  return colors[index % colors.length];
}

let expandedSnapId = null;

function renderSnapshots(data) {
  snapshotData = data;
  const el = document.getElementById("snap-list-section");
  const compareSection = document.getElementById("snap-compare-section");

  if (!data || data.length === 0) {
    el.innerHTML =
      '<div class="snap-empty"><div class="snap-empty-icon"><svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg></div><div class="snap-empty-title">No snapshots saved</div><div class="snap-empty-desc">Capture your current port state and compare it later to detect changes. Click "Save snapshot" to start.</div><button class="snap-cta" id="snap-cta-dynamic"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Capture Current State</button></div>';
    const ctaBtn = document.getElementById("snap-cta-dynamic");
    if (ctaBtn) {
      ctaBtn.addEventListener("click", () =>
        vscode.postMessage({ type: "snapshotSave" }),
      );
    }
    compareSection.style.display = "none";
    return;
  }

  let html = '<div class="snap-section">';
  html +=
    '<div class="snap-section-title">Saved Snapshots (' +
    data.length +
    ")</div>";
  html += '<div class="snap-table">';
  html +=
    '<div class="snap-table-header"><span>Name</span><span style="text-align:center">Procs</span><span style="text-align:right">Date</span><span></span></div>';

  data.forEach((snap, i) => {
    const isExpanded = expandedSnapId === snap.id;
    html += '<div class="snap-row" data-snap-id="' + snap.id + '">';
    html +=
      '<div class="snap-name-cell"><span class="snap-dot ' +
      getSnapDotColor(i) +
      '"></span><div><span class="snap-name">' +
      escapeHtml(snap.name) +
      "</span>";
    html +=
      '<div class="snap-meta-sub">' +
      snap.processCount +
      " procs · " +
      snap.portCount +
      " ports" +
      (snap.publicCount > 0 ? " · " + snap.publicCount + " public" : "") +
      "</div></div></div>";
    html += '<span class="snap-ports">' + snap.processCount + "</span>";
    html += '<span class="snap-date">' + timeAgo(snap.createdAt) + "</span>";
    html +=
      '<button class="snap-menu-btn" data-snap-menu="' +
      snap.id +
      '" title="More actions">⋮</button>';
    html += "</div>";

    if (isExpanded && snap.processes) {
      html += '<div class="snap-detail">';
      snap.processes.forEach((proc) => {
        html += '<div class="snap-detail-proc">';
        html +=
          '<div class="snap-detail-proc-name">' +
          escapeHtml(proc.name) +
          ' <span class="snap-detail-proc-meta">PID ' +
          proc.pid +
          " · " +
          proc.ports.length +
          " port" +
          (proc.ports.length !== 1 ? "s" : "") +
          "</span></div>";
        proc.ports.forEach((p) => {
          const cls = p.ip === "0.0.0.0" ? "port-pub" : "port-num";
          html +=
            '<div class="snap-detail-port"><span class="' +
            cls +
            '">:' +
            p.port +
            "</span> " +
            p.ip +
            "</div>";
        });
        html += "</div>";
      });
      html += "</div>";
    }
  });

  html += "</div></div>";
  el.innerHTML = html;

  // Show compare section if 2+ snapshots
  if (data.length >= 2) {
    compareSection.style.display = "";
    populateCompareSelects(data);
    updateCompareState();
  } else {
    compareSection.style.display = "none";
  }

  // Bind row click to expand/collapse
  document.querySelectorAll(".snap-row").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (
        e.target.closest(".snap-menu-btn") ||
        e.target.closest(".snap-compare-latest-btn")
      )
        return;
      const id = row.dataset.snapId;
      expandedSnapId = expandedSnapId === id ? null : id;
      renderSnapshots(snapshotData);
    });
  });

  // Bind menu buttons
  document.querySelectorAll("[data-snap-menu]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.dataset.snapMenu;
      if (activeDropdownId === id) {
        closeDropdowns();
        return;
      }
      closeDropdowns();
      showSnapDropdown(btn, id);
    });
  });
}

function showSnapDropdown(anchor, id) {
  activeDropdownId = id;
  const dd = document.createElement("div");
  dd.className = "snap-dropdown";

  const rect = anchor.getBoundingClientRect();
  dd.style.top = rect.bottom + 2 + "px";

  let items =
    '<div class="snap-dropdown-item" data-action="rename">Rename</div>';
  // Add compare-with-latest if there are 2+ snapshots and this isn't the latest
  if (snapshotData.length >= 2 && snapshotData[0].id !== id) {
    items +=
      '<div class="snap-dropdown-item" data-action="compare-latest"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg> Compare with latest</div>';
  }
  items +=
    '<div class="snap-dropdown-item danger" data-action="delete">Delete</div>';
  dd.innerHTML = items;

  dd.querySelector('[data-action="rename"]').addEventListener("click", (e) => {
    e.stopPropagation();
    closeDropdowns();
    vscode.postMessage({ type: "snapshotRename", id });
  });

  const compareLBtn = dd.querySelector('[data-action="compare-latest"]');
  if (compareLBtn) {
    compareLBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeDropdowns();
      vscode.postMessage({
        type: "snapshotCompare",
        idA: id,
        idB: snapshotData[0].id,
      });
    });
  }

  dd.querySelector('[data-action="delete"]').addEventListener("click", (e) => {
    e.stopPropagation();
    closeDropdowns();
    vscode.postMessage({ type: "snapshotDelete", id });
  });

  document.body.appendChild(dd);
}

function populateCompareSelects(data) {
  const selA = document.getElementById("snap-compare-a");
  const selB = document.getElementById("snap-compare-b");
  const prevA = selA.value;
  const prevB = selB.value;

  selA.innerHTML = "";
  selB.innerHTML = "";

  data.forEach((snap) => {
    const optA = document.createElement("option");
    optA.value = snap.id;
    optA.textContent = snap.name;
    selA.appendChild(optA);

    const optB = document.createElement("option");
    optB.value = snap.id;
    optB.textContent = snap.name;
    selB.appendChild(optB);
  });

  // Restore previous selection or default to first two
  if (prevA && data.some((s) => s.id === prevA)) {
    selA.value = prevA;
  }
  if (prevB && data.some((s) => s.id === prevB)) {
    selB.value = prevB;
  } else if (data.length >= 2) {
    selB.value = data[1].id;
  }
}

function renderDiff(diff) {
  const el = document.getElementById("snap-diff-results");
  if (!diff) {
    el.innerHTML = "";
    return;
  }

  let html = '<div class="snap-diff">';

  // Context header
  html += '<div class="snap-diff-context">';
  html +=
    "Comparing: <strong>" +
    escapeHtml(diff.context.nameA) +
    "</strong> (" +
    diff.context.ageA +
    ") → <strong>" +
    escapeHtml(diff.context.nameB) +
    "</strong> (" +
    diff.context.ageB +
    ")";
  if (diff.context.isLiveCompare) {
    html += ' <span class="live-indicator">⚡ Live</span>';
  }
  html += "</div>";

  // Summary
  html += '<div class="snap-diff-summary">';
  html += '<span class="snap-diff-summary-label">Changes:</span>';
  html +=
    '<span class="snap-diff-badge added">+' +
    diff.summary.addedPorts +
    " new</span>";
  html +=
    '<span class="snap-diff-badge removed">-' +
    diff.summary.removedPorts +
    " removed</span>";
  html +=
    '<span class="snap-diff-badge same">' +
    diff.summary.unchangedPorts +
    " unchanged</span>";
  html += "</div>";

  if (diff.summary.addedPorts === 0 && diff.summary.removedPorts === 0) {
    html +=
      '<div style="font-size:12px;color:var(--vscode-descriptionForeground);padding:4px 0;">✅ Snapshots are identical</div>';
  } else {
    // Grouped process diff
    diff.processGroups.forEach((group) => {
      if (group.added === 0 && group.removed === 0) {
        return;
      } // skip unchanged-only groups
      html += '<div class="snap-diff-group">';
      html +=
        '<div class="snap-diff-group-header" style="padding-left:12px;">' +
        escapeHtml(group.name) +
        ' <span class="snap-diff-group-meta">PID ' +
        group.pid +
        " · +" +
        group.added +
        " -" +
        group.removed +
        "</span></div>";
      group.ports.forEach((p) => {
        if (p.status === "unchanged") {
          return;
        }
        const marker = p.status === "added" ? "+" : "−";
        html +=
          '<div class="snap-diff-port ' +
          p.status +
          '"><span class="diff-marker">' +
          marker +
          "</span>:" +
          p.port +
          " · " +
          p.ip +
          " · " +
          p.protocol +
          "</div>";
      });
      html += "</div>";
    });
  }

  html += "</div>";
  el.innerHTML = html;
}

// Request snapshot list on tab switch to snapshots
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.dataset.tab === "snapshots") {
      vscode.postMessage({ type: "snapshotList" });
    }
  });
});

// ════════════════════════════════════════════════════
// ORCHESTRATION FUNCTIONS
// ════════════════════════════════════════════════════

function orchShowModal(editId = null, presetGroup = null) {
  const modal = document.getElementById("orch-modal");
  const title = document.getElementById("orch-modal-title");
  const editIdField = document.getElementById("orch-edit-id");

  // Clear validation errors
  document.querySelectorAll(".orch-modal-error").forEach((el) => el.remove());
  document
    .querySelectorAll(
      ".orch-modal-input, .orch-modal-textarea, .orch-dropdown-selected",
    )
    .forEach((el) => el.classList.remove("orch-input-error"));

  title.textContent = editId ? "Edit Service" : "Create Service";
  editIdField.value = editId || "";

  if (!editId) {
    document.getElementById("orch-input-name").value = "";
    document.getElementById("orch-input-role").value = "";
    document.getElementById("orch-role-selected").textContent = "Select Role";
    document.getElementById("orch-role-selected").classList.remove("has-value");
    document
      .querySelectorAll(".orch-dropdown-option")
      .forEach((o) => o.classList.remove("selected"));
    document.getElementById("orch-input-port").value = "";
    document.getElementById("orch-input-cwd").value = "";
    document.getElementById("orch-input-cmds").value = "";
    document.getElementById("orch-input-env").value = "";
    document.getElementById("orch-input-group").value = presetGroup || "";
  }

  modal.classList.add("active");
  // Focus first field
  document.getElementById("orch-input-name").focus();
}

function orchCloseModal() {
  const modal = document.getElementById("orch-modal");
  modal.classList.remove("active");
  // Clear validation errors on close
  document.querySelectorAll(".orch-modal-error").forEach((el) => el.remove());
  document
    .querySelectorAll(
      ".orch-modal-input, .orch-modal-textarea, .orch-dropdown-selected",
    )
    .forEach((el) => el.classList.remove("orch-input-error"));
  // Close dropdown
  document.getElementById("orch-role-dropdown").classList.remove("open");
}

// Custom dropdown logic
(function () {
  const dropdown = document.getElementById("orch-role-dropdown");
  const selected = document.getElementById("orch-role-selected");
  const hiddenInput = document.getElementById("orch-input-role");
  const options = dropdown.querySelectorAll(".orch-dropdown-option");

  selected.addEventListener("click", function (e) {
    e.stopPropagation();
    const isOpen = dropdown.classList.toggle("open");
    selected.setAttribute("aria-expanded", String(isOpen));
  });

  // Keyboard navigation for custom dropdown
  selected.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      const isOpen = dropdown.classList.toggle("open");
      selected.setAttribute("aria-expanded", String(isOpen));
      if (isOpen && options.length > 0) {
        options[0].focus();
      }
    } else if (e.key === "Escape") {
      dropdown.classList.remove("open");
      selected.setAttribute("aria-expanded", "false");
    } else if (
      e.key === "ArrowDown" &&
      dropdown.classList.contains("open") &&
      options.length > 0
    ) {
      e.preventDefault();
      options[0].focus();
    }
  });

  options.forEach(function (opt, index) {
    opt.setAttribute("tabindex", "-1");
    opt.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        opt.click();
      } else if (e.key === "ArrowDown" && index < options.length - 1) {
        e.preventDefault();
        options[index + 1].focus();
      } else if (e.key === "ArrowUp" && index > 0) {
        e.preventDefault();
        options[index - 1].focus();
      } else if (e.key === "ArrowUp" && index === 0) {
        e.preventDefault();
        selected.focus();
      } else if (e.key === "Escape") {
        dropdown.classList.remove("open");
        selected.setAttribute("aria-expanded", "false");
        selected.focus();
      }
    });
    opt.addEventListener("click", function (e) {
      e.stopPropagation();
      const value = this.dataset.value;
      const label = this.textContent;
      hiddenInput.value = value;
      selected.textContent = label;
      selected.classList.add("has-value");
      selected.classList.remove("orch-input-error");
      options.forEach((o) => o.classList.remove("selected"));
      this.classList.add("selected");
      dropdown.classList.remove("open");
      // Remove error message if present
      const err = dropdown.parentNode.querySelector(".orch-modal-error");
      if (err) err.remove();
    });
  });

  // Close dropdown when clicking outside
  document.addEventListener("click", function () {
    dropdown.classList.remove("open");
    selected.setAttribute("aria-expanded", "false");
  });
})();

function orchFormSubmit() {
  const name = document.getElementById("orch-input-name").value.trim();
  const role = document.getElementById("orch-input-role").value;
  const port =
    parseInt(document.getElementById("orch-input-port").value) || undefined;
  const cwd = document.getElementById("orch-input-cwd").value.trim();
  const cmdsText = document.getElementById("orch-input-cmds").value.trim();
  const editId = document.getElementById("orch-edit-id").value;

  // Clear previous validation errors
  document.querySelectorAll(".orch-modal-error").forEach((el) => el.remove());
  document
    .querySelectorAll(
      ".orch-modal-input, .orch-modal-textarea, .orch-dropdown-selected",
    )
    .forEach((el) => el.classList.remove("orch-input-error"));

  let hasError = false;
  function showFieldError(inputId, message) {
    const input = document.getElementById(inputId);
    input.classList.add("orch-input-error");
    const err = document.createElement("div");
    err.className = "orch-modal-error";
    err.textContent = message;
    input.parentNode.appendChild(err);
    hasError = true;
  }

  if (!name) {
    showFieldError("orch-input-name", "Name is required");
  }
  if (!role) {
    // Target the visible dropdown element, not the hidden input
    const sel = document.getElementById("orch-role-selected");
    sel.classList.add("orch-input-error");
    const err = document.createElement("div");
    err.className = "orch-modal-error";
    err.textContent = "Please select a role";
    sel.parentNode.parentNode.appendChild(err);
    hasError = true;
  }
  if (!cmdsText) {
    showFieldError("orch-input-cmds", "At least one start command is required");
  }

  // Validate port range
  const portRaw = document.getElementById("orch-input-port").value.trim();
  if (
    portRaw !== "" &&
    (isNaN(parseInt(portRaw)) ||
      parseInt(portRaw) < 0 ||
      parseInt(portRaw) > 65535)
  ) {
    showFieldError("orch-input-port", "Port must be between 0 and 65535");
  }

  if (hasError) {
    return;
  }

  const commands = cmdsText
    ? cmdsText
        .split("\n")
        .map((c) => c.trim())
        .filter((c) => c)
    : [];
  const envText = document.getElementById("orch-input-env").value.trim();
  const group = document.getElementById("orch-input-group").value.trim();

  // Parse env vars
  const envVars = {};
  if (envText) {
    envText.split("\n").forEach(function (line) {
      const eq = line.indexOf("=");
      if (eq > 0) {
        envVars[line.substring(0, eq).trim()] = line.substring(eq + 1).trim();
      }
    });
  }

  const service = {
    name,
    role,
    port,
    startCommands: commands,
    workingDirectory: cwd,
    autoDetected: false,
    envVars: Object.keys(envVars).length > 0 ? envVars : undefined,
    group: group || undefined,
  };

  if (editId) {
    vscode.postMessage({ type: "orchEditService", id: editId, service });
  } else {
    vscode.postMessage({ type: "orchCreateService", service });
  }

  orchCloseModal();
}

function getRoleIcon(role) {
  switch (role) {
    case "frontend":
      return '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>';
    case "backend":
      return '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>';
    case "database":
      return '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>';
    case "cache":
      return '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>';
    default:
      return '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
  }
}

function getRoleBadgeClass(role) {
  switch (role) {
    case "frontend":
      return "orch-role-frontend";
    case "backend":
      return "orch-role-backend";
    case "database":
      return "orch-role-database";
    case "cache":
      return "orch-role-cache";
    default:
      return "orch-role-custom";
  }
}

function renderOrchestration(detected, saved, groups) {
  // Store for filter re-renders
  lastOrchData = { detected: detected, saved: saved, groups: groups || [] };

  // Apply filter
  if (orchFilterText) {
    detected = (detected || []).filter(function (s) {
      return (
        (s.name || "").toLowerCase().includes(orchFilterText) ||
        (s.role || "").toLowerCase().includes(orchFilterText) ||
        String(s.port || "").includes(orchFilterText)
      );
    });
    saved = (saved || []).filter(function (s) {
      return (
        (s.name || "").toLowerCase().includes(orchFilterText) ||
        (s.role || "").toLowerCase().includes(orchFilterText) ||
        String(s.port || "").includes(orchFilterText) ||
        (s.group || "").toLowerCase().includes(orchFilterText)
      );
    });
  }

  const detectedList = document.getElementById("orch-detected-list");
  const savedList = document.getElementById("orch-saved-list");

  // Render detected services
  const detectedSection = document.getElementById("orch-detected-section");
  const detectedCount = document.getElementById("orch-detected-count");
  const count = detected ? detected.length : 0;
  detectedCount.textContent = count > 0 ? count : "";

  // Only auto-collapse/expand if user hasn't manually toggled
  if (!orchDetectedUserToggled) {
    if (count === 0) {
      detectedSection.classList.add("collapsed");
    }
  }

  if (!detected || detected.length === 0) {
    detectedList.innerHTML =
      '<div class="orch-empty-compact">No services detected</div>';
  } else {
    let html = "";
    detected.forEach((svc) => {
      const role = svc.role || "custom";
      const roleClass = getRoleBadgeClass(role);
      html += '<div class="orch-item orch-item-detected">';
      html += '<div class="orch-item-header">';
      html +=
        '<div class="orch-item-icon"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div>';
      html += '<div class="orch-item-info">';
      html += '<div class="orch-item-name">' + escapeHtml(svc.name) + "</div>";
      html +=
        '<div class="orch-item-detail"><span class="orch-port-badge">:' +
        svc.port +
        "</span> · " +
        escapeHtml(svc.processName) +
        " · PID " +
        svc.pid +
        "</div>";
      html += "</div>";
      html +=
        '<div class="orch-item-role ' +
        roleClass +
        '">' +
        getRoleIcon(role) +
        " " +
        escapeHtml(role) +
        "</div>";
      html += "</div>";
      html += '<div class="orch-item-actions">';
      html +=
        '<button class="orch-action-btn orch-btn-accept" data-orch-accept-port="' +
        svc.port +
        '"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Accept</button>';
      html += "</div>";
      html += "</div>";
    });
    detectedList.innerHTML = html;

    detectedList.querySelectorAll("[data-orch-accept-port]").forEach((btn) => {
      btn.addEventListener("click", function () {
        const port = parseInt(this.dataset.orchAcceptPort);
        const item = detected.find((s) => s.port === port);
        vscode.postMessage({ type: "orchAcceptDetection", detected: item });
      });
    });
  }

  // Reset detect button with minimum spinner duration
  const elapsed = Date.now() - orchDetectStartTime;
  const remaining = Math.max(0, ORCH_DETECT_MIN_MS - elapsed);
  setTimeout(() => {
    const detectBtn = document.getElementById("btn-orch-detect");
    detectBtn.disabled = false;
    detectBtn.classList.remove("orch-detecting");
    detectBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Detect';
  }, remaining);

  // Render saved services
  const savedSection = document.getElementById("orch-saved-section");
  const savedCount = document.getElementById("orch-saved-count");
  const sCount = saved ? saved.length : 0;
  savedCount.textContent = sCount > 0 ? sCount : "";

  if (!orchSavedUserToggled) {
    if (sCount === 0) {
      savedSection.classList.add("collapsed");
    }
  }

  if (!saved || saved.length === 0) {
    savedList.innerHTML =
      '<div class="orch-empty"><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg><div>No services saved</div><div class="orch-empty-hint">Create or accept detected services to manage them</div></div>';
  } else {
    // Partition services into grouped (stacks) and ungrouped
    const stackMap = {};
    const ungrouped = [];
    saved.forEach(function (svc) {
      if (svc.group) {
        if (!stackMap[svc.group]) {
          stackMap[svc.group] = [];
        }
        stackMap[svc.group].push(svc);
      } else {
        ungrouped.push(svc);
      }
    });

    // Helper: build a single service card HTML
    function buildCardHtml(svc) {
      const role = svc.role || "custom";
      const status = svc.status || "stopped";
      const roleClass = getRoleBadgeClass(role);
      const statusClass =
        status === "running"
          ? "orch-status-running"
          : status === "starting"
            ? "orch-status-starting"
            : status === "error"
              ? "orch-status-error"
              : "orch-status-stopped";
      const statusIcon =
        status === "running"
          ? '<svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor" stroke="none"><circle cx="12" cy="12" r="6"/></svg>'
          : status === "starting"
            ? '<svg class="orch-spin" viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 2a10 10 0 0 1 10 10"/></svg>'
            : status === "error"
              ? '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
              : '<svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor" stroke="none"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>';
      const roleStyleClass = "orch-saved-" + role;
      let c =
        '<div class="orch-item orch-item-saved ' +
        roleStyleClass +
        " orch-item-" +
        status +
        '">';
      c += '<div class="orch-item-header">';
      c +=
        '<div class="orch-item-status ' +
        statusClass +
        '">' +
        statusIcon +
        "</div>";
      c += '<div class="orch-item-info">';
      c += '<div class="orch-item-name">' + escapeHtml(svc.name) + "</div>";
      if (svc.port) {
        c +=
          '<div class="orch-item-detail"><span class="orch-port-badge">:' +
          svc.port +
          "</span> · " +
          escapeHtml(status) +
          "</div>";
      } else {
        c += '<div class="orch-item-detail">' + escapeHtml(status) + "</div>";
      }
      c += "</div>";
      c +=
        '<div class="orch-item-role ' +
        roleClass +
        '">' +
        getRoleIcon(role) +
        " " +
        escapeHtml(role) +
        "</div>";
      c += "</div>";
      // Env vars indicator
      if (svc.envVars && Object.keys(svc.envVars).length > 0) {
        const envCount = Object.keys(svc.envVars).length;
        c +=
          '<div class="orch-item-env-badge" title="' +
          envCount +
          " environment variable" +
          (envCount !== 1 ? "s" : "") +
          ' configured"><svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg> ' +
          envCount +
          " env</div>";
      }
      c += '<div class="orch-item-actions">';
      c +=
        '<button class="orch-action-btn orch-btn-start" data-orch-start-id="' +
        escapeHtml(svc.id) +
        '" title="Start service in integrated terminal"><svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg></button>';
      c +=
        '<button class="orch-action-btn orch-btn-stop" data-orch-stop-id="' +
        escapeHtml(svc.id) +
        '" title="Stop service and close terminal"><svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" stroke="none"><rect x="4" y="4" width="16" height="16" rx="2"/></svg></button>';
      c +=
        '<button class="orch-action-btn orch-btn-edit" data-orch-edit-id="' +
        escapeHtml(svc.id) +
        '" title="Edit service configuration"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>';
      c +=
        '<button class="orch-action-btn orch-btn-duplicate" data-orch-dup-id="' +
        escapeHtml(svc.id) +
        '" title="Duplicate this service"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>';
      c +=
        '<button class="orch-action-btn orch-btn-delete" data-orch-delete-id="' +
        escapeHtml(svc.id) +
        '" title="Delete this service permanently"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4c0-.6.4-1 1-1h6c.6 0 1 .4 1 1v2"/><path d="M19 6l-.8 13c-.1.9-.8 1.5-1.7 1.5H7.5c-.9 0-1.6-.6-1.7-1.5L5 6"/></svg></button>';
      c += "</div>";
      c += "</div>";
      return c;
    }

    let html = "";

    // Render stacks (grouped services)
    const stackNames = Object.keys(stackMap);
    stackNames.forEach(function (groupName) {
      const services = stackMap[groupName];
      const isCollapsed = orchCollapsedStacks.has(groupName);
      html +=
        '<div class="orch-stack' +
        (isCollapsed ? " collapsed" : "") +
        '" data-stack-name="' +
        escapeHtml(groupName) +
        '">';
      // Stack header
      html +=
        '<div class="orch-stack-header" data-stack-toggle="' +
        escapeHtml(groupName) +
        '">';
      html +=
        '<div class="orch-stack-toggle-icon"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></div>';
      html += '<div class="orch-stack-title">';
      html +=
        '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
      html += " <span>" + escapeHtml(groupName) + "</span>";
      html += '<span class="orch-stack-count">' + services.length + "</span>";
      html += "</div>";
      html += '<div class="orch-stack-actions">';
      html +=
        '<button class="orch-action-btn orch-btn-add" data-stack-add="' +
        escapeHtml(groupName) +
        '" title="Add new service to this stack"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>';
      html +=
        '<button class="orch-action-btn orch-btn-start" data-stack-start="' +
        escapeHtml(groupName) +
        '" title="Start all services in this stack"><svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg></button>';
      html +=
        '<button class="orch-action-btn orch-btn-ungroup" data-stack-ungroup="' +
        escapeHtml(groupName) +
        '" title="Ungroup: keep services but remove from stack"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2"/><path d="M8 3h13a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-2"/><line x1="8" y1="12" x2="16" y2="12"/></svg></button>';
      html +=
        '<button class="orch-action-btn orch-btn-delete" data-stack-delete="' +
        escapeHtml(groupName) +
        '" title="Delete all services in this stack"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4c0-.6.4-1 1-1h6c.6 0 1 .4 1 1v2"/><path d="M19 6l-.8 13c-.1.9-.8 1.5-1.7 1.5H7.5c-.9 0-1.6-.6-1.7-1.5L5 6"/></svg></button>';
      html += "</div>";
      html += "</div>";
      // Stack body (collapsible)
      html += '<div class="orch-stack-body">';
      html += '<div class="orch-stack-body-inner">';
      services.forEach(function (svc) {
        html += buildCardHtml(svc);
      });
      html += "</div>";
      html += "</div>";
      html += "</div>";
    });

    // Render ungrouped services
    ungrouped.forEach(function (svc) {
      html += buildCardHtml(svc);
    });

    savedList.innerHTML = html;

    // ── Stack action listeners ──
    // Toggle collapse
    savedList.querySelectorAll("[data-stack-toggle]").forEach(function (hdr) {
      hdr.addEventListener("click", function (e) {
        // Don't toggle if clicking an action button
        if (e.target.closest(".orch-stack-actions")) {
          return;
        }
        const gName = this.dataset.stackToggle;
        const stackEl = this.closest(".orch-stack");
        stackEl.classList.toggle("collapsed");
        if (stackEl.classList.contains("collapsed")) {
          orchCollapsedStacks.add(gName);
        } else {
          orchCollapsedStacks.delete(gName);
        }
      });
    });

    // Add service to stack
    savedList.querySelectorAll("[data-stack-add]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        orchShowModal(null, this.dataset.stackAdd);
      });
    });

    // Start all in stack
    savedList.querySelectorAll("[data-stack-start]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        vscode.postMessage({
          type: "orchStartGroup",
          group: this.dataset.stackStart,
        });
      });
    });

    // Ungroup stack (keep services, remove group label)
    savedList.querySelectorAll("[data-stack-ungroup]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        vscode.postMessage({
          type: "orchUngroupStack",
          group: this.dataset.stackUngroup,
        });
      });
    });

    // Delete entire stack (two-click confirm)
    savedList.querySelectorAll("[data-stack-delete]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        if (this.dataset.confirmPending === "true") {
          vscode.postMessage({
            type: "orchDeleteStack",
            group: this.dataset.stackDelete,
          });
        } else {
          this.dataset.confirmPending = "true";
          this.classList.add("orch-btn-confirm-delete");
          this.innerHTML =
            '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Sure?';
          setTimeout(() => {
            this.dataset.confirmPending = "false";
            this.classList.remove("orch-btn-confirm-delete");
            this.innerHTML =
              '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4c0-.6.4-1 1-1h6c.6 0 1 .4 1 1v2"/><path d="M19 6l-.8 13c-.1.9-.8 1.5-1.7 1.5H7.5c-.9 0-1.6-.6-1.7-1.5L5 6"/></svg>';
          }, 3000);
        }
      });
    });

    // ── Individual service card listeners ──
    savedList.querySelectorAll("[data-orch-start-id]").forEach((btn) => {
      btn.addEventListener("click", function () {
        vscode.postMessage({
          type: "orchStartService",
          id: this.dataset.orchStartId,
        });
      });
    });

    savedList.querySelectorAll("[data-orch-stop-id]").forEach((btn) => {
      btn.addEventListener("click", function () {
        vscode.postMessage({
          type: "orchStopService",
          id: this.dataset.orchStopId,
        });
      });
    });

    savedList.querySelectorAll("[data-orch-dup-id]").forEach((btn) => {
      btn.addEventListener("click", function () {
        vscode.postMessage({
          type: "orchDuplicateService",
          id: this.dataset.orchDupId,
        });
      });
    });

    savedList.querySelectorAll("[data-orch-edit-id]").forEach((btn) => {
      btn.addEventListener("click", function () {
        const id = this.dataset.orchEditId;
        const service = saved.find((s) => s.id === id);
        if (service) {
          document.getElementById("orch-input-name").value = service.name;
          document.getElementById("orch-input-role").value = service.role;
          const roleLabel =
            service.role.charAt(0).toUpperCase() + service.role.slice(1);
          document.getElementById("orch-role-selected").textContent = roleLabel;
          document
            .getElementById("orch-role-selected")
            .classList.add("has-value");
          document.querySelectorAll(".orch-dropdown-option").forEach((o) => {
            o.classList.toggle("selected", o.dataset.value === service.role);
          });
          document.getElementById("orch-input-port").value = service.port || "";
          document.getElementById("orch-input-cwd").value =
            service.workingDirectory || "";
          document.getElementById("orch-input-cmds").value = (
            service.startCommands || []
          ).join("\n");
          const envObj = service.envVars || {};
          document.getElementById("orch-input-env").value = Object.entries(
            envObj,
          )
            .map(function (e) {
              return e[0] + "=" + e[1];
            })
            .join("\n");
          document.getElementById("orch-input-group").value =
            service.group || "";
          orchShowModal(id);
        }
      });
    });

    savedList.querySelectorAll("[data-orch-delete-id]").forEach((btn) => {
      btn.addEventListener("click", function () {
        const deleteId = this.dataset.orchDeleteId;
        if (this.dataset.confirmPending === "true") {
          vscode.postMessage({
            type: "orchDeleteService",
            id: deleteId,
          });
        } else {
          this.dataset.confirmPending = "true";
          this.classList.add("orch-btn-confirm-delete");
          this.innerHTML =
            '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Sure?';
          setTimeout(() => {
            this.dataset.confirmPending = "false";
            this.classList.remove("orch-btn-confirm-delete");
            this.innerHTML =
              '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4c0-.6.4-1 1-1h6c.6 0 1 .4 1 1v2"/><path d="M19 6l-.8 13c-.1.9-.8 1.5-1.7 1.5H7.5c-.9 0-1.6-.6-1.7-1.5L5 6"/></svg>';
          }, 3000);
        }
      });
    });
  }
}

// ── Message handler ──
window.addEventListener("message", (event) => {
  const msg = event.data;
  switch (msg.type) {
    case "liveUpdate":
      newPidSet = new Set(msg.newPids || []);
      if (msg.resources) { currentResources = msg.resources; }
      renderLive(msg.data);
      updateFooter(msg.summary);
      break;

    case "resourceUpdate":
      currentResources = msg.data || {};
      if (currentLiveData.length > 0) {
        renderLive(currentLiveData);
      }
      break;

    case "overviewUpdate":
      renderOverview(msg.data);
      break;

    case "snapshotListUpdate":
      renderSnapshots(msg.data);
      break;

    case "snapshotDiff":
      renderDiff(msg.data);
      break;

    case "loadingStart": {
      const btn = document.getElementById("btn-refresh");
      btn.disabled = true;
      btn.classList.add("spinning");
      break;
    }

    case "loadingEnd": {
      const btn = document.getElementById("btn-refresh");
      btn.disabled = false;
      btn.classList.remove("spinning");
      break;
    }

    case "orchData":
      renderOrchestration(msg.detected, msg.saved, msg.groups);
      break;
  }
});
