'use strict';

require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const firestore = require('../src/services/firestore');

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error('Usage: node scripts/publish-system-design-article.js <article.json|articles.json>');
    process.exitCode = 1;
    return;
  }

  const filePath = path.join(process.cwd(), input);
  const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const articles = Array.isArray(payload) ? payload : [payload];

  for (const article of articles) {
    if (!article.contentType) {
      const category = String(article.category || '').trim().toLowerCase();
      article.contentType = category === 'architecture' ? 'architecture' : 'system-design';
    }
    const result = await firestore.upsertSystemDesignArticle(article, {
      publishedBy: process.env.USER || 'local-script',
    });
    console.log(`Published ${result.id} version ${result.version}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
