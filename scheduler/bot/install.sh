#!/data/data/com.termux/files/usr/bin/bash
# WA Auto Sender installer for Termux (Android).
# Run inside Termux:  curl -fsSL https://bvrauditteam.github.io/scheduler/bot/install.sh | bash
set -e
BASE="${WA_BOT_BASE:-https://bvrauditteam.github.io/scheduler/bot}"
DIR="$HOME/wa-bot"

echo "== Installing Node.js and git (a few minutes the first time) =="
pkg update -y
pkg install -y nodejs-lts git curl

echo "== Downloading WA Auto Sender =="
mkdir -p "$DIR"
for f in package.json bot.mjs ui.html; do
  curl -fsSL "$BASE/$f" -o "$DIR/$f"
done

echo "== Installing libraries =="
cd "$DIR"
npm install --omit=dev --no-audit --no-fund

# 'wa-bot' command: keeps the phone's CPU awake for Termux and restarts the bot if it ever stops.
cat > "$PREFIX/bin/wa-bot" <<'SH'
#!/data/data/com.termux/files/usr/bin/bash
termux-wake-lock 2>/dev/null || true
cd "$HOME/wa-bot"
while true; do
  node bot.mjs
  echo "Bot stopped, restarting in 5 seconds..."
  sleep 5
done
SH
chmod +x "$PREFIX/bin/wa-bot"

# Start automatically after the phone restarts (needs the Termux:Boot app, opened once).
mkdir -p "$HOME/.termux/boot"
cat > "$HOME/.termux/boot/wa-bot" <<'SH'
#!/data/data/com.termux/files/usr/bin/bash
wa-bot > "$HOME/wa-bot/bot.log" 2>&1
SH
chmod +x "$HOME/.termux/boot/wa-bot"

echo
echo "== Done =="
echo "Start it with:   wa-bot"
echo "Then open http://localhost:8080 in Chrome on this phone."
