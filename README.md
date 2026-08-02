# Infinity Space

**Multi Virtual Spaces • Cloud Storage • Telegram Admin**

A modern web-based multi-space application with isolated virtual spaces, cloud file storage, user authentication with expiry, and full Telegram bot admin panel.

Developer: **infinity1xr**

## Features

- Beautiful modern dark UI with Infinity logo
- Login system (username + password)
- Admin can create users with password expiry via Telegram bot
- Multiple isolated virtual **Spaces** per user
- Cloud storage (files stored on server / Railway volume — does NOT use your device storage)
- Storage quota display (e.g. 12.5 / 500 MB) in top corner
- Unique virtual Device ID per user (completely isolated, not linked to real device)
- File upload / download / delete with drag & drop
- Smooth responsive experience

## Telegram Admin Bot Commands

Contact the bot and use (Admin Chat ID only):

| Command | Description |
|---------|-------------|
| `/start` or `/help` | Show help |
| `/createuser <user> <pass> <days> [quota_mb]` | Create user (e.g. `/createuser john secret 30 1000`) |
| `/listusers` | List all users + storage + expiry |
| `/status <username>` | Detailed status of a user |
| `/deleteuser <username>` | Delete user + their files |
| `/resetpass <username> <newpass>` | Reset password |
| `/extend <username> <days>` | Extend expiry |

Default admin account (change after first login):
- Username: `admin`
- Password: `admin123`

## Deploy on Railway

1. Create new project on [Railway](https://railway.app)
2. Deploy from GitHub or upload this folder
3. Add a **Volume**:
   - Mount path: `/data`
4. Set environment variables (optional but recommended):
   ```
   BOT_TOKEN=your_bot_token
   ADMIN_CHAT_ID=8494250384
   DATA_DIR=/data
   UPLOADS_DIR=/data/uploads
   SESSION_SECRET=any-long-random-string
   PORT=3000
   ```
5. Deploy!

The app will automatically use the volume for persistent storage.

## Local Run

```bash
npm install
npm start
```

Open http://localhost:3000

## Important Notes

- **Real app cloning / Google Play Services / full Android multi-space** is not possible in a web app. This provides virtual isolated spaces + cloud storage instead.
- Keep your Bot Token secret. Revoke & regenerate if exposed publicly.
- Change the default admin password immediately.
- Storage is limited by your Railway plan + volume size.

## Tech Stack

- Node.js + Express
- express-session
- Multer (uploads)
- node-telegram-bot-api
- bcryptjs + uuid
- Pure HTML/CSS/JS frontend (no heavy framework)

---

Made with ♾️ by infinity1xr
