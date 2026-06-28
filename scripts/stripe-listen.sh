#!/usr/bin/env bash
set -euo pipefail

# Helper for local Stripe webhook forwarding.
# Usage:
#   bash scripts/stripe-listen.sh
#
# Prereqs:
#   - Stripe CLI installed: https://stripe.com/docs/stripe-cli
#
# What it does:
#   - Forwards Stripe Test Mode webhooks to your local server endpoint:
#       http://localhost:<PORT>/api/billing/webhook
#   - Stripe CLI prints a `whsec_...` signing secret.
#     Put that into your local `.env` as STRIPE_WEBHOOK_SECRET and restart server.

PORT="${PORT:-8080}"
FORWARD_TO="localhost:${PORT}/api/billing/webhook"

if ! command -v stripe >/dev/null 2>&1; then
  echo "Stripe CLI not found."
  echo "Install it: https://stripe.com/docs/stripe-cli"
  exit 1
fi

# Stripe CLI stores credentials in ~/.config/stripe/config.toml by default.
# Some macOS setups (or previous installs) end up with that file locked down.
# To avoid requiring sudo, we store Stripe CLI config under this repo.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-"${REPO_ROOT}/.stripe-cli-config"}"
mkdir -p "${XDG_CONFIG_HOME}/stripe"

echo "Forwarding Stripe webhooks to: http://${FORWARD_TO}"
echo
echo "Stripe CLI config directory:"
echo "  ${XDG_CONFIG_HOME}/stripe/config.toml"
echo
echo "If you haven't logged in yet, run (uses repo-local config):"
echo "  XDG_CONFIG_HOME=\"${XDG_CONFIG_HOME}\" stripe login"
echo
echo "After this starts, copy the printed 'whsec_...' into:"
echo "  STRIPE_WEBHOOK_SECRET=whsec_..."
echo "and restart your server."
echo

stripe listen --forward-to "${FORWARD_TO}"

