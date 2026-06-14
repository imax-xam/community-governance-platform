const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "data", "db.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const SESSION_TTL_MS = 1000 * 60 * 60 * 24;
const sessions = new Map();
const DEMO_LOGIN_EMAIL = "demo@linlitong.local";
const DEMO_PASSWORD = "demo123456";
const demoProfiles = {
  resident: { id: "demo-resident", name: "演示居民", email: "demo+resident@linlitong.local" },
  staff: { id: "demo-staff", name: "演示工作人员", email: "demo+staff@linlitong.local" },
  manager: { id: "demo-manager", name: "演示管理者", email: "demo+manager@linlitong.local" }
};

const roles = new Set(["resident", "staff", "manager"]);
const statusLabels = {
  pending: "待受理",
  accepted: "已受理",
  assigned: "处理中",
  done: "已办结"
};

const seedData = {
  users: [],
  issues: [],
  announcements: [
    {
      id: "ann-1",
      title: "周六便民服务开放",
      body: "本周六上午 9:00-11:30，社区党群服务中心提供社保咨询、维修登记和法律咨询。",
      createdAt: new Date("2026-06-01T08:00:00.000Z").toISOString()
    }
  ],
  activities: [
    {
      id: "act-1",
      title: "邻里议事会",
      date: "2026-06-22",
      location: "社区活动室",
      capacity: 30,
      participants: []
    },
    {
      id: "act-2",
      title: "垃圾分类志愿服务",
      date: "2026-06-29",
      location: "幸福花园小区",
      capacity: 20,
      participants: []
    }
  ]
};

function sendJson(res, status, payload, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...headers
  });
  res.end(JSON.stringify(payload));
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

async function ensureStore() {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  let data;
  try {
    data = JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
  } catch {
    data = JSON.parse(JSON.stringify(seedData));
  }
  if (ensureDemoUsers(data)) await writeStore(data);
}

async function readStore() {
  await ensureStore();
  const raw = await fs.readFile(DATA_FILE, "utf8");
  return JSON.parse(raw);
}

async function writeStore(data) {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
}

function id(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const actual = hashPassword(password, salt).split(":")[1];
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(actual, "hex"));
}

function ensureDemoUsers(data) {
  let changed = false;
  for (const key of ["users", "issues", "announcements", "activities"]) {
    if (!Array.isArray(data[key])) {
      data[key] = [];
      changed = true;
    }
  }
  for (const role of roles) {
    const profile = demoProfiles[role];
    const existing = data.users.find((user) => user.id === profile.id);
    if (existing) continue;
    data.users.push({
      ...profile,
      role,
      passwordHash: hashPassword(DEMO_PASSWORD),
      createdAt: new Date("2026-06-14T00:00:00.000Z").toISOString(),
      demo: true
    });
    changed = true;
  }
  return changed;
}

function parseCookies(header = "") {
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([key, value]) => key && value)
      .map(([key, value]) => [key, decodeURIComponent(value)])
  );
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt
  };
}

async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("请求体必须是合法 JSON");
    error.status = 400;
    throw error;
  }
}

async function currentUser(req) {
  const token = parseCookies(req.headers.cookie).session;
  if (!token) return null;
  const session = sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  const data = await readStore();
  return data.users.find((user) => user.id === session.userId) || null;
}

function requireUser(user, res) {
  if (!user) {
    sendError(res, 401, "请先登录");
    return false;
  }
  return true;
}

function requireRole(user, res, allowed) {
  if (!requireUser(user, res)) return false;
  if (!allowed.includes(user.role)) {
    sendError(res, 403, "当前角色没有权限执行该操作");
    return false;
  }
  return true;
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function sanitizeIssue(issue, users) {
  const creator = users.find((user) => user.id === issue.createdBy);
  const assignee = users.find((user) => user.id === issue.assigneeId);
  return {
    ...issue,
    creatorName: creator?.name || "居民",
    assigneeName: assignee?.name || "",
    statusText: statusLabels[issue.status] || issue.status
  };
}

function buildStats(data) {
  const byStatus = {};
  const byCategory = {};
  for (const issue of data.issues) {
    byStatus[issue.status] = (byStatus[issue.status] || 0) + 1;
    byCategory[issue.category] = (byCategory[issue.category] || 0) + 1;
  }
  const highFrequency = Object.entries(byCategory)
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  const done = data.issues.filter((issue) => issue.status === "done").length;
  return {
    totalIssues: data.issues.length,
    doneRate: data.issues.length ? Math.round((done / data.issues.length) * 100) : 0,
    byStatus,
    highFrequency,
    activities: data.activities.map((activity) => ({
      title: activity.title,
      registered: activity.participants.length,
      capacity: activity.capacity
    }))
  };
}

async function handleApi(req, res, pathname) {
  const user = await currentUser(req);
  const method = req.method;

  if (method === "POST" && pathname === "/api/register") {
    const body = await parseBody(req);
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const name = String(body.name || "").trim();
    const role = String(body.role || "resident");
    if (!name || !validateEmail(email) || password.length < 6 || !roles.has(role)) {
      return sendError(res, 400, "请填写姓名、有效邮箱、至少 6 位密码，并选择合法角色");
    }
    const data = await readStore();
    if (data.users.some((item) => item.email === email)) {
      return sendError(res, 409, "该邮箱已注册");
    }
    const newUser = {
      id: id("user"),
      name,
      email,
      role,
      passwordHash: hashPassword(password),
      createdAt: new Date().toISOString()
    };
    data.users.push(newUser);
    await writeStore(data);
    return sendJson(res, 201, { user: publicUser(newUser) });
  }

  if (method === "POST" && pathname === "/api/login") {
    const body = await parseBody(req);
    const email = String(body.email || "").trim().toLowerCase();
    const loginRole = String(body.role || "resident");
    const data = await readStore();
    let found = data.users.find((item) => item.email === email);
    if (email === DEMO_LOGIN_EMAIL) {
      if (!roles.has(loginRole)) return sendError(res, 400, "请选择合法的登录身份");
      found = data.users.find((item) => item.id === demoProfiles[loginRole].id);
    }
    if (!found || !verifyPassword(String(body.password || ""), found.passwordHash)) {
      return sendError(res, 401, "邮箱或密码错误");
    }
    const token = crypto.randomBytes(24).toString("hex");
    sessions.set(token, { userId: found.id, expiresAt: Date.now() + SESSION_TTL_MS });
    return sendJson(res, 200, { user: publicUser(found) }, {
      "Set-Cookie": `session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=86400`
    });
  }

  if (method === "POST" && pathname === "/api/logout") {
    const token = parseCookies(req.headers.cookie).session;
    if (token) sessions.delete(token);
    return sendJson(res, 200, { ok: true }, {
      "Set-Cookie": "session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0"
    });
  }

  if (method === "GET" && pathname === "/api/me") {
    return sendJson(res, 200, { user: publicUser(user) });
  }

  if (method === "GET" && pathname === "/api/announcements") {
    const data = await readStore();
    return sendJson(res, 200, { announcements: data.announcements });
  }

  if (method === "POST" && pathname === "/api/announcements") {
    if (!requireRole(user, res, ["staff", "manager"])) return;
    const body = await parseBody(req);
    const title = String(body.title || "").trim();
    const bodyText = String(body.body || "").trim();
    if (!title || !bodyText) return sendError(res, 400, "公告标题和内容不能为空");
    const data = await readStore();
    const announcement = {
      id: id("ann"),
      title,
      body: bodyText,
      createdAt: new Date().toISOString()
    };
    data.announcements.unshift(announcement);
    await writeStore(data);
    return sendJson(res, 201, { announcement });
  }

  if (method === "GET" && pathname === "/api/activities") {
    const data = await readStore();
    return sendJson(res, 200, { activities: data.activities });
  }

  if (method === "POST" && pathname === "/api/activities") {
    if (!requireRole(user, res, ["staff", "manager"])) return;
    const body = await parseBody(req);
    const title = String(body.title || "").trim();
    const date = String(body.date || "").trim();
    const location = String(body.location || "").trim();
    const capacity = Number(body.capacity || 0);
    if (!title || !date || !location || !Number.isInteger(capacity) || capacity < 1) {
      return sendError(res, 400, "请填写活动标题、日期、地点和有效名额");
    }
    const data = await readStore();
    const activity = {
      id: id("act"),
      title,
      date,
      location,
      capacity,
      participants: [],
      createdBy: user.id,
      createdAt: new Date().toISOString()
    };
    data.activities.unshift(activity);
    await writeStore(data);
    return sendJson(res, 201, { activity });
  }

  if (method === "POST" && pathname.match(/^\/api\/activities\/[^/]+\/join$/)) {
    if (!requireRole(user, res, ["resident"])) return;
    const activityId = pathname.split("/")[3];
    const data = await readStore();
    const activity = data.activities.find((item) => item.id === activityId);
    if (!activity) return sendError(res, 404, "活动不存在");
    if (activity.participants.includes(user.id)) return sendError(res, 409, "你已报名该活动");
    if (activity.participants.length >= activity.capacity) return sendError(res, 409, "活动名额已满");
    activity.participants.push(user.id);
    await writeStore(data);
    return sendJson(res, 200, { activity });
  }

  if (method === "GET" && pathname === "/api/issues") {
    if (!requireUser(user, res)) return;
    const data = await readStore();
    const visible = user.role === "resident"
      ? data.issues.filter((issue) => issue.createdBy === user.id)
      : data.issues;
    return sendJson(res, 200, { issues: visible.map((issue) => sanitizeIssue(issue, data.users)) });
  }

  if (method === "POST" && pathname === "/api/issues") {
    if (!requireRole(user, res, ["resident"])) return;
    const body = await parseBody(req);
    const title = String(body.title || "").trim();
    const category = String(body.category || "其他").trim();
    const description = String(body.description || "").trim();
    if (!title || !description) return sendError(res, 400, "诉求标题和描述不能为空");
    const data = await readStore();
    const issue = {
      id: id("issue"),
      title,
      category,
      description,
      status: "pending",
      createdBy: user.id,
      assigneeId: "",
      updates: [{ at: new Date().toISOString(), text: "诉求已提交，等待社区受理" }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    data.issues.unshift(issue);
    await writeStore(data);
    return sendJson(res, 201, { issue: sanitizeIssue(issue, data.users) });
  }

  if (method === "PATCH" && pathname.match(/^\/api\/issues\/[^/]+$/)) {
    if (!requireRole(user, res, ["staff", "manager"])) return;
    const issueId = pathname.split("/")[3];
    const body = await parseBody(req);
    const data = await readStore();
    const issue = data.issues.find((item) => item.id === issueId);
    if (!issue) return sendError(res, 404, "诉求不存在");
    if (body.status && !Object.keys(statusLabels).includes(body.status)) {
      return sendError(res, 400, "状态值不合法");
    }
    if (body.status) issue.status = body.status;
    if (typeof body.assigneeId === "string") issue.assigneeId = body.assigneeId;
    const updateText = String(body.updateText || "").trim();
    if (updateText) issue.updates.push({ at: new Date().toISOString(), text: updateText });
    issue.updatedAt = new Date().toISOString();
    await writeStore(data);
    return sendJson(res, 200, { issue: sanitizeIssue(issue, data.users) });
  }

  if (method === "GET" && pathname === "/api/staff") {
    if (!requireRole(user, res, ["staff", "manager"])) return;
    const data = await readStore();
    return sendJson(res, 200, { staff: data.users.filter((item) => item.role === "staff").map(publicUser) });
  }

  if (method === "GET" && pathname === "/api/stats") {
    if (!requireRole(user, res, ["manager"])) return;
    const data = await readStore();
    return sendJson(res, 200, { stats: buildStats(data) });
  }

  sendError(res, 404, "接口不存在");
}

async function serveStatic(req, res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!filePath.startsWith(PUBLIC_DIR)) return sendError(res, 403, "拒绝访问");
  try {
    const content = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    const types = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8"
    };
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
    res.end(content);
  } catch {
    res.writeHead(302, { Location: "/" });
    res.end();
  }
}

function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.pathname.startsWith("/api/")) {
        await handleApi(req, res, url.pathname);
      } else {
        await serveStatic(req, res, url.pathname);
      }
    } catch (error) {
      sendError(res, error.status || 500, error.message || "服务器内部错误");
    }
  });
}

if (require.main === module) {
  createServer().listen(PORT, HOST, () => {
    console.log(`邻里通已启动：http://${HOST}:${PORT}`);
  });
}

module.exports = { createServer, buildStats };
