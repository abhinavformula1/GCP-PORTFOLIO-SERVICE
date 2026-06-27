/**
 * Runtime resume generator + preview modal.
 *
 * The "Download Resume" button doesn't link to a static PDF anywhere. It
 * builds one on demand by scraping the live portfolio DOM (About Me,
 * Skills, Experience, Projects, Education, Certifications) and laying
 * the content out as a clean A4 document via jsPDF.
 *
 * Layout — modeled on the ATS-passing reference resume
 * (`Abhinav_Kumar_Senior_Salesforce_Application_Engineer.pdf`):
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │  Name                          email | phone             │  Header band
 *   │  Title                         linkedin                  │  (full-width)
 *   │                                trailblazer               │
 *   │                                Location                  │
 *   ├──────────────────────────────┬───────────────────────────┤
 *   │  About Me                    │  Work Experience          │
 *   │  …                           │  Senior Technical …       │
 *   │  Skills                      │  …                        │
 *   │  …                           │                           │  Two-column body
 *   │  Education                   │                           │
 *   │  …                           │                           │
 *   │  Certifications              │                           │
 *   │  …                           │                           │
 *   ├──────────────────────────────┴───────────────────────────┤
 *   │  Projects                                                │  Full-width footer
 *   │  …                                                       │
 *   └──────────────────────────────────────────────────────────┘
 *
 * The two columns flow independently — left column page-breaks when it
 * fills up, right column page-breaks when it fills up, both append
 * pages to the same document. After both columns finish, the Projects
 * section starts below whichever column is "deepest" and flows
 * full-width across one or more additional pages.
 *
 * Flow:
 *   1. Click "Download Resume" → `generateResumePdf()` lazy-loads jsPDF,
 *      scrapes the DOM, renders the PDF to a blob, and opens a preview
 *      modal with the PDF embedded in an iframe.
 *   2. Inside the modal: "Download" saves the file via the browser save
 *      dialog. "Close" dismisses the modal. The visitor sees exactly
 *      what's getting downloaded before committing the file.
 *
 * Why runtime + preview:
 *   - Single source of truth: the resume is whatever the page currently
 *     renders. Edit one section, the next download reflects it.
 *   - Locale-aware: i18n changes the DOM → resume changes with it. A
 *     French recruiter who flips the language gets a French resume.
 *   - Selectable text (vector PDF) — ATS-friendly, no OCR needed.
 *   - Preview catches generation bugs before download. jsPDF rebuilds
 *     layout from scratch (no CSS, manual page breaks), so what looks
 *     fine on the page can still render badly in the PDF.
 *
 * jsPDF is loaded from a CDN on first click (lazy), so visitors who
 * never download pay zero bytes for it.
 *
 * Module shape: `generateResumePdf` (open the preview modal),
 * `downloadResumePdf` (save the previewed PDF to disk), and
 * `closeResumePreview` (dismiss the modal, revoke the blob URL).
 * main.js re-exports all three onto `window` so the inline onclick
 * handlers in index.html resolve.
 */

const JSPDF_CDN = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';
let _jspdfLoadPromise = null;

function loadJsPDF() {
  if (_jspdfLoadPromise) return _jspdfLoadPromise;
  _jspdfLoadPromise = new Promise(function (resolve, reject) {
    const s = document.createElement('script');
    s.src = JSPDF_CDN;
    s.async = true;
    s.onload  = function () {
      if (window.jspdf && window.jspdf.jsPDF) resolve(window.jspdf.jsPDF);
      else reject(new Error('jsPDF loaded but global is missing.'));
    };
    s.onerror = function () { reject(new Error('Failed to load jsPDF from CDN.')); };
    document.head.appendChild(s);
  });
  return _jspdfLoadPromise;
}

/**
 * Walk the page DOM and pull out resume-shaped data. Tolerant to missing
 * sections — the renderer below skips any block that comes back empty.
 */
function getResumeData() {
  function txt(el) { return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : ''; }
  function arr(sel, el) { return [].slice.call((el || document).querySelectorAll(sel)); }

  // Contact identity is hardcoded — these are stable canonical fields,
  // not user-editable, so DOM scraping for them is overkill (and the
  // page-rendered phone is gated on a verified-org reveal that doesn't
  // apply to the resume context).
  //
  // ATS parsers look for these specific fields to populate candidate
  // profiles: phone, LinkedIn, Salesforce ecosystem credential
  // (Trailblazer), and location. Missing any of them means the
  // recruiter has to type them in manually before forwarding — a
  // friction point worth eliminating in a runtime resume.
  const data = {
    name:     'Abhinav Kumar',
    title:    txt(document.querySelector('[data-i18n="headerTitle"]')),
    contact:  {
      email:       'abhinavformula1@gmail.com',
      phone:       '+91-9527506880',
      linkedin:    'linkedin.com/in/abhinavformula1',
      trailblazer: 'trailblazer.me/id/abhinavformula1',
      location:    'Bengaluru, India',
    },
    summary:  arr('.about-text').map(txt).filter(Boolean),
    skills:   [],
    experience: [],
    projects:   [],
    education:  null,
    certifications: [],
  };

  arr('.skill-group').forEach(function (g) {
    const label = txt(g.querySelector('.skill-group-label'));
    const tags  = arr('.tag', g).map(txt).filter(Boolean);
    if (label && tags.length) data.skills.push({ label: label, tags: tags });
  });

  arr('.job').forEach(function (j) {
    const bullets = arr('.job-bullets li', j).map(txt).filter(Boolean);
    // The on-page `.job-company` element bundles the company name with a
    // ` · India` style location span. The reference resume layout splits
    // those onto two lines (`Senior …, <Company>` then `<Period>, <Location>`),
    // so we extract the location separately and strip it from the company
    // string. The middle-dot separator is the visual cue we look for.
    const companyEl   = j.querySelector('.job-company');
    const locationEl  = companyEl && companyEl.querySelector('.location');
    const locationStr = locationEl ? txt(locationEl).replace(/^[·•\s]+/, '').trim() : '';
    let companyOnly = companyEl ? txt(companyEl) : '';
    if (locationStr && companyOnly) {
      // Trim "Salesforce · India" → "Salesforce".
      const idx = companyOnly.indexOf(locationStr);
      if (idx > 0) companyOnly = companyOnly.slice(0, idx).replace(/[·•\s]+$/, '').trim();
    }
    data.experience.push({
      title:    txt(j.querySelector('.job-title')),
      period:   txt(j.querySelector('.job-period')),
      company:  companyOnly,
      location: locationStr,
      bullets:  bullets,
    });
  });

  arr('.project').forEach(function (p) {
    const bullets = arr('.job-bullets li', p).map(txt).filter(Boolean);
    data.projects.push({
      title:   txt(p.querySelector('.project-title')),
      tag:     txt(p.querySelector('.project-tag')),
      bullets: bullets,
    });
  });

  const eduSection = arr('.section').find(function (s) {
    const t = txt(s.querySelector('.section-title')).toLowerCase();
    return t === 'education' || t === 'formation' || t.indexOf('educat') === 0;
  });
  if (eduSection) {
    const rawYear = txt(eduSection.querySelector('.edu-year'));
    // Reference resume shows just the year (e.g. "2012"), not "Graduated 2012".
    // Strip everything before the first 4-digit year for ATS-friendly format.
    const yearMatch = rawYear.match(/(\d{4})/);
    data.education = {
      name:   txt(eduSection.querySelector('.edu-name')),
      degree: arr('.edu-degree', eduSection).map(txt).filter(Boolean),
      year:   yearMatch ? yearMatch[1] : rawYear,
    };
  }

  arr('.cert-group').forEach(function (g) {
    const items = arr('.cert-item', g).map(txt).filter(Boolean);
    if (items.length) {
      data.certifications.push({
        title: txt(g.querySelector('.cert-group-title')),
        items: items,
      });
    }
  });

  return data;
}

/**
 * Render `data` into a jsPDF document.
 *
 * Layout is two-column on A4 (595 × 842 pt) with a full-width header
 * band on top of page 1 and a full-width Projects footer at the end.
 * The two columns flow independently — each tracks its own page index
 * and y cursor, and we use `doc.setPage(N)` to alternate which page we
 * draw on. Pages added by the left column are reused by the right
 * column, so the document never has phantom blank pages.
 *
 * All y-coordinates in this function represent the BASELINE of the next
 * line to draw (jsPDF's default text origin), not the top of the line.
 * `lineHeight = size + 3` is the unit we advance after each line.
 */
function renderResumePdf(jsPDF, data) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();   // 595 pt
  const H = doc.internal.pageSize.getHeight();  // 842 pt
  const MARGIN = 36;

  // Column geometry — the ~40/60 split with an 18pt gutter mirrors the
  // visual proportions of the reference resume.
  const LEFT_W  = 200;
  const GUTTER  = 18;
  const LEFT_X  = MARGIN;
  const RIGHT_X = MARGIN + LEFT_W + GUTTER;       // 254
  const RIGHT_W = W - RIGHT_X - MARGIN;            // 305
  const FULL_W  = W - 2 * MARGIN;                  // 523
  const BOTTOM  = H - MARGIN;                      // baseline below which we page-break
  const BLUE    = [60, 90, 200];                   // hyperlink colour
  const TEXT    = [20, 20, 20];                    // body text colour
  function setBody(opts) {
    opts = opts || {};
    doc.setFont('helvetica', opts.bold ? 'bold' : (opts.italic ? 'italic' : 'normal'));
    doc.setFontSize(opts.size || 10);
    const c = opts.color || TEXT;
    doc.setTextColor(c[0], c[1], c[2]);
  }

  // ── Header band (full-width, page 1 only) ───────────────────────────
  // Left side: name (large bold) + title (smaller bold).
  // Right side: contact info stacked right-aligned. Email + phone share
  // the first line; LinkedIn and Trailblazer are clickable blue links;
  // location anchors the bottom in bold (geographic signal for ATS).
  doc.setPage(1);
  setBody({ bold: true, size: 14 });
  doc.text(data.name || '', LEFT_X, MARGIN + 14);
  if (data.title) {
    setBody({ bold: true, size: 11 });
    doc.text(data.title, LEFT_X, MARGIN + 30);
  }

  const c = data.contact || {};
  let rY = MARGIN + 14;  // align first contact line with the name baseline
  function rText(text, baselineY, opts) {
    setBody(opts);
    const w = doc.getTextWidth(text);
    doc.text(text, W - MARGIN - w, baselineY);
  }
  function rLink(text, baselineY, url, opts) {
    setBody(opts);
    const w = doc.getTextWidth(text);
    doc.textWithLink(text, W - MARGIN - w, baselineY, { url: url });
  }

  if (c.email && c.phone) {
    const line = c.email + ' | ' + c.phone;
    setBody({ size: 10 });
    const w = doc.getTextWidth(line);
    // Whole line is hot — clicking anywhere fires the mailto:. We
    // don't try to split the link target by character because jsPDF
    // doesn't support partial-line link rectangles.
    doc.textWithLink(line, W - MARGIN - w, rY, { url: 'mailto:' + c.email });
    rY += 13;
  } else if (c.email) {
    rLink(c.email, rY, 'mailto:' + c.email, { size: 10 }); rY += 13;
  } else if (c.phone) {
    rLink(c.phone, rY, 'tel:' + c.phone.replace(/[^+\d]/g, ''), { size: 10 }); rY += 13;
  }
  if (c.linkedin)    { rLink(c.linkedin,    rY, 'https://' + c.linkedin,    { size: 10, color: BLUE }); rY += 13; }
  if (c.trailblazer) { rLink(c.trailblazer, rY, 'https://' + c.trailblazer, { size: 10, color: BLUE }); rY += 13; }
  if (c.location)    { rText(c.location,    rY, { bold: true, size: 10 });                              rY += 13; }
  setBody();

  // Where the body content starts (max of the deepest header line on
  // either side, plus a small gap). Both columns begin from this y on
  // page 1; on subsequent pages, columns start from MARGIN + 12 because
  // the header is page-1 only.
  const leftHeaderBottom  = data.title ? MARGIN + 30 + 4 : MARGIN + 14 + 4;
  const rightHeaderBottom = rY;
  const BODY_TOP = Math.max(leftHeaderBottom, rightHeaderBottom) + 14;
  const SUBSEQUENT_PAGE_TOP = MARGIN + 12;

  // ── Column flow primitive ──────────────────────────────────────────
  // Each column owns its current page + y cursor. Drawing methods all
  // start by calling activate() so jsPDF writes to the column's page
  // (since the two columns interleave on the same physical pages).
  function makeColumn(x, w) {
    return {
      page: 1,
      x:    x,
      w:    w,
      y:    BODY_TOP,
      ensure: function (needed) {
        if (this.y + needed > BOTTOM) this.advancePage();
      },
      advancePage: function () {
        const totalPages = doc.internal.getNumberOfPages();
        if (this.page < totalPages) this.page += 1;
        else { doc.addPage(); this.page = totalPages + 1; }
        doc.setPage(this.page);
        this.y = SUBSEQUENT_PAGE_TOP;
      },
      activate: function () { doc.setPage(this.page); },
      paragraph: function (text, opts) {
        opts = opts || {};
        const size = opts.size || 10;
        const lh   = opts.lineHeight || (size + 3);
        setBody(opts);
        const lines = doc.splitTextToSize(text, this.w);
        for (let i = 0; i < lines.length; i++) {
          this.ensure(lh);
          this.activate();
          doc.text(lines[i], this.x, this.y);
          this.y += lh;
        }
        setBody();
      },
      bullet: function (text, opts) {
        opts = opts || {};
        const size = opts.size || 10;
        const lh   = size + 3;
        const indent = 12;
        setBody(opts);
        const lines = doc.splitTextToSize(text, this.w - indent);
        for (let i = 0; i < lines.length; i++) {
          this.ensure(lh);
          this.activate();
          if (i === 0) doc.text('•', this.x, this.y);
          doc.text(lines[i], this.x + indent, this.y);
          this.y += lh;
        }
        setBody();
      },
      sectionHeader: function (label) {
        // Add air above (skipped if we're already at the top of a column
        // on its current page — i.e. this is the first section here).
        const atTop = (this.y <= BODY_TOP + 1) || (this.y <= SUBSEQUENT_PAGE_TOP + 1);
        this.ensure(20);
        if (!atTop) this.y += 6;
        this.activate();
        setBody({ bold: true, size: 12 });
        doc.text(label, this.x, this.y);
        this.y += 16;
        setBody();
      },
      // Inline-bold-label line (used for skill rows).
      // First line: "<label>: <body fragment that fits beside label>".
      // Continuation lines wrap back to the column left edge — matches
      // how the reference resume lays out skill rows.
      labeledLine: function (label, body, opts) {
        opts = opts || {};
        const size = opts.size || 10;
        const lh   = size + 3;
        const labelStr = label + ': ';
        setBody({ bold: true, size: size });
        const labelW = doc.getTextWidth(labelStr);
        setBody({ size: size });
        const firstSplit = doc.splitTextToSize(body, this.w - labelW);
        const firstLine  = firstSplit[0] || '';
        const rest       = body.slice(firstLine.length).trimStart();
        const restLines  = rest ? doc.splitTextToSize(rest, this.w) : [];

        this.ensure(lh);
        this.activate();
        setBody({ bold: true, size: size });
        doc.text(labelStr, this.x, this.y);
        setBody({ size: size });
        if (firstLine) doc.text(firstLine, this.x + labelW, this.y);
        this.y += lh;
        for (let i = 0; i < restLines.length; i++) {
          this.ensure(lh);
          this.activate();
          doc.text(restLines[i], this.x, this.y);
          this.y += lh;
        }
        setBody();
      },
      gap: function (amount) { this.y += amount; },
    };
  }

  const leftCol  = makeColumn(LEFT_X,  LEFT_W);
  const rightCol = makeColumn(RIGHT_X, RIGHT_W);

  // ── LEFT COLUMN ────────────────────────────────────────────────────
  if (data.summary && data.summary.length) {
    leftCol.sectionHeader('About Me');
    data.summary.forEach(function (p) {
      leftCol.paragraph(p);
      leftCol.gap(2);
    });
  }

  if (data.skills && data.skills.length) {
    leftCol.sectionHeader('Skills');
    data.skills.forEach(function (g) {
      leftCol.labeledLine(g.label, g.tags.join(', '));
      leftCol.gap(3);
    });
  }

  if (data.education) {
    leftCol.sectionHeader('Education');
    const degree0 = (data.education.degree && data.education.degree[0]) || '';
    const firstLine = degree0 + (data.education.year ? ', ' + data.education.year : '');
    if (firstLine.trim()) leftCol.paragraph(firstLine, { bold: true });
    if (data.education.name) leftCol.paragraph(data.education.name);
    // Any further `.edu-degree` entries (e.g. "Indore, Madhya Pradesh")
    // become institution-location lines below the name.
    (data.education.degree || []).slice(1).forEach(function (d) { leftCol.paragraph(d); });
  }

  if (data.certifications && data.certifications.length) {
    leftCol.sectionHeader('Certifications');
    data.certifications.forEach(function (g, idx) {
      // Orphan prevention: keep the subgroup title and at least its first
      // bullet on the same page. Without this, small groups can split.
      leftCol.ensure((g.title ? 14 : 0) + 13 + 2);
      if (g.title) {
        leftCol.activate();
        setBody({ bold: true, size: 10 });
        doc.text(g.title, leftCol.x, leftCol.y);
        leftCol.y += 13;
        setBody();
      }
      g.items.forEach(function (item) {
        // The DOM nodes ship a leading bullet glyph for visual styling;
        // strip it so we don't double-bullet in the PDF.
        // Reference resume renders cert items as plain lines under
        // each subgroup title (no bullet glyph), so we do the same — it
        // packs more density into the sidebar without looking like a
        // checklist.
        const clean = item.replace(/^[\u2022\u00B7•]\s*/, '');
        leftCol.paragraph(clean, { size: 9.5, lineHeight: 12 });
      });
      if (idx < data.certifications.length - 1) leftCol.gap(3);
    });
  }

  // ── RIGHT COLUMN ───────────────────────────────────────────────────
  if (data.experience && data.experience.length) {
    rightCol.sectionHeader('Work Experience');
    data.experience.forEach(function (j) {
      // Keep job title + first dateline together — orphaned headers
      // look broken at a column boundary.
      rightCol.ensure(28);
      rightCol.activate();
      // Line 1: "<role>, <company>" (bold)
      setBody({ bold: true, size: 11 });
      const titleLine = j.title + (j.company ? ', ' + j.company : '');
      const titleLines = doc.splitTextToSize(titleLine, rightCol.w);
      for (let ti = 0; ti < titleLines.length; ti++) {
        rightCol.ensure(13);
        rightCol.activate();
        doc.text(titleLines[ti], rightCol.x, rightCol.y);
        rightCol.y += 13;
      }
      // Line 2: "<period>, <location>" (bold, slightly smaller)
      if (j.period || j.location) {
        const dateLine = j.period + (j.location ? ', ' + j.location : '');
        rightCol.ensure(12);
        rightCol.activate();
        setBody({ bold: true, size: 10 });
        doc.text(dateLine, rightCol.x, rightCol.y);
        rightCol.y += 12;
        setBody();
      }
      (j.bullets || []).forEach(function (b) { rightCol.bullet(b); });
      rightCol.gap(6);
    });
  }

  // ── PROJECTS (full-width footer) ───────────────────────────────────
  // Place below whichever column ended deeper. If neither column
  // reached the last page, project section may need its own pages.
  if (data.projects && data.projects.length) {
    const lastPage = Math.max(leftCol.page, rightCol.page);
    const leftY    = (leftCol.page  === lastPage) ? leftCol.y  : MARGIN;
    const rightY   = (rightCol.page === lastPage) ? rightCol.y : MARGIN;
    let projY    = Math.max(leftY, rightY) + 14;

    doc.setPage(lastPage);
    let projPage = lastPage;

    // If we're nearly at page bottom, push to a new page.
    if (projY + 50 > BOTTOM) {
      doc.addPage();
      projPage = doc.internal.getNumberOfPages();
      doc.setPage(projPage);
      projY = SUBSEQUENT_PAGE_TOP;
    }

    setBody({ bold: true, size: 12 });
    doc.text('Projects', LEFT_X, projY);
    projY += 16;
    setBody();

    function ensureFull(needed) {
      if (projY + needed > BOTTOM) {
        doc.addPage();
        projPage = doc.internal.getNumberOfPages();
        doc.setPage(projPage);
        projY = SUBSEQUENT_PAGE_TOP;
      }
    }

    data.projects.forEach(function (p, idx) {
      ensureFull(28);
      // "Project N: <title>" prefix matches the reference resume's
      // numbered projects pattern. ATS parsers latch onto the prefix
      // as a project boundary which makes downstream extraction more
      // reliable than free-form titles.
      // Joiner is a comma rather than an em-dash because most page
      // titles already contain an em-dash (e.g. "PLDT — Order
      // Management") — using "—" again would produce an awkward
      // double-dash line.
      const projTitle = 'Project ' + (idx + 1) + ': ' + p.title;
      const titleLine = p.tag ? projTitle + ', ' + p.tag : projTitle;
      setBody({ bold: true, size: 11 });
      const titleLines = doc.splitTextToSize(titleLine, FULL_W);
      titleLines.forEach(function (tl) {
        ensureFull(13);
        doc.text(tl, LEFT_X, projY);
        projY += 13;
      });
      setBody();
      (p.bullets || []).forEach(function (b) {
        const lines = doc.splitTextToSize(b, FULL_W - 14);
        lines.forEach(function (ln, i) {
          ensureFull(12);
          if (i === 0) doc.text('•', LEFT_X, projY);
          doc.text(ln, LEFT_X + 12, projY);
          projY += 12;
        });
      });
      if (idx < data.projects.length - 1) projY += 6;
    });
  }

  return doc;
}

// ── Preview-modal state ──
// We hold the rendered jsPDF document and a derived blob URL between
// "preview is open" and "user clicks Download". Both get cleared on
// close so we don't leak object URLs across multiple opens.
let _currentDoc      = null;
let _currentBlobUrl  = null;
// Filename mirrors the canonical, ATS-passing reference resume so a
// recruiter who searches their inbox/downloads for either spelling
// finds the same document.
const _currentFilename = 'Abhinav_Kumar_Senior_Salesforce_Application_Engineer.pdf';

function whenMdDialogReady(cb) {
  if (customElements.get('md-dialog')) { cb(); return; }
  customElements.whenDefined('md-dialog').then(cb);
}

function clearPreviewState() {
  if (_currentBlobUrl) {
    try { URL.revokeObjectURL(_currentBlobUrl); } catch (_) {}
  }
  _currentDoc     = null;
  _currentBlobUrl = null;
  const iframe = document.getElementById('resumePreviewFrame');
  if (iframe) iframe.removeAttribute('src');
}

/**
 * Public API — opens the preview modal. Lazy-loads jsPDF, renders the
 * PDF from the live DOM, embeds the resulting blob in an iframe inside
 * <md-dialog id="resumePreviewOverlay">. The visitor reviews, then
 * clicks Download (→ `downloadResumePdf`) or Close (→ `closeResumePreview`).
 *
 * Manages the trigger button's loading state during generation.
 * Errors surface as a single user-visible alert; everything else is
 * silent so we don't spam the console for non-developers.
 */
export function generateResumePdf() {
  const btn = document.querySelector('.download-resume-btn');
  const lbl = btn && btn.querySelector('[data-i18n="downloadResume"]');
  const origLabel = lbl ? lbl.textContent : '';
  if (btn) btn.setAttribute('aria-busy', 'true');
  if (btn) btn.disabled = true;
  if (lbl) lbl.textContent = 'Generating\u2026';

  return loadJsPDF()
    .then(function (jsPDF) {
      // If a previous preview was open we revoke its blob URL before
      // creating a new one — otherwise repeated clicks leak memory.
      clearPreviewState();
      _currentDoc     = renderResumePdf(jsPDF, getResumeData());
      _currentBlobUrl = URL.createObjectURL(_currentDoc.output('blob'));
      openResumePreview(_currentBlobUrl);
    })
    .catch(function (err) {
      console.error('[resume] generation failed:', err);
      alert('Sorry — resume generation failed. Please try again, or use the Refer Me option to share my profile.');
    })
    .then(function () {
      if (lbl) lbl.textContent = origLabel || 'Download Resume';
      if (btn) btn.disabled = false;
      if (btn) btn.removeAttribute('aria-busy');
    });
}

function openResumePreview(blobUrl) {
  const overlay = document.getElementById('resumePreviewOverlay');
  const iframe  = document.getElementById('resumePreviewFrame');
  if (!overlay || !iframe) {
    // Modal markup missing — fall back to direct save so the click still
    // delivers the file. Defensive only; index.html ships the markup.
    if (_currentDoc) _currentDoc.save(_currentFilename);
    return;
  }
  // #toolbar=0 hides the browser PDF chrome on Chromium so the preview
  // looks framed by *our* modal, not by the browser. Honoured by Chrome,
  // Edge, Opera; harmless elsewhere.
  iframe.src = blobUrl + '#toolbar=0';
  whenMdDialogReady(function () {
    if (typeof overlay.show === 'function') overlay.show();
    else overlay.removeAttribute('hidden');
  });
}

/**
 * Save the currently-previewed PDF to disk. Called from the modal's
 * primary "Download" button. Idempotent — clicking twice just saves
 * twice. We close the modal after a successful save so the visitor
 * isn't left staring at a now-stale preview.
 */
export function downloadResumePdf() {
  if (!_currentDoc) {
    // Modal somehow open without a doc (e.g. user opened devtools and
    // poked at things) — bail gracefully rather than crashing.
    closeResumePreview();
    return;
  }
  // Best-effort analytics (must never block download UX).
  try {
    const cid = localStorage.getItem('portfolio_anon_cid_v1') || '';
    if (navigator.sendBeacon && cid) {
      const payload = JSON.stringify({ clientId: cid, type: 'pdf_download', pdfKind: 'resume', pdfId: _currentFilename, path: location.pathname + location.search });
      navigator.sendBeacon('/api/analytics/event', new Blob([payload], { type: 'application/json' }));
    }
  } catch (_) {}
  _currentDoc.save(_currentFilename);
  closeResumePreview();
}

export function closeResumePreview() {
  const overlay = document.getElementById('resumePreviewOverlay');
  if (overlay) {
    if (typeof overlay.close === 'function') overlay.close();
    else overlay.setAttribute('hidden', '');
  }
  // Clear blob URL + doc on close. If md-dialog fires its own `close`
  // event later, the listener wired up in index.html will call this
  // again; clearPreviewState is idempotent so double-close is safe.
  clearPreviewState();
}
