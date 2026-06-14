const state = {
  user: null,
  issues: [],
  staff: [],
  activities: [],
  announcements: [],
  activePage: ""
};

const roleMap = {
  resident: "居民",
  staff: "社区工作人员",
  manager: "街道/管理者"
};

const statusMap = {
  pending: "待受理",
  accepted: "已受理",
  assigned: "处理中",
  done: "已办结"
};

const $ = (selector) => document.querySelector(selector);
let toastTimer = null;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const contentType = response.headers.get("Content-Type") || "";
  const data = contentType.includes("application/json")
    ? await response.json()
    : { error: await response.text() };
  if (!response.ok) throw new Error(data.error || "操作失败");
  return data;
}

function toast(message, type = "success") {
  const el = $("#toast");
  clearTimeout(toastTimer);
  el.textContent = message;
  el.classList.remove("toast-success", "toast-error");
  el.classList.add(type === "error" ? "toast-error" : "toast-success");
  el.classList.remove("hidden");
  toastTimer = setTimeout(() => el.classList.add("hidden"), 4200);
}

function setButtonBusy(button, busy, busyText = "处理中...") {
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = busyText;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
    delete button.dataset.originalText;
  }
}

function setFormBusy(form, busy, busyText = "提交中...") {
  const button = form.querySelector('button[type="submit"]');
  if (button) setButtonBusy(button, busy, busyText);
}

function dateText(value) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(new Date(value));
}

function setAuthTab(tab) {
  document.querySelectorAll("[data-auth-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.authTab === tab);
  });
  $("#loginForm").classList.toggle("hidden", tab !== "login");
  $("#registerForm").classList.toggle("hidden", tab !== "register");
  $("#authMessage").textContent = "";
}

function showApp(user) {
  state.user = user;
  $("#authView").classList.add("hidden");
  $("#appView").classList.remove("hidden");
  $("#logoutBtn").classList.remove("hidden");
  $("#welcomeText").textContent = `${user.name}，欢迎使用邻里通`;
  $("#roleText").textContent = roleMap[user.role];
  document.querySelectorAll(".role-view").forEach((view) => view.classList.add("hidden"));
  $(`#${user.role}View`).classList.remove("hidden");
  renderNav();
  showPage(defaultPageForRole(user.role));
}

function showAuth() {
  state.user = null;
  $("#authView").classList.remove("hidden");
  $("#appView").classList.add("hidden");
  $("#logoutBtn").classList.add("hidden");
}

function renderNav() {
  const nav = {
    resident: [
      { key: "issues", label: "诉求进度" },
      { key: "activities", label: "活动报名" },
      { key: "announcements", label: "社区公告" }
    ],
    staff: [
      { key: "acceptIssues", label: "事项受理" },
      { key: "assignIssues", label: "分派任务" },
      { key: "announcementManage", label: "发布公告" },
      { key: "activityManage", label: "发布活动" }
    ],
    manager: [
      { key: "stats", label: "数据统计" },
      { key: "hotIssues", label: "高频问题" },
      { key: "governanceEffect", label: "效果评估" }
    ]
  }[state.user.role];
  $("#navTabs").innerHTML = nav.map((tab) => `<button class="tab" data-page-tab="${tab.key}">${tab.label}</button>`).join("");
}

function defaultPageForRole(role) {
  return {
    resident: "issues",
    staff: "acceptIssues",
    manager: "stats"
  }[role];
}

function showPage(pageKey) {
  state.activePage = pageKey;
  const roleView = $(`#${state.user.role}View`);
  roleView.querySelectorAll(".page").forEach((page) => {
    page.classList.toggle("hidden", page.dataset.page !== pageKey);
  });
  document.querySelectorAll("[data-page-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.pageTab === pageKey);
  });
}

function issueCard(issue, editable = false) {
  const updates = issue.updates.map((update) => `
    <li>
      <span>${dateText(update.at)}</span>
      <p>${escapeHtml(update.text)}</p>
    </li>`).join("");
  const staffOptions = state.staff.map((staff) => `<option value="${escapeHtml(staff.id)}" ${staff.id === issue.assigneeId ? "selected" : ""}>${escapeHtml(staff.name)}</option>`).join("");
  const controls = editable ? `
    <div class="actions" data-issue-actions="${issue.id}">
      <select data-field="status">
        ${Object.entries(statusMap).map(([value, text]) => `<option value="${value}" ${value === issue.status ? "selected" : ""}>${text}</option>`).join("")}
      </select>
      <select data-field="assigneeId">
        <option value="">暂不分派</option>
        ${staffOptions}
      </select>
      <textarea data-field="updateText" rows="2" placeholder="填写处理进展"></textarea>
      <button data-update-issue="${issue.id}">更新处理状态</button>
    </div>` : "";
  return `
    <article class="item">
      <div class="item-head">
        <strong>${escapeHtml(issue.title)}</strong>
        <span class="badge">${escapeHtml(issue.statusText)}</span>
      </div>
      <p class="muted">${escapeHtml(issue.category)} · ${escapeHtml(issue.creatorName)}${issue.assigneeName ? ` · 负责人：${escapeHtml(issue.assigneeName)}` : ""}</p>
      <p>${escapeHtml(issue.description)}</p>
      <div class="issue-meta">
        <span>当前状态：${escapeHtml(issue.statusText)}</span>
        <span>最近更新：${dateText(issue.updatedAt || issue.createdAt)}</span>
      </div>
      <ol class="timeline">${updates}</ol>
      ${controls}
    </article>`;
}

function renderIssues() {
  const empty = "<p class=\"muted\">暂无数据</p>";
  if (state.user.role === "resident") {
    $("#residentIssues").innerHTML = state.issues.map((issue) => issueCard(issue)).join("") || empty;
  }
  if (state.user.role === "staff") {
    const acceptIssues = state.issues.filter((issue) => ["pending", "accepted"].includes(issue.status));
    const assignIssues = state.issues.filter((issue) => issue.status === "assigned" || issue.assigneeId);
    $("#acceptIssues").innerHTML = acceptIssues.map((issue) => issueCard(issue, true)).join("") || empty;
    $("#assignIssues").innerHTML = assignIssues.map((issue) => issueCard(issue, true)).join("") || empty;
  }
  if (state.user.role === "manager") {
    $("#managerIssues").innerHTML = state.issues.map((issue) => issueCard(issue, true)).join("") || empty;
  }
}

function activityCard(activity, options = {}) {
  const canJoin = Boolean(options.canJoin);
  const canDelete = Boolean(options.canDelete);
  const joined = canJoin && activity.participants.includes(state.user.id);
  return `
    <article class="item">
      <div class="item-head">
        <strong>${escapeHtml(activity.title)}</strong>
        <span class="badge">${activity.participants.length}/${activity.capacity}</span>
      </div>
      <p class="muted">活动日期：${escapeHtml(activity.date)}</p>
      <p class="muted">活动地点：${escapeHtml(activity.location)}</p>
      <p class="muted">剩余名额：${Math.max(activity.capacity - activity.participants.length, 0)}</p>
      ${canJoin ? `<button data-join="${activity.id}" ${joined ? "disabled" : ""}>${joined ? "已报名" : "报名"}</button>` : ""}
      ${canDelete ? `<button class="danger" data-delete-activity="${activity.id}">删除活动</button>` : ""}
    </article>`;
}

function renderActivities() {
  const empty = "<p class=\"muted\">暂无活动</p>";
  if (state.user.role === "resident") {
    $("#activities").innerHTML = state.activities.map((activity) => activityCard(activity, { canJoin: true })).join("") || empty;
  }
  if (state.user.role === "staff") {
    $("#staffActivities").innerHTML = state.activities.map((activity) => activityCard(activity, { canDelete: true })).join("") || empty;
  }
}

function renderAnnouncements() {
  $("#announcements").innerHTML = state.announcements.map((item) => `
    <article class="item">
      <div class="item-head">
        <strong>${escapeHtml(item.title)}</strong>
        <span class="badge">${dateText(item.createdAt)}</span>
      </div>
      <p class="muted">发布时间：${dateText(item.createdAt)}</p>
      <p>${escapeHtml(item.body)}</p>
    </article>`).join("");
}

function renderStats(stats) {
  $("#statsCards").innerHTML = `
    <div class="stat"><span class="muted">诉求总量</span><strong>${stats.totalIssues}</strong></div>
    <div class="stat"><span class="muted">办结率</span><strong>${stats.doneRate}%</strong></div>
    <div class="stat"><span class="muted">处理中</span><strong>${stats.byStatus.assigned || 0}</strong></div>
    <div class="stat"><span class="muted">待受理</span><strong>${stats.byStatus.pending || 0}</strong></div>
  `;
  $("#effectCards").innerHTML = `
    <div class="stat"><span class="muted">已办结</span><strong>${stats.byStatus.done || 0}</strong></div>
    <div class="stat"><span class="muted">已受理</span><strong>${stats.byStatus.accepted || 0}</strong></div>
    <div class="stat"><span class="muted">活动数量</span><strong>${stats.activities.length}</strong></div>
    <div class="stat"><span class="muted">活动报名</span><strong>${stats.activities.reduce((sum, activity) => sum + activity.registered, 0)}</strong></div>
  `;
  $("#hotIssues").innerHTML = stats.highFrequency.map((item) => `
    <article class="item">
      <div class="item-head">
        <strong>${escapeHtml(item.category)}</strong>
        <span class="badge">${item.count} 件</span>
      </div>
    </article>`).join("") || "<p class=\"muted\">暂无高频问题</p>";
}

function replaceIssue(updatedIssue) {
  const index = state.issues.findIndex((issue) => issue.id === updatedIssue.id);
  if (index >= 0) {
    state.issues[index] = updatedIssue;
  } else {
    state.issues.unshift(updatedIssue);
  }
  renderIssues();
}

function replaceActivity(updatedActivity) {
  const index = state.activities.findIndex((activity) => activity.id === updatedActivity.id);
  if (index >= 0) {
    state.activities[index] = updatedActivity;
  } else {
    state.activities.unshift(updatedActivity);
  }
  renderActivities();
}

function removeActivity(activityId) {
  state.activities = state.activities.filter((activity) => activity.id !== activityId);
  renderActivities();
}

function addAnnouncement(announcement) {
  state.announcements.unshift(announcement);
  if (state.user.role === "resident") renderAnnouncements();
}

async function refreshData() {
  if (!state.user) return;
  const common = [
    api("/api/issues").then((data) => { state.issues = data.issues; })
  ];
  if (["resident", "staff"].includes(state.user.role)) {
    common.push(api("/api/activities").then((data) => { state.activities = data.activities; }));
  }
  if (state.user.role === "resident") {
    common.push(api("/api/announcements").then((data) => { state.announcements = data.announcements; }));
  }
  if (["staff", "manager"].includes(state.user.role)) {
    common.push(api("/api/staff").then((data) => { state.staff = data.staff; }));
  }
  await Promise.all(common);
  renderIssues();
  if (["resident", "staff"].includes(state.user.role)) {
    renderActivities();
  }
  if (state.user.role === "resident") {
    renderAnnouncements();
  }
  if (state.user.role === "manager") {
    const { stats } = await api("/api/stats");
    renderStats(stats);
  }
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

document.addEventListener("click", async (event) => {
  const authTab = event.target.closest("[data-auth-tab]");
  if (authTab) setAuthTab(authTab.dataset.authTab);

  const pageTab = event.target.closest("[data-page-tab]");
  if (pageTab) showPage(pageTab.dataset.pageTab);

  const demoButton = event.target.closest("[data-demo-role]");
  if (demoButton) {
    const form = $("#loginForm");
    form.email.value = "demo@linlitong.local";
    form.password.value = "demo123456";
    form.role.value = demoButton.dataset.demoRole;
    form.requestSubmit();
  }

  const joinButton = event.target.closest("[data-join]");
  if (joinButton) {
    try {
      setButtonBusy(joinButton, true, "报名中...");
      const { activity } = await api(`/api/activities/${joinButton.dataset.join}/join`, { method: "POST" });
      replaceActivity(activity);
      toast("报名成功，可在活动报名页查看报名状态");
    } catch (error) {
      toast(`报名失败：${error.message}`, "error");
    } finally {
      setButtonBusy(joinButton, false);
    }
  }

  const deleteActivityButton = event.target.closest("[data-delete-activity]");
  if (deleteActivityButton) {
    const confirmed = confirm("确认删除该活动？居民端将不再显示。");
    if (!confirmed) return;
    try {
      setButtonBusy(deleteActivityButton, true, "删除中...");
      const { activity } = await api(`/api/activities/${deleteActivityButton.dataset.deleteActivity}/delete`, { method: "POST" });
      removeActivity(activity.id);
      toast("活动已删除");
    } catch (error) {
      toast(`删除活动失败：${error.message}`, "error");
    } finally {
      setButtonBusy(deleteActivityButton, false);
    }
  }

  const updateButton = event.target.closest("[data-update-issue]");
  if (updateButton) {
    const wrap = document.querySelector(`[data-issue-actions="${updateButton.dataset.updateIssue}"]`);
    const body = Object.fromEntries([...wrap.querySelectorAll("[data-field]")].map((field) => [field.dataset.field, field.value]));
    try {
      setButtonBusy(updateButton, true, "更新中...");
      const { issue } = await api(`/api/issues/${updateButton.dataset.updateIssue}`, { method: "PATCH", body: JSON.stringify(body) });
      replaceIssue(issue);
      toast("处理状态已更新，居民端将同步看到最新进展");
    } catch (error) {
      toast(`更新失败：${error.message}`, "error");
    } finally {
      setButtonBusy(updateButton, false);
    }
  }
});

document.addEventListener("submit", async (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();

  if (form.id === "loginForm") {
    try {
      const { user } = await api("/api/login", { method: "POST", body: JSON.stringify(formData(form)) });
      showApp(user);
      refreshData().catch(() => toast("登录成功，但数据刷新失败，请稍后手动刷新页面", "error"));
      toast(`登录成功，当前身份：${roleMap[user.role]}`);
    } catch (error) {
      $("#authMessage").textContent = error.message;
      toast(`登录失败：${error.message}`, "error");
    }
  }

  if (form.id === "registerForm") {
    try {
      await api("/api/register", { method: "POST", body: JSON.stringify(formData(form)) });
      $("#authMessage").textContent = "注册成功，请使用邮箱和密码登录";
      setAuthTab("login");
      toast("注册成功，请使用邮箱和密码登录");
    } catch (error) {
      $("#authMessage").textContent = error.message;
      toast(`注册失败：${error.message}`, "error");
    }
  }

  if (form.id === "issueForm") {
    try {
      setFormBusy(form, true);
      const { issue } = await api("/api/issues", { method: "POST", body: JSON.stringify(formData(form)) });
      replaceIssue(issue);
      form.reset();
      showPage("issues");
      toast("诉求提交成功，已进入待受理状态");
    } catch (error) {
      toast(`提交失败：${error.message}`, "error");
    } finally {
      setFormBusy(form, false);
    }
  }

  if (form.id === "announcementForm") {
    try {
      setFormBusy(form, true, "发布中...");
      const { announcement } = await api("/api/announcements", { method: "POST", body: JSON.stringify(formData(form)) });
      addAnnouncement(announcement);
      form.reset();
      toast("公告发布成功，居民端可查看");
    } catch (error) {
      toast(`公告发布失败：${error.message}`, "error");
    } finally {
      setFormBusy(form, false);
    }
  }

  if (form.id === "activityForm") {
    try {
      setFormBusy(form, true, "发布中...");
      const { activity } = await api("/api/activities", { method: "POST", body: JSON.stringify(formData(form)) });
      replaceActivity(activity);
      form.reset();
      toast("活动发布成功，居民端可报名");
    } catch (error) {
      toast(`活动发布失败：${error.message}`, "error");
    } finally {
      setFormBusy(form, false);
    }
  }
});

$("#logoutBtn").addEventListener("click", async () => {
  try {
    await api("/api/logout", { method: "POST" });
    showAuth();
    toast("已退出登录");
  } catch (error) {
    toast(`退出失败：${error.message}`, "error");
  }
});

async function boot() {
  const { user } = await api("/api/me");
  if (user) {
    showApp(user);
    await refreshData();
  } else {
    showAuth();
  }
}

boot().catch(() => showAuth());
