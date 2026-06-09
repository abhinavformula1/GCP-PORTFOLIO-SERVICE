FROM node:20-alpine

WORKDIR /app

# Install dependencies first (layer cache — only re-runs when package files change)
#
# `--ignore-scripts` is critical here: `package.json` has a `prepare` script
# that runs `husky` to install local git hooks. Husky is a devDependency, so
# `--omit=dev` skips installing it — and then `prepare` fails with exit 127
# (command not found), which kills the whole Docker build. Git hooks are a
# dev-machine concern; there's no value in trying to install them inside a
# Cloud Run container, so we just turn lifecycle scripts off entirely.
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

# Copy application source
COPY . .

# Cloud Run injects PORT; default to 8080
EXPOSE 8080

CMD ["node", "server.js"]
