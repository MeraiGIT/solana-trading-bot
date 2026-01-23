# Deployment Guide - Solana Trading Bot

> This guide will walk you through deploying your Solana Trading Bot to Railway step-by-step. No coding experience required.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Prepare Your Code](#2-prepare-your-code)
3. [Create a GitHub Account](#3-create-a-github-account)
4. [Push Code to GitHub](#4-push-code-to-github)
5. [Create a Railway Account](#5-create-a-railway-account)
6. [Deploy to Railway](#6-deploy-to-railway)
7. [Configure Environment Variables](#7-configure-environment-variables)
8. [Configure Health Checks](#8-configure-health-checks)
9. [Verify Deployment](#9-verify-deployment)
10. [Monitoring & Maintenance](#10-monitoring--maintenance)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. Prerequisites

Before starting, make sure you have:

- [ ] **Telegram Bot Token** - From @BotFather on Telegram
- [ ] **Supabase Project** - Your database is already set up
- [ ] **Helius API Key** (recommended) - For reliable Solana RPC
- [ ] **Master Encryption Key** - A 64-character hex string (you may already have this)

### Generate a Master Encryption Key (if needed)

If you don't have a master encryption key yet, run this in your terminal:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

This will output something like:
```
a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456
```

**SAVE THIS KEY SECURELY** - You'll need it for Railway.

---

## 2. Prepare Your Code

Before deploying, make sure your code is ready:

### 2.1 Build the Project

Open your terminal and navigate to the project folder:

```bash
cd /Users/yosifmerman/Desktop/solana-trading-bot
```

Build the TypeScript code:

```bash
npm run build
```

You should see no errors. The compiled JavaScript will be in the `dist/` folder.

### 2.2 Run Tests

Verify everything works:

```bash
npm test
```

You should see:
```
Test Suites: 4 passed, 4 total
Tests:       88 passed, 88 total
```

---

## 3. Create a GitHub Account

If you don't have a GitHub account:

1. Go to **[github.com](https://github.com)**
2. Click **"Sign up"** in the top right
3. Enter your email, create a password, and choose a username
4. Complete the verification
5. Click **"Create account"**

---

## 4. Push Code to GitHub

### 4.1 Create a New Repository on GitHub

1. Go to **[github.com/new](https://github.com/new)**
2. Repository name: `solana-trading-bot`
3. Description: `Solana trading bot with Telegram interface`
4. Select **"Private"** (important for security!)
5. **DO NOT** check "Add a README file" (we already have one)
6. Click **"Create repository"**

### 4.2 Push Your Code

Copy and run these commands in your terminal:

```bash
# Navigate to your project
cd /Users/yosifmerman/Desktop/solana-trading-bot

# Initialize git (if not already done)
git init

# Add the GitHub repository as remote
# Replace YOUR_USERNAME with your GitHub username
git remote add origin https://github.com/YOUR_USERNAME/solana-trading-bot.git

# Add all files
git add .

# Create a commit
git commit -m "Initial deployment"

# Push to GitHub
git push -u origin main
```

If prompted for credentials:
- Username: Your GitHub username
- Password: A GitHub Personal Access Token (not your password)

### 4.3 Create a Personal Access Token (if needed)

1. Go to **[github.com/settings/tokens](https://github.com/settings/tokens)**
2. Click **"Generate new token (classic)"**
3. Note: `Railway deployment`
4. Expiration: `90 days` (or your preference)
5. Check **"repo"** (full control of private repositories)
6. Click **"Generate token"**
7. **COPY THE TOKEN** - you won't see it again!
8. Use this token as your password when pushing

---

## 5. Create a Railway Account

1. Go to **[railway.app](https://railway.app)**
2. Click **"Login"** in the top right
3. Select **"Login with GitHub"**
4. Authorize Railway to access your GitHub account
5. Complete account setup

---

## 6. Deploy to Railway

### 6.1 Create a New Project

1. Click **"New Project"** in Railway dashboard
2. Select **"Deploy from GitHub repo"**
3. Find and select `solana-trading-bot`
4. Click **"Deploy Now"**

Railway will start building your project automatically.

### 6.2 Wait for Initial Build

- You'll see a build log appear
- The first build will fail because environment variables aren't set yet
- This is expected - proceed to the next step

---

## 7. Configure Environment Variables

This is the most important step. You need to add all your secrets.

### 7.1 Open Variables Settings

1. Click on your service (the purple box)
2. Click the **"Variables"** tab
3. Click **"Raw Editor"** in the top right

### 7.2 Add All Variables

Copy this template and replace the values with your actual secrets:

```
# REQUIRED - Telegram
BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrSTUvwxYZ

# REQUIRED - Supabase
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# REQUIRED - Solana RPC (Helius recommended)
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=your-helius-key

# REQUIRED - Encryption (NEVER SHARE THIS!)
MASTER_ENCRYPTION_KEY=a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456

# OPTIONAL - MEV Protection
HELIUS_API_KEY=your-helius-api-key
USE_JITO=true
JITO_TIP_LAMPORTS=50000

# OPTIONAL - Server Config
PORT=3000
NODE_ENV=production
LOG_LEVEL=info
```

### 7.3 Get Your Values

| Variable | Where to Find It |
|----------|------------------|
| `BOT_TOKEN` | Message @BotFather on Telegram, send `/mybots`, select your bot, click "API Token" |
| `SUPABASE_URL` | Supabase dashboard → Settings → API → Project URL |
| `SUPABASE_ANON_KEY` | Supabase dashboard → Settings → API → anon/public key |
| `SOLANA_RPC_URL` | [helius.dev](https://helius.dev) → Create account → Get API key → Use the URL |
| `MASTER_ENCRYPTION_KEY` | Your 64-character hex key (see Prerequisites) |
| `HELIUS_API_KEY` | Same as your Helius account |

### 7.4 Save Variables

1. Click **"Update Variables"**
2. Railway will automatically redeploy with the new variables

---

## 8. Configure Health Checks

Railway needs to know your app is healthy.

### 8.1 Open Service Settings

1. Click on your service
2. Click the **"Settings"** tab
3. Scroll to **"Health Check"**

### 8.2 Configure Health Check

Set these values:
- **Health Check Path**: `/health`
- **Health Check Timeout**: `30` seconds
- **Health Check Interval**: `30` seconds

Click **"Save"**

---

## 9. Verify Deployment

### 9.1 Check Build Logs

1. Click the **"Deployments"** tab
2. Click on the latest deployment
3. Check the logs for any errors

Successful build looks like:
```
Building...
npm run build
Compiled successfully
Starting...
🤖 Solana Trading Bot v0.5.0
✅ Health check server started on port 3000
✅ Bot started successfully
```

### 9.2 Test Your Bot

1. Open Telegram
2. Find your bot (search for its username)
3. Send `/start`
4. You should see the welcome message!

### 9.3 Check Health Endpoint

1. In Railway, click **"Settings"** tab
2. Find **"Domains"** section
3. Click **"Generate Domain"**
4. You'll get a URL like `solana-trading-bot-production.up.railway.app`
5. Open `https://your-url.up.railway.app/health` in a browser
6. You should see JSON with `"status": "healthy"`

---

## 10. Monitoring & Maintenance

### 10.1 View Logs

1. Go to Railway dashboard
2. Click your service
3. Click **"Logs"** tab
4. View real-time logs from your bot

### 10.2 View Audit Logs (Supabase)

1. Go to Supabase dashboard
2. Click **"Table Editor"**
3. Select **"tb_audit_logs"**
4. View all security events (wallet exports, trades, etc.)

### 10.3 Restart the Bot

If something goes wrong:
1. Click your service
2. Click the **three dots** menu
3. Click **"Restart"**

### 10.4 Update the Bot

When you make changes:

```bash
# In your terminal
cd /Users/yosifmerman/Desktop/solana-trading-bot
git add .
git commit -m "Your change description"
git push
```

Railway will automatically redeploy.

---

## 11. Troubleshooting

### Bot Not Responding

1. Check Railway logs for errors
2. Verify `BOT_TOKEN` is correct
3. Make sure the bot isn't running locally at the same time

### "Unauthorized" Errors

1. Verify `SUPABASE_ANON_KEY` is correct
2. Check Supabase dashboard for RLS policy issues

### Transaction Failures

1. Check `SOLANA_RPC_URL` is valid
2. Verify Helius API key is active
3. Check wallet has enough SOL for fees

### Health Check Failing

1. Verify `PORT` is set to `3000`
2. Check logs for startup errors
3. Ensure Supabase connection is working

### Build Failures

1. Check the build log for specific errors
2. Make sure all dependencies are in `package.json`
3. Verify `npm run build` works locally

---

## Security Reminders

1. **NEVER share your `MASTER_ENCRYPTION_KEY`** - Anyone with this key can steal all wallets
2. **Keep your GitHub repo PRIVATE** - Don't expose your code publicly
3. **Don't commit `.env` files** - Your secrets should only be in Railway
4. **Monitor audit logs** - Check for suspicious activity regularly
5. **Use 2FA everywhere** - GitHub, Railway, Supabase, Helius

---

## Quick Reference

| Service | URL |
|---------|-----|
| Railway Dashboard | [railway.app/dashboard](https://railway.app/dashboard) |
| Supabase Dashboard | [app.supabase.com](https://app.supabase.com) |
| Helius Dashboard | [helius.dev/dashboard](https://helius.dev/dashboard) |
| Telegram BotFather | [@BotFather](https://t.me/BotFather) |

---

## Need Help?

If you encounter issues:

1. Check the Railway logs first
2. Review this guide's troubleshooting section
3. Check Supabase logs for database issues
4. Verify all environment variables are set correctly

Your bot is now deployed and running on Railway! 🎉
