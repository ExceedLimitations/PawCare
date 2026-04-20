/* ═══════════════════════════════════════════════════════════════════
   PawFeed Dashboard — Application Logic
   ═══════════════════════════════════════════════════════════════════ */

/* ── Theme ─────────────────────────────────────────────────────── */
function toggleTheme() {
  const html = document.documentElement;
  const isDark = html.getAttribute("data-theme") === "dark";
  html.setAttribute("data-theme", isDark ? "light" : "dark");
  document.getElementById("theme-icon-moon").style.display = isDark ? "" : "none";
  document.getElementById("theme-icon-sun").style.display = isDark ? "none" : "";
  if (feedingChart) updateChartColors();
}

/* ── Mobile sidebar ────────────────────────────────────────────── */
function openSidebar() {
  document.getElementById("sidebar").classList.add("open");
  document.getElementById("sidebar-overlay").classList.add("active");
}
function closeSidebar() {
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("sidebar-overlay").classList.remove("active");
}

/* ── Notifications ─────────────────────────────────────────────── */
function toggleNotif() {
  const badge = document.getElementById("notif-badge");
  badge.style.display = badge.style.display === "none" ? "" : "none";
}

/* ── Gauge ─────────────────────────────────────────────────────── */
const CIRCUMFERENCE = 2 * Math.PI * 78;

function setGauge(pct) {
  const circle = document.getElementById("gauge-circle");
  const text = document.getElementById("gauge-text");
  const badge = document.getElementById("gauge-status-badge");
  const prog = document.getElementById("food-prog");
  const fl = document.getElementById("food-level");
  const heroLv = document.getElementById("hero-level");

  pct = Math.min(100, Math.max(0, pct));
  circle.style.strokeDasharray = CIRCUMFERENCE;
  circle.style.strokeDashoffset = CIRCUMFERENCE - (pct / 100) * CIRCUMFERENCE;

  let color, statusText, badgeClass;
  if (pct > 50) {
    color = "#059669";
    statusText = "Good";
    badgeClass = "status-badge badge-ok";
  } else if (pct > 20) {
    color = "#d97706";
    statusText = "Moderate";
    badgeClass = "status-badge badge-warn";
  } else {
    color = "#dc2626";
    statusText = "Refill Now";
    badgeClass = "status-badge badge-err";
  }

  circle.style.stroke = color;
  text.textContent = pct + "%";
  text.style.fill = color;
  badge.textContent = statusText;
  badge.className = badgeClass;
  if (prog) {
    prog.style.width = pct + "%";
    prog.style.background = color;
  }
  if (fl) fl.textContent = pct + "%";
  if (heroLv) heroLv.textContent = pct + "%";

  // Dynamic Estimation logic
  const capLabel = document.getElementById("est-cap");
  const mealLabel = document.getElementById("est-meals");
  const foodStatLabel = document.getElementById("food-status-txt");
  if (capLabel) capLabel.textContent = ((pct / 100) * 3.5).toFixed(1) + "L";
  if (mealLabel) mealLabel.textContent = "~" + Math.round((pct / 100) * 60);
  if (foodStatLabel) {
    foodStatLabel.textContent = statusText;
    foodStatLabel.style.color = color;
  }

  const avg = document.getElementById("stat-avg");
  if (avg) avg.textContent = pct + "%";
}

/* ── Water ─────────────────────────────────────────────────────── */
function setWater(pct) {
  const fill = document.getElementById("water-fill");
  const label = document.getElementById("water-label");
  if (fill) fill.style.height = pct + "%";
  if (label) label.textContent = pct + "%";
}

/* ── Load Cell ─────────────────────────────────────────────────── */
function setLoadcellStatus(data) {
  const lbl = document.getElementById("last-dispensed-weight");
  const actual = document.getElementById("actual-weight-display");
  const variance = document.getElementById("weight-variance");
  const badge = document.getElementById("dispense-status-badge");
  const chk = document.getElementById("dispense-check");
  const ir = document.getElementById("ir-status");
  const lcs = document.getElementById("loadcell-status");

  // IR Status
  if (ir) {
    if (data.jammed === true) {
      ir.textContent = "Blocked";
      ir.style.color = "var(--red)";
    } else {
      ir.textContent = "Clear";
      ir.style.color = "var(--green)";
    }
  }

  // Load cell values
  if (data.last_dispensed_g !== undefined && data.last_dispensed_g !== null) {
    const rawVal = Math.max(0, data.last_dispensed_g); // prevent negative from scale tare noise
    const val = rawVal.toFixed(1);
    if (lbl) lbl.textContent = val + "g";
    if (actual) actual.textContent = val + "g";

    // Assuming target is ~50g or generic comparison
    const diff = (rawVal - 50.0);
    const diffStr = Math.abs(diff) < 0.1 ? "0.0g" : (diff > 0 ? "+" : "") + diff.toFixed(1) + "g";
    if (variance) {
      variance.textContent = diffStr;
      variance.style.color = diff < -2.0 ? "var(--red)" : (diff > 2.0 ? "var(--amber)" : "var(--text-secondary)");
    }

    if (lcs) lcs.textContent = "Active";
  }

  // Dispense Success Status
  if (data.dispense_success === true) {
    if (badge) {
      badge.textContent = "Verified";
      badge.className = "badge badge-ok";
    }
    if (chk) {
      chk.className = "dispense-check";
      chk.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`;
    }
  } else if (data.dispense_success === false) {
    if (badge) {
      badge.textContent = "Incomplete";
      badge.className = "badge badge-warn";
    }
    if (chk) {
      chk.className = "dispense-check failed";
      chk.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
    }
  } else {
    if (badge) {
      badge.textContent = "Waiting";
      badge.className = "badge badge-normal";
      badge.style.background = "var(--bg-subtle)";
      badge.style.color = "var(--text-secondary)";
    }
    if (chk) {
      chk.className = "dispense-check none";
      chk.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
    }
  }
}

/* ── Socket.io ─────────────────────────────────────────────────── */
let socket;
try {
  socket = io({ transports: ["websocket", "polling"] });

  socket.on("connect", () => {
    console.log("[Socket.io] Connected —", socket.id);
    setConnectionStatus(true);
  });
  socket.on("disconnect", () => {
    console.warn("[Socket.io] Disconnected");
    setConnectionStatus(false);
  });
  socket.on("connect_error", () => setConnectionStatus(false));

  socket.on("status", (data) => {
    if (data.food_level != null) setGauge(data.food_level);
    setLoadcellStatus(data);

    const alertBox = document.getElementById("jam-alert-box");
    const alertTxt = document.getElementById("jam-alert");
    const badge = document.getElementById("alert-count-badge");

    if (data.jammed) {
      alertBox.className = "alert-box alert-err";
      alertTxt.textContent = "MECHANICAL JAM — please inspect immediately.";
      badge.textContent = "1 Alert";
      badge.className = "badge badge-err";
      appendLog("err", "Mechanical jam detected");
      document.getElementById("notif-badge").style.display = "";
    } else {
      alertBox.className = "alert-box alert-ok";
      alertTxt.textContent = "System operating normally — no issues detected.";
      badge.textContent = "All Clear";
      badge.className = "badge badge-ok";
    }
  });

  socket.on("feeding_done", (data) => {
    const btn = document.getElementById("feed-btn");
    btn.classList.remove("feeding");
    btn.disabled = false;
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M6 20h12"/><path d="M6 14h12"/><path d="M12 2c-.94 1.24-3 4.08-3 6.5S10.34 12 12 12s3-1.02 3-3.5S12.94 3.24 12 2z"/></svg> Dispense Food Now`;
    feedCount++;
    document.getElementById("stat-today").textContent = feedCount;
    const heroF = document.getElementById("hero-feedings");
    if (heroF) heroF.textContent = feedCount;
    const t = new Date(data.timestamp).toLocaleTimeString([], {
      hour: "2-digit", minute: "2-digit",
    });
    document.getElementById("stat-last").textContent = t;
    const label = data.type === "scheduled" ? "Scheduled" : "Manual";
    appendLog("ok", `${label} dispense — ${data.portion_g}g at ${t}`);
    if (feedingChart) {
      const last = feedingChart.data.datasets[0].data;
      last[last.length - 1] = (last[last.length - 1] || 0) + 1;
      feedingChart.update();
    }
  });

  socket.on("alert", (data) => {
    appendLog(data.level === "error" ? "err" : "warn", data.message);
    document.getElementById("notif-badge").style.display = "";
  });

  socket.on("feedings_today", (data) => {
    if (data.count != null) {
      feedCount = data.count;
      document.getElementById("stat-today").textContent = feedCount;
      const heroF = document.getElementById("hero-feedings");
      if (heroF) heroF.textContent = feedCount;
    }
  });
} catch (_) {
  console.info("[PawFeed] Socket.io unavailable — demo mode");
  startDemoSimulation();
}

function setConnectionStatus(online) {
  const pill = document.getElementById("status-pill");
  const dot = document.getElementById("status-dot");
  const txt = document.getElementById("status-text");
  if (!pill) return;
  if (online) {
    pill.style.background = "var(--green-subtle)";
    pill.style.color = "var(--green)";
    dot.style.background = "var(--green)";
  } else {
    pill.style.background = "var(--red-subtle)";
    pill.style.color = "var(--red)";
    dot.style.background = "var(--red)";
  }
  if (txt) txt.textContent = online ? "Device Online" : "Device Offline";
}

/* ── Feed ──────────────────────────────────────────────────────── */
let feedCount = 3;

function feedPet(portion) {
  const btn = document.getElementById("feed-btn");
  btn.classList.add("feeding");
  btn.disabled = true;
  btn.textContent = "Dispensing…";

  if (socket && socket.connected) {
    socket.emit("feed", { portion: portion || 80, type: "manual" });
  } else {
    fetch("/feed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ portion: portion || 80 }),
    }).catch(() => {});

    setTimeout(() => {
      btn.classList.remove("feeding");
      btn.disabled = false;
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M6 20h12"/><path d="M6 14h12"/><path d="M12 2c-.94 1.24-3 4.08-3 6.5S10.34 12 12 12s3-1.02 3-3.5S12.94 3.24 12 2z"/></svg> Dispense Food Now`;
      feedCount++;
      document.getElementById("stat-today").textContent = feedCount;
      const heroF = document.getElementById("hero-feedings");
      if (heroF) heroF.textContent = feedCount;
      const t = new Date().toLocaleTimeString([], {
        hour: "2-digit", minute: "2-digit",
      });
      document.getElementById("stat-last").textContent = t;
      appendLog("ok", `Manual dispense — ${portion || 80}g at ${t}`);
    }, 1800);
  }
}

function dispenseHalf() { feedPet(40); }
function dispenseDouble() { feedPet(160); }

/* ── Simulate refill ──────────────────────────────────────────── */
function simulateRefill() {
  setGauge(98);
  appendLog("ok", "Hopper refilled to 100%");
}
function simulateWater() {
  setWater(95);
  appendLog("ok", "Water reservoir refilled");
}

/* ── Activity log ─────────────────────────────────────────────── */
function appendLog(type, msg) {
  const list = document.getElementById("log-list");
  if (!list) return;
  const now = new Date().toLocaleTimeString([], {
    hour: "2-digit", minute: "2-digit",
  });
  const item = document.createElement("div");
  item.className = `log-item log-${type}`;
  item.innerHTML = `<span class="log-time">${now}</span><span class="log-msg">${msg}</span>`;
  list.insertBefore(item, list.firstChild);
  if (list.children.length > 20) list.removeChild(list.lastChild);
}

function clearLog() {
  const list = document.getElementById("log-list");
  if (list) list.innerHTML = "";
}

/* ── Schedule ─────────────────────────────────────────────────── */
function addSchedulePrompt() {
  const t = prompt("Enter time (e.g. 08:00 AM):");
  if (!t) return;
  const list = document.getElementById("schedule-list");
  const item = document.createElement("div");
  item.className = "schedule-item";
  item.innerHTML = `
    <div>
      <div class="schedule-time">${t}</div>
      <div class="schedule-info">Custom &middot; 80g &middot; Every day</div>
    </div>
    <label class="toggle"><input type="checkbox" checked><span class="toggle-track"></span></label>`;
  list.appendChild(item);
  appendLog("ok", `New schedule added: ${t}`);
}

/* ── Charts ───────────────────────────────────────────────────── */
Chart.defaults.font.family = "'Plus Jakarta Sans', sans-serif";
Chart.defaults.color = "#6b7280";

const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const feedData = [3, 3, 4, 3, 3, 4, 3];
let feedingChart, levelChart, mealChart;

function getChartTheme() {
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  return {
    isDark,
    grid: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)",
    tick: isDark ? "#52525b" : "#9ca3af",
    surface: isDark ? "#121215" : "#ffffff",
  };
}

function buildCharts() {
  const t = getChartTheme();

  const baseScales = (yExtra = {}) => ({
    x: {
      grid: { color: t.grid, drawBorder: false },
      border: { display: false },
      ticks: { font: { size: 11 }, color: t.tick },
    },
    y: {
      grid: { color: t.grid, drawBorder: false },
      border: { display: false },
      ticks: { font: { size: 11 }, color: t.tick },
      ...yExtra,
    },
  });

  // Bar chart
  feedingChart = new Chart(document.getElementById("feedingChart"), {
    type: "bar",
    data: {
      labels: days,
      datasets: [{
        label: "Feedings",
        data: feedData,
        backgroundColor: (ctx) => {
          const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, 180);
          g.addColorStop(0, "rgba(99,102,241,0.9)");
          g.addColorStop(1, "rgba(99,102,241,0.35)");
          return g;
        },
        borderRadius: 4,
        borderSkipped: false,
        barPercentage: 0.6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { padding: 10, cornerRadius: 6, displayColors: false },
      },
      scales: baseScales({ min: 0, max: 6, ticks: { stepSize: 1, color: t.tick } }),
    },
  });

  // Line chart
  levelChart = new Chart(document.getElementById("levelChart"), {
    type: "line",
    data: {
      labels: days,
      datasets: [{
        label: "Food Level %",
        data: [95, 72, 88, 60, 80, 55, 72],
        borderColor: "#059669",
        backgroundColor: (ctx) => {
          const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, 180);
          g.addColorStop(0, "rgba(5,150,105,0.14)");
          g.addColorStop(1, "rgba(5,150,105,0.0)");
          return g;
        },
        fill: true,
        tension: 0.4,
        pointBackgroundColor: "#059669",
        pointBorderColor: t.surface,
        pointBorderWidth: 2,
        pointRadius: 3.5,
        pointHoverRadius: 5,
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { padding: 10, cornerRadius: 6, displayColors: false },
      },
      scales: baseScales({
        min: 0, max: 100,
        ticks: { callback: (v) => v + "%", color: t.tick },
      }),
    },
  });

  // Doughnut
  mealChart = new Chart(document.getElementById("mealChart"), {
    type: "doughnut",
    data: {
      labels: ["Morning", "Afternoon", "Evening", "Manual"],
      datasets: [{
        data: [33, 33, 27, 7],
        backgroundColor: ["#6366f1", "#059669", "#d97706", "#e11d48"],
        borderWidth: 3,
        borderColor: t.surface,
        hoverOffset: 4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          padding: 10, cornerRadius: 6, displayColors: false,
          callbacks: { label: (ctx) => ` ${ctx.label}: ${ctx.parsed}%` },
        },
      },
      cutout: "72%",
    },
  });
}

function updateChartColors() {
  const t = getChartTheme();
  [feedingChart, levelChart].forEach((c) => {
    if (!c) return;
    c.options.scales.x.grid.color = t.grid;
    c.options.scales.y.grid.color = t.grid;
    c.options.scales.x.ticks.color = t.tick;
    c.options.scales.y.ticks.color = t.tick;
    c.update();
  });
  if (mealChart) {
    mealChart.data.datasets[0].borderColor = t.surface;
    mealChart.update();
  }
  if (levelChart) {
    levelChart.data.datasets[0].pointBorderColor = t.surface;
    levelChart.update();
  }
}

/* ── Demo simulation ──────────────────────────────────────────── */
function startDemoSimulation() {
  let mockLevel = 72;
  setInterval(() => {
    mockLevel = Math.max(5, Math.min(100, mockLevel + (Math.random() > 0.7 ? -1 : 0)));
    setGauge(mockLevel);
  }, 4000);
}

/* ── Init ──────────────────────────────────────────────────────── */
window.addEventListener("DOMContentLoaded", async () => {
  setGauge(72);
  setWater(65);
  buildCharts();

  try {
    const todayRes = await fetch("/feedings/today");
    if (todayRes.ok) {
      const today = await todayRes.json();
      if (today.count != null) {
        feedCount = today.count;
        document.getElementById("stat-today").textContent = feedCount;
        const heroF = document.getElementById("hero-feedings");
        if (heroF) heroF.textContent = feedCount;
      }
    }

    const weekRes = await fetch("/feedings/weekly");
    if (weekRes.ok && feedingChart) {
      const weekData = await weekRes.json();
      if (weekData.length) {
        const today = new Date();
        const dayLabels = [];
        const counts = [];
        for (let i = 6; i >= 0; i--) {
          const d = new Date(today);
          d.setDate(d.getDate() - i);
          const iso = d.toISOString().slice(0, 10);
          const match = weekData.find((r) => r.day === iso);
          dayLabels.push(d.toLocaleDateString("en-US", { weekday: "short" }));
          counts.push(match ? match.count : 0);
        }
        feedingChart.data.labels = dayLabels;
        feedingChart.data.datasets[0].data = counts;
        feedingChart.update();
      }
    }

    const sensorRes = await fetch("/sensor/history");
    if (sensorRes.ok && levelChart) {
      const sensorData = await sensorRes.json();
      if (sensorData.length) {
        levelChart.data.labels = sensorData.map((r) => r.day.slice(5));
        levelChart.data.datasets[0].data = sensorData.map((r) => r.avg_food);
        levelChart.update();
      }
    }

    const statusRes = await fetch("/status");
    if (statusRes.ok) {
      const s = await statusRes.json();
      setGauge(s.food_level);
      setLoadcellStatus(s);
    }

    const schedRes = await fetch("/schedules");
    if (schedRes.ok) {
      const schedules = await schedRes.json();
      renderSchedules(schedules);
    }
  } catch (_) {
    startDemoSimulation();
  }

  // Uptime counter (no hero-uptime in new layout; safe check)
  const uptimeEl = document.getElementById("hero-uptime");
  if (uptimeEl) {
    let minutes = 12 * 60;
    setInterval(() => {
      minutes++;
      uptimeEl.textContent = Math.floor(minutes / 60) + "h";
    }, 60000);
  }
});

/* ── Render schedules from server  ────────────────────────────── */
function renderSchedules(schedules) {
  if (!schedules || !schedules.length) return;
  const list = document.getElementById("schedule-list");
  list.innerHTML = "";
  schedules.forEach((s) => {
    const [hh, mm] = s.time.split(":").map(Number);
    const ampm = hh >= 12 ? "PM" : "AM";
    const h12 = (hh % 12 || 12).toString().padStart(2, "0");
    const displayTime = `${h12}:${mm.toString().padStart(2, "0")} ${ampm}`;
    const item = document.createElement("div");
    item.className = "schedule-item";
    item.dataset.id = s.id;
    item.innerHTML = `
      <div>
        <div class="schedule-time">${displayTime}</div>
        <div class="schedule-info">${s.label} &middot; ${s.portion_g}g &middot; ${s.days.charAt(0).toUpperCase() + s.days.slice(1)}</div>
      </div>
      <label class="toggle">
        <input type="checkbox" ${s.enabled ? "checked" : ""} onchange="toggleSchedule(${s.id}, this.checked)">
        <span class="toggle-track"></span>
      </label>`;
    list.appendChild(item);
  });
}

function toggleSchedule(id, enabled) {
  fetch(`/schedules/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  }).catch(() => {});
}

// Override addSchedulePrompt to persist to server
function addSchedulePrompt() {
  const t = prompt("Enter time (e.g. 08:00 AM):");
  if (!t) return;
  const label = prompt("Label (e.g. Snack):") || "Custom";
  const match = t.match(/(\d+):(\d+)\s*(AM|PM)/i);
  let time24 = t;
  if (match) {
    let h = parseInt(match[1]);
    const m = match[2];
    const p = match[3].toUpperCase();
    if (p === "PM" && h !== 12) h += 12;
    if (p === "AM" && h === 12) h = 0;
    time24 = `${h.toString().padStart(2, "0")}:${m}`;
  }
  fetch("/schedules", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label, time: time24, portion_g: 80, days: "daily" }),
  })
    .then((r) => (r.ok ? r.json() : null))
    .then((s) => { if (s) renderSchedules([s]); })
    .catch(() => {});
  appendLog("ok", `New schedule added: ${t}`);
}
