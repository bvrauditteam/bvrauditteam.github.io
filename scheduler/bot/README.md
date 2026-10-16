# WA Auto Sender

Sends scheduled WhatsApp messages from your own number **by itself**, even with the phone
locked. It runs in Termux on an Android phone and joins your WhatsApp as a *linked device*,
the same way WhatsApp Web does, so it never needs the screen unlocked.

## One-time setup (about 10 minutes)

1. Install **Termux** and **Termux:Boot** from F-Droid (https://f-droid.org). The Play Store
   version of Termux is outdated and won't work.
2. Open Termux and paste:
   ```
   curl -fsSL https://bvrauditteam.github.io/scheduler/bot/install.sh | bash
   ```
3. Type `wa-bot` and press Enter. Leave Termux running.
4. Open Chrome on the same phone and go to **http://localhost:8080**.
5. Enter your WhatsApp number and tap **Get linking code**. In WhatsApp go to
   ⋮ → Linked devices → Link a device → *Link with phone number instead*, and type the code.
6. Stop Android from killing it: Settings → Apps → **Termux** → Battery → **Unrestricted**
   (also allow "background activity" / turn off "pause app if unused"). Do the same for
   Termux:Boot, and open Termux:Boot once so it restarts the bot after a reboot.

After that, schedule messages at http://localhost:8080. The phone can be locked; it only
needs to be switched on with internet.

## Good to know

- This is an unofficial WhatsApp client. WhatsApp can ban numbers that use one for bulk or
  spam messages. A few personal messages a day is low risk, but the risk is not zero.
- Messages, your schedule and the WhatsApp login are stored only in `~/wa-bot` on the phone.
  To unlink, remove "Ubuntu" from WhatsApp → Linked devices.
- The page is reachable only from the phone itself (127.0.0.1), not from others on the Wi-Fi.
- It also runs on any always-on computer with Node.js 20+: `npm install`, then `npm start`.
