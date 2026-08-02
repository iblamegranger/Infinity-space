const express = require('express');
const session = require('express-session');
const multer = require('multer');
const TelegramBot = require('node-telegram-bot-api');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs-extra');
const path = require('path');
const mime = require('mime-types');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== CONFIG =====
const BOT_TOKEN = process.env.BOT_TOKEN || '8354988814:AAFb45c6SUWPQAdKqLK_xM63GPTlddJB3u8';
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || '8494250384';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const DEFAULT_STORAGE_MB = 500; // default quota per user in MB
const SESSION_SECRET = process.env.SESSION_SECRET || 'infinity-space-secret-key-change-me';

// Ensure dirs
fs.ensureDirSync(DATA_DIR);
fs.ensureDirSync(UPLOADS_DIR);

// ===== USERS DB (simple JSON) =====
function loadUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      return fs.readJsonSync(USERS_FILE);
    }
  } catch (e) {
    console.error('Error loading users:', e);
  }
  return {};
}

function saveUsers(users) {
  fs.writeJsonSync(USERS_FILE, users, { spaces: 2 });
}

let users = loadUsers();

// Create default admin if none
if (!users['admin']) {
  users['admin'] = {
    passwordHash: bcrypt.hashSync('admin123', 10),
    role: 'admin',
    createdAt: new Date().toISOString(),
    expiresAt: null, // never
    storageQuotaMB: 5000,
    deviceId: uuidv4(),
    spaces: {
      'default': {
        id: 'default',
        name: 'Main Space',
        createdAt: new Date().toISOString(),
        files: []
      }
    },
    lastLogin: null,
    status: 'active'
  };
  saveUsers(users);
  console.log('Default admin created: username=admin password=admin123');
}

// ===== TELEGRAM BOT =====
let bot = null;
try {
  bot = new TelegramBot(BOT_TOKEN, { polling: true });
  console.log('Telegram bot started');

  bot.onText(/\/start/, (msg) => {
    if (String(msg.chat.id) !== String(ADMIN_CHAT_ID)) {
      return bot.sendMessage(msg.chat.id, '⛔ Unauthorized. Admin only.');
    }
    bot.sendMessage(msg.chat.id, `🚀 *Infinity Space Admin Bot*\n\nCommands:\n/createuser <username> <password> <days> [quota_mb]\n/listusers\n/status <username>\n/deleteuser <username>\n/resetpass <username> <newpass>\n/extend <username> <days>\n/help`, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/help/, (msg) => {
    if (String(msg.chat.id) !== String(ADMIN_CHAT_ID)) return;
    bot.sendMessage(msg.chat.id, `*Commands:*\n\n/createuser username password days [quota_mb]\nExample: /createuser john secret123 30 1000\n\n/listusers - list all users\n/status username - user details\n/deleteuser username\n/resetpass username newpassword\n/extend username days\n/broadcast message`, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/createuser (.+)/, async (msg, match) => {
    if (String(msg.chat.id) !== String(ADMIN_CHAT_ID)) return;
    const parts = match[1].trim().split(/\s+/);
    if (parts.length < 3) {
      return bot.sendMessage(msg.chat.id, 'Usage: /createuser <username> <password> <days> [quota_mb]');
    }
    const [username, password, daysStr, quotaStr] = parts;
    const days = parseInt(daysStr) || 30;
    const quota = parseInt(quotaStr) || DEFAULT_STORAGE_MB;

    if (users[username]) {
      return bot.sendMessage(msg.chat.id, `❌ User "${username}" already exists.`);
    }

    const expiresAt = days > 0 ? new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString() : null;
    const deviceId = uuidv4();
    const spaceId = uuidv4().slice(0, 8);

    users[username] = {
      passwordHash: bcrypt.hashSync(password, 10),
      role: 'user',
      createdAt: new Date().toISOString(),
      expiresAt,
      storageQuotaMB: quota,
      deviceId,
      spaces: {
        [spaceId]: {
          id: spaceId,
          name: 'Space 1',
          createdAt: new Date().toISOString(),
          files: []
        }
      },
      lastLogin: null,
      status: 'active'
    };
    saveUsers(users);

    // Create user dir
    fs.ensureDirSync(path.join(UPLOADS_DIR, username));

    bot.sendMessage(msg.chat.id, `✅ User created!\nUsername: \`${username}\`\nPassword: \`${password}\`\nExpires: ${expiresAt ? expiresAt.slice(0,10) : 'Never'}\nQuota: ${quota} MB\nDevice ID: \`${deviceId}\``, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/listusers/, (msg) => {
    if (String(msg.chat.id) !== String(ADMIN_CHAT_ID)) return;
    const list = Object.keys(users).map(u => {
      const user = users[u];
      const exp = user.expiresAt ? user.expiresAt.slice(0,10) : 'Never';
      const used = getUsedStorageMB(u);
      return `• ${u} [${user.status}] ${used}/${user.storageQuotaMB}MB exp:${exp}`;
    }).join('\n') || 'No users';
    bot.sendMessage(msg.chat.id, `📋 *Users:*\n${list}`, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/status (.+)/, (msg, match) => {
    if (String(msg.chat.id) !== String(ADMIN_CHAT_ID)) return;
    const username = match[1].trim();
    const user = users[username];
    if (!user) return bot.sendMessage(msg.chat.id, 'User not found');
    const used = getUsedStorageMB(username);
    const spacesCount = Object.keys(user.spaces || {}).length;
    bot.sendMessage(msg.chat.id, `👤 *${username}*\nRole: ${user.role}\nStatus: ${user.status}\nCreated: ${user.createdAt.slice(0,10)}\nExpires: ${user.expiresAt ? user.expiresAt.slice(0,10) : 'Never'}\nStorage: ${used} / ${user.storageQuotaMB} MB\nDevice ID: \`${user.deviceId}\`\nSpaces: ${spacesCount}\nLast Login: ${user.lastLogin || 'Never'}`, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/deleteuser (.+)/, (msg, match) => {
    if (String(msg.chat.id) !== String(ADMIN_CHAT_ID)) return;
    const username = match[1].trim();
    if (username === 'admin') return bot.sendMessage(msg.chat.id, 'Cannot delete admin');
    if (!users[username]) return bot.sendMessage(msg.chat.id, 'User not found');
    delete users[username];
    saveUsers(users);
    // optionally remove files
    fs.removeSync(path.join(UPLOADS_DIR, username));
    bot.sendMessage(msg.chat.id, `🗑 User "${username}" deleted.`);
  });

  bot.onText(/\/resetpass (.+)/, (msg, match) => {
    if (String(msg.chat.id) !== String(ADMIN_CHAT_ID)) return;
    const parts = match[1].trim().split(/\s+/);
    if (parts.length < 2) return bot.sendMessage(msg.chat.id, 'Usage: /resetpass <username> <newpassword>');
    const [username, newpass] = parts;
    if (!users[username]) return bot.sendMessage(msg.chat.id, 'User not found');
    users[username].passwordHash = bcrypt.hashSync(newpass, 10);
    saveUsers(users);
    bot.sendMessage(msg.chat.id, `🔑 Password reset for ${username}`);
  });

  bot.onText(/\/extend (.+)/, (msg, match) => {
    if (String(msg.chat.id) !== String(ADMIN_CHAT_ID)) return;
    const parts = match[1].trim().split(/\s+/);
    if (parts.length < 2) return bot.sendMessage(msg.chat.id, 'Usage: /extend <username> <days>');
    const [username, daysStr] = parts;
    const days = parseInt(daysStr) || 30;
    if (!users[username]) return bot.sendMessage(msg.chat.id, 'User not found');
    const current = users[username].expiresAt ? new Date(users[username].expiresAt) : new Date();
    const newExp = new Date(Math.max(current.getTime(), Date.now()) + days * 86400000);
    users[username].expiresAt = newExp.toISOString();
    users[username].status = 'active';
    saveUsers(users);
    bot.sendMessage(msg.chat.id, `⏳ Extended ${username} by ${days} days. New expiry: ${newExp.toISOString().slice(0,10)}`);
  });

  bot.on('polling_error', (err) => {
    console.error('Telegram polling error:', err.message);
  });

} catch (e) {
  console.error('Bot init failed:', e.message);
}

// Helper: notify admin
function notifyAdmin(text) {
  if (bot) {
    bot.sendMessage(ADMIN_CHAT_ID, text).catch(() => {});
  }
}

// Storage helpers
function getUserDir(username) {
  return path.join(UPLOADS_DIR, username);
}

function getUsedStorageMB(username) {
  const dir = getUserDir(username);
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  function walk(d) {
    const items = fs.readdirSync(d);
    for (const item of items) {
      const full = path.join(d, item);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) walk(full);
      else total += stat.size;
    }
  }
  try { walk(dir); } catch (e) {}
  return Math.round((total / (1024 * 1024)) * 100) / 100;
}

function isExpired(user) {
  if (!user.expiresAt) return false;
  return new Date(user.expiresAt) < new Date();
}

// ===== MIDDLEWARE =====
app.use(cors({ origin: true, credentials: true }));
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000, secure: false }
}));

app.use(express.static(path.join(__dirname, 'public')));

// Auth middleware
function requireAuth(req, res, next) {
  if (!req.session.username || !users[req.session.username]) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const user = users[req.session.username];
  if (isExpired(user)) {
    user.status = 'expired';
    saveUsers(users);
    req.session.destroy();
    return res.status(403).json({ error: 'Account expired. Contact admin.' });
  }
  if (user.status !== 'active') {
    return res.status(403).json({ error: 'Account inactive' });
  }
  req.user = user;
  req.username = req.session.username;
  next();
}

// ===== AUTH ROUTES =====
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing credentials' });

  const user = users[username];
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  if (isExpired(user)) {
    user.status = 'expired';
    saveUsers(users);
    return res.status(403).json({ error: 'Account has expired. Contact admin via Telegram.' });
  }

  req.session.username = username;
  user.lastLogin = new Date().toISOString();
  user.status = 'active';
  saveUsers(users);

  notifyAdmin(`🟢 Login: *${username}*\nDeviceID: \`${user.deviceId}\`\nIP: ${req.ip}`, );

  res.json({
    success: true,
    username,
    role: user.role,
    deviceId: user.deviceId,
    storageQuotaMB: user.storageQuotaMB,
    usedMB: getUsedStorageMB(username),
    expiresAt: user.expiresAt
  });
});

app.post('/api/logout', (req, res) => {
  const u = req.session.username;
  req.session.destroy();
  if (u) notifyAdmin(`🔴 Logout: ${u}`);
  res.json({ success: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  const used = getUsedStorageMB(req.username);
  res.json({
    username: req.username,
    role: req.user.role,
    deviceId: req.user.deviceId,
    storageQuotaMB: req.user.storageQuotaMB,
    usedMB: used,
    expiresAt: req.user.expiresAt,
    spaces: Object.values(req.user.spaces || {}).map(s => ({
      id: s.id,
      name: s.name,
      createdAt: s.createdAt,
      fileCount: (s.files || []).length
    }))
  });
});

// ===== SPACES =====
app.get('/api/spaces', requireAuth, (req, res) => {
  const spaces = Object.values(req.user.spaces || {}).map(s => ({
    id: s.id,
    name: s.name,
    createdAt: s.createdAt,
    fileCount: (s.files || []).length
  }));
  res.json({ spaces });
});

app.post('/api/spaces', requireAuth, (req, res) => {
  const { name } = req.body;
  if (!name || name.length > 50) return res.status(400).json({ error: 'Invalid name' });
  const id = uuidv4().slice(0, 8);
  req.user.spaces[id] = {
    id,
    name: name.trim(),
    createdAt: new Date().toISOString(),
    files: []
  };
  saveUsers(users);
  res.json({ success: true, space: req.user.spaces[id] });
});

app.delete('/api/spaces/:id', requireAuth, (req, res) => {
  const id = req.params.id;
  if (!req.user.spaces[id]) return res.status(404).json({ error: 'Space not found' });
  if (Object.keys(req.user.spaces).length <= 1) {
    return res.status(400).json({ error: 'Cannot delete last space' });
  }
  // delete files of this space
  const spaceDir = path.join(getUserDir(req.username), id);
  fs.removeSync(spaceDir);
  delete req.user.spaces[id];
  saveUsers(users);
  res.json({ success: true });
});

// ===== FILES =====
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const spaceId = req.params.spaceId || req.body.spaceId || 'default';
    const dir = path.join(getUserDir(req.username), spaceId);
    fs.ensureDirSync(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, unique + '-' + safe);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB
});

app.post('/api/spaces/:spaceId/upload', requireAuth, (req, res, next) => {
  // check quota before
  const used = getUsedStorageMB(req.username);
  if (used >= req.user.storageQuotaMB) {
    return res.status(400).json({ error: 'Storage quota exceeded' });
  }
  next();
}, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const spaceId = req.params.spaceId;
  if (!req.user.spaces[spaceId]) {
    fs.unlinkSync(req.file.path);
    return res.status(404).json({ error: 'Space not found' });
  }

  const fileInfo = {
    id: uuidv4().slice(0, 12),
    originalName: req.file.originalname,
    filename: req.file.filename,
    size: req.file.size,
    mime: req.file.mimetype,
    uploadedAt: new Date().toISOString()
  };

  if (!req.user.spaces[spaceId].files) req.user.spaces[spaceId].files = [];
  req.user.spaces[spaceId].files.push(fileInfo);
  saveUsers(users);

  res.json({ success: true, file: fileInfo, usedMB: getUsedStorageMB(req.username) });
});

app.get('/api/spaces/:spaceId/files', requireAuth, (req, res) => {
  const space = req.user.spaces[req.params.spaceId];
  if (!space) return res.status(404).json({ error: 'Space not found' });
  res.json({ files: space.files || [] });
});

app.get('/api/spaces/:spaceId/files/:fileId/download', requireAuth, (req, res) => {
  const space = req.user.spaces[req.params.spaceId];
  if (!space) return res.status(404).json({ error: 'Space not found' });
  const file = (space.files || []).find(f => f.id === req.params.fileId);
  if (!file) return res.status(404).json({ error: 'File not found' });

  const filePath = path.join(getUserDir(req.username), req.params.spaceId, file.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File missing on disk' });

  res.download(filePath, file.originalName);
});

app.delete('/api/spaces/:spaceId/files/:fileId', requireAuth, (req, res) => {
  const space = req.user.spaces[req.params.spaceId];
  if (!space) return res.status(404).json({ error: 'Space not found' });
  const idx = (space.files || []).findIndex(f => f.id === req.params.fileId);
  if (idx === -1) return res.status(404).json({ error: 'File not found' });

  const file = space.files[idx];
  const filePath = path.join(getUserDir(req.username), req.params.spaceId, file.filename);
  fs.removeSync(filePath);
  space.files.splice(idx, 1);
  saveUsers(users);
  res.json({ success: true, usedMB: getUsedStorageMB(req.username) });
});

// ===== STORAGE INFO =====
app.get('/api/storage', requireAuth, (req, res) => {
  res.json({
    usedMB: getUsedStorageMB(req.username),
    quotaMB: req.user.storageQuotaMB,
    deviceId: req.user.deviceId
  });
});

// ===== HEALTH =====
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', app: 'Infinity Space', time: new Date().toISOString() });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start
app.listen(PORT, () => {
  console.log(`🚀 Infinity Space running on port ${PORT}`);
  console.log(`📁 Data dir: ${DATA_DIR}`);
  console.log(`📁 Uploads: ${UPLOADS_DIR}`);
  console.log(`Default admin: admin / admin123`);
});
