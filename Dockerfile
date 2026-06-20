# ── node:20-slim (Debian) ──────────────────────────────────────────────────────
# Switched from node:20-alpine to node:20-slim to support headless Chrome
# (Puppeteer) for server-side PDF generation.
FROM node:20-slim

# Install Google Chrome Stable via the direct .deb download.
# This avoids the GPG apt-repo setup (which is fragile in Cloud Build) while
# still installing the identical binary Google ships to end-users.
RUN apt-get update && apt-get install -y \
      wget \
      ca-certificates \
      fonts-liberation \
      libappindicator3-1 \
      libasound2 \
      libatk-bridge2.0-0 \
      libatk1.0-0 \
      libcups2 \
      libdbus-1-3 \
      libgdk-pixbuf2.0-0 \
      libgtk-3-0 \
      libnspr4 \
      libnss3 \
      libx11-xcb1 \
      libxcomposite1 \
      libxdamage1 \
      libxrandr2 \
      libxss1 \
      libxtst6 \
      xdg-utils \
      --no-install-recommends \
  && wget -q -O /tmp/chrome.deb \
       https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
  && apt-get install -y /tmp/chrome.deb \
  && rm /tmp/chrome.deb \
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
