# ── Stage 1: node:20-slim (Debian) ────────────────────────────────────────────
# We switched from node:20-alpine to node:20-slim to support headless Chrome
# (Puppeteer) for server-side PDF generation.  Alpine's bundled Chromium is
# several major versions behind and lacks the CSS print features we rely on;
# the Debian package track is kept current by Google's own linux/chrome repo.
FROM node:20-slim

# Install Google Chrome Stable.
# We use the official Google signing key + apt repo so we always get the same
# Chrome version that Google ships to end-users — the exact engine that renders
# our @media print stylesheet correctly.
RUN apt-get update && apt-get install -y wget gnupg --no-install-recommends \
  && wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg \
  && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" \
       > /etc/apt/sources.list.d/google-chrome.list \
  && apt-get update && apt-get install -y \
       google-chrome-stable \
       fonts-liberation \
       fonts-noto-color-emoji \
       libappindicator3-1 \
       libasound2 \
       libatk-bridge2.0-0 \
       libatk1.0-0 \
       libcups2 \
       libdbus-1-3 \
       libgdk-pixbuf2.0-0 \
       libnspr4 \
       libnss3 \
       libx11-xcb1 \
       libxcomposite1 \
       libxdamage1 \
       libxrandr2 \
       xdg-utils \
       --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer where Chrome lives (skips the Puppeteer-bundled download).
ENV CHROME_PATH=/usr/bin/google-chrome-stable \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

WORKDIR /app

# Install Node dependencies.
# `--ignore-scripts` prevents husky from running in CI/Docker (dev-only hook).
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

# Copy application source
COPY . .

# Cloud Run injects PORT; default to 8080
EXPOSE 8080

CMD ["node", "server.js"]
