#!/usr/bin/env bash
# Connect the Nebulix email bot (verification codes, password resets, sign-in alerts). Run it yourself:
#   bash scripts/mail-setup.sh
# Option 1 — Gmail: needs a Google "app password" (https://myaccount.google.com/apppasswords, 2-step verification on).
# Option 2 — Resend: needs an API key from https://resend.com/api-keys and a verified sending domain.
# What you type is stored only as Fly.io secrets of the app; the app restarts once and starts sending real emails.
set -euo pipefail
APP="${FLY_APP:-nebulix}"
FLY="$(command -v flyctl || command -v fly || echo "$HOME/.fly/bin/flyctl")"
[ -x "$FLY" ] || { echo "flyctl not found. Install it first: curl -L https://fly.io/install.sh | sh"; exit 1; }

echo "How should Nebulix send email?"
echo "  1) Gmail (simplest: your Gmail address + an app password)"
echo "  2) Resend (your own domain)"
read -r -p "Choose 1 or 2 [1]: " OPT; OPT="${OPT:-1}"

if [ "$OPT" = "2" ]; then
  while :; do read -r -s -p "Resend API key (re_…): " KEY; echo; KEY="$(printf '%s' "$KEY" | tr -d '[:space:]')"; case "$KEY" in re_*) break;; "") echo "Nothing was pasted. Try again (Ctrl+Shift+V).";; *) echo "That does not look like a Resend key (it starts with re_).";; esac; done
  code="$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $KEY" https://api.resend.com/domains)"
  [ "$code" = "200" ] || { echo "Resend rejected that key (HTTP $code)."; exit 1; }
  read -r -p "Send from (for example: Nebulix <bot@yourdomain.com>): " FROM
  [ -n "$FROM" ] || { echo "A sender address is needed."; exit 1; }
  echo "Saving it as Fly.io secrets of '$APP' (the app restarts once)…"
  printf 'MAIL_MODE=resend\nRESEND_API_KEY=%s\nMAIL_FROM=%s\n' "$KEY" "$FROM" | "$FLY" secrets import -a "$APP"
  unset KEY
else
  read -r -p "Gmail address: " USER_
  case "$USER_" in *@*.*) ;; *) echo "That does not look like an email address."; exit 1;; esac
  echo "Create an app password at https://myaccount.google.com/apppasswords (name it Nebulix) and paste the 16 letters."
  while :; do read -r -s -p "App password (hidden): " PASS; echo; PASS="$(printf '%s' "$PASS" | tr -d '[:space:]')"; [ "${#PASS}" -eq 16 ] && break; echo "App passwords have 16 letters (you pasted ${#PASS}). Try again."; done
  # check the login with Gmail before saving anything
  if command -v curl >/dev/null; then
    if ! curl -s --max-time 20 --url 'smtps://smtp.gmail.com:465' --user "$USER_:$PASS" -X NOOP >/dev/null 2>&1; then
      code=$?; [ "$code" = "67" ] && { echo "Gmail rejected that app password. Check it and run this again."; exit 1; }
    fi
  fi
  echo "Saving it as Fly.io secrets of '$APP' (the app restarts once)…"
  printf 'MAIL_MODE=smtp\nSMTP_HOST=smtp.gmail.com\nSMTP_PORT=465\nSMTP_SECURE=true\nSMTP_USER=%s\nSMTP_PASS=%s\nMAIL_FROM=Nebulix Bot <%s>\n' "$USER_" "$PASS" "$USER_" | "$FLY" secrets import -a "$APP"
  unset PASS
fi
echo "Done. Nebulix will now email verification codes. Test it: Settings → Account → add or change your email."
