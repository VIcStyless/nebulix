#!/usr/bin/env bash
# Connect Nebulix PRO to your Stripe account. Run it yourself in a terminal:
#   bash scripts/stripe-setup.sh
# You paste your Stripe secret key once (hidden). It is stored only as a Fly.io secret of the app.
# On restart the Nebulix server creates the "Nebulix PRO" product, the monthly and yearly prices and its webhook by itself.
# Use a test key (sk_test_…) first; run this again with your live key (sk_live_…) when you want real payments.
set -euo pipefail
APP="${FLY_APP:-nebulix}"
FLY="$(command -v flyctl || command -v fly || echo "$HOME/.fly/bin/flyctl")"
[ -x "$FLY" ] || { echo "flyctl not found. Install it first: curl -L https://fly.io/install.sh | sh"; exit 1; }

while :; do
  echo "Paste your Stripe secret key with Ctrl+Shift+V, then press Enter (nothing shows while you paste)."
  read -r -s -p "Stripe secret key: " SK; echo
  SK="$(printf '%s' "$SK" | tr -d '[:space:]')"
  case "$SK" in
    sk_test_*|sk_live_*|rk_test_*|rk_live_*) echo "Key received (${#SK} characters)."; break;;
    "") echo "Nothing was pasted. Try again (Ctrl+Shift+V)."; echo;;
    *) echo "That does not look like a Stripe secret key (it starts with sk_test_ or sk_live_). Try again."; echo;;
  esac
done
code="$(curl -s -o /dev/null -w '%{http_code}' -u "$SK:" https://api.stripe.com/v1/balance)"
[ "$code" = "200" ] || { echo "Stripe rejected that key (HTTP $code). Copy it again from https://dashboard.stripe.com/apikeys"; exit 1; }
read -r -p "Currency [eur]: " CUR; CUR="${CUR:-eur}"
read -r -p "Monthly price [4.99]: " PM; PM="${PM:-4.99}"
read -r -p "Yearly price [39.99]: " PY; PY="${PY:-39.99}"
cents() { awk -v v="${1/,/.}" 'BEGIN { printf "%d", v * 100 + 0.5 }'; }
echo "Saving it as a Fly.io secret of '$APP' (the app restarts once and sets up Stripe by itself)…"
printf 'STRIPE_SECRET_KEY=%s\nPRO_CURRENCY=%s\nPRO_MONTHLY_CENTS=%s\nPRO_YEARLY_CENTS=%s\n' "$SK" "$(echo "$CUR" | tr 'A-Z' 'a-z')" "$(cents "$PM")" "$(cents "$PY")" | "$FLY" secrets import -a "$APP"
unset SK
echo "Done. In a minute open https://nebulix.fly.dev/#/pro — with a test key, pay with card 4242 4242 4242 4242."
