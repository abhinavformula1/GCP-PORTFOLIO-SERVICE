/**
 * Runtime resume generator — first ES module extracted from main.js.
 *
 * The "Download Resume" button doesn't link to a static PDF anywhere. It
 * builds one on demand by scraping the live portfolio DOM (About Me,
 * Skills, Experience, Projects, Education, Certifications) and laying
 * the content out as a clean A4 document via jsPDF.
 *
 * Why runtime:
 *   1. Single source of truth — the resume is whatever the portfolio
 *      page currently renders. Edit one section, the next download
 *      reflects it. No "remember to update the PDF too" foot-gun.
 *   2. Locale-aware — i18n changes the DOM, the resume changes with it.
 *      A French recruiter who flips the language gets a French resume.
 *   3. Always selectable text (vector PDF, not a rasterized screenshot)
 *      — recruiter ATS systems can paste the content into structured
 *      fields without OCR.
 *
 * jsPDF is loaded from a CDN on first click (lazy), so visitors who
 * never download pay zero bytes for it.
 *
 * Module shape: only `generateResumePdf` is exported. Everything else
 * is private to this file (the loader, the DOM scraper, the layout
 * engine). main.js re-exports the function onto `window` so the inline
 * onclick="…" attribute in index.html keeps working.
 */

var JSPDF_CDN = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';
var _jspdfLoadPromise = null;

function loadJsPDF() {
  if (_jspdfLoadPromise) return _jspdfLoadPromise;
  _jspdfLoadPromise = new Promise(function (resolve, reject) {
    var s = document.createElement('script');
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

  var data = {
    name:     'Abhinav Kumar',
    title:    txt(document.querySelector('[data-i18n="headerTitle"]')),
    contact:  { email: 'abhinavformula1@gmail.com' },
    summary:  arr('.about-text').map(txt).filter(Boolean),
    skills:   [],
    experience: [],
    projects:   [],
    education:  null,
    certifications: [],
  };

  arr('.skill-group').forEach(function (g) {
    var label = txt(g.querySelector('.skill-group-label'));
    var tags  = arr('.tag', g).map(txt).filter(Boolean);
    if (label && tags.length) data.skills.push({ label: label, tags: tags });
  });

  arr('.job').forEach(function (j) {
    var bullets = arr('.job-bullets li', j).map(txt).filter(Boolean);
    data.experience.push({
      title:   txt(j.querySelector('.job-title')),
      period:  txt(j.querySelector('.job-period')),
      company: txt(j.querySelector('.job-company')),
      bullets: bullets,
    });
  });

  arr('.project').forEach(function (p) {
    var bullets = arr('.job-bullets li', p).map(txt).filter(Boolean);
    data.projects.push({
      title:   txt(p.querySelector('.project-title')),
      tag:     txt(p.querySelector('.project-tag')),
      bullets: bullets,
    });
  });

  var eduSection = arr('.section').find(function (s) {
    var t = txt(s.querySelector('.section-title')).toLowerCase();
    return t === 'education' || t === 'formation' || t.indexOf('educat') === 0;
  });
  if (eduSection) {
    data.education = {
      name:   txt(eduSection.querySelector('.edu-name')),
      degree: arr('.edu-degree', eduSection).map(txt).filter(Boolean),
      year:   txt(eduSection.querySelector('.edu-year')),
    };
  }

  arr('.cert-group').forEach(function (g) {
    var items = arr('.cert-item', g).map(txt).filter(Boolean);
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
 * Render `data` into a jsPDF document. All layout is single-column,
 * margin = 40pt on A4 (595×842). The y cursor is tracked manually so
 * we can page-break when content runs past the bottom margin.
 */
function renderResumePdf(jsPDF, data) {
  var doc = new jsPDF({ unit: 'pt', format: 'a4' });
  var W = doc.internal.pageSize.getWidth();
  var H = doc.internal.pageSize.getHeight();
  var MARGIN = 40;
  var COL = W - 2 * MARGIN;
  var y = MARGIN;

  function ensureSpace(needed) {
    if (y + needed > H - MARGIN) {
      doc.addPage();
      y = MARGIN;
    }
  }
  function setBody(opts) {
    opts = opts || {};
    doc.setFont('helvetica', opts.bold ? 'bold' : (opts.italic ? 'italic' : 'normal'));
    doc.setFontSize(opts.size || 10);
    doc.setTextColor.apply(doc, opts.color || [20, 20, 20]);
  }
  function sectionHeader(label) {
    ensureSpace(36);
    y += 10;
    setBody({ bold: true, size: 11, color: [60, 90, 200] });
    doc.text(label.toUpperCase(), MARGIN, y);
    doc.setDrawColor(220);
    doc.setLineWidth(0.5);
    doc.line(MARGIN, y + 4, W - MARGIN, y + 4);
    y += 18;
    setBody();
  }
  function paragraph(text, opts) {
    opts = opts || {};
    var size = opts.size || 10;
    setBody(opts);
    var lines = doc.splitTextToSize(text, COL);
    lines.forEach(function (line) {
      ensureSpace(size + 4);
      doc.text(line, MARGIN, y);
      y += size + 3;
    });
  }
  function bullets(items) {
    if (!items || !items.length) return;
    setBody();
    items.forEach(function (item) {
      var lines = doc.splitTextToSize(item, COL - 14);
      lines.forEach(function (line, i) {
        ensureSpace(14);
        if (i === 0) doc.text('•', MARGIN, y);
        doc.text(line, MARGIN + 12, y);
        y += 13;
      });
      y += 1;
    });
  }
  function rightAligned(text, baselineY, opts) {
    setBody(opts);
    var w = doc.getTextWidth(text);
    doc.text(text, W - MARGIN - w, baselineY);
    setBody();
  }

  // ── Header ──────────────────────────────────────────────────────────────
  setBody({ bold: true, size: 22 });
  doc.text(data.name, MARGIN, y + 22);
  y += 30;
  if (data.title)         { paragraph(data.title, { size: 11, color: [80, 80, 80] }); }
  if (data.contact.email) {
    setBody({ size: 10, color: [60, 90, 200] });
    doc.textWithLink(data.contact.email, MARGIN, y, { url: 'mailto:' + data.contact.email });
    y += 14;
    setBody();
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  if (data.summary.length) {
    sectionHeader('Summary');
    data.summary.forEach(function (p) { paragraph(p); y += 4; });
  }

  // ── Skills ──────────────────────────────────────────────────────────────
  if (data.skills.length) {
    sectionHeader('Skills');
    data.skills.forEach(function (g) {
      ensureSpace(18);
      var label = g.label + ': ';
      setBody({ bold: true });
      doc.text(label, MARGIN, y);
      var labelW = doc.getTextWidth(label);
      setBody();
      var tagsText = g.tags.join(', ');
      var lines = doc.splitTextToSize(tagsText, COL - labelW);
      if (lines.length) doc.text(lines[0], MARGIN + labelW, y);
      y += 13;
      for (var i = 1; i < lines.length; i++) {
        ensureSpace(13); doc.text(lines[i], MARGIN, y); y += 13;
      }
      y += 3;
    });
  }

  // ── Experience ──────────────────────────────────────────────────────────
  if (data.experience.length) {
    sectionHeader('Experience');
    data.experience.forEach(function (j) {
      ensureSpace(48);
      setBody({ bold: true, size: 11 });
      doc.text(j.title, MARGIN, y);
      if (j.period) rightAligned(j.period, y, { size: 10, color: [110, 110, 110] });
      y += 13;
      if (j.company) paragraph(j.company, { italic: true, color: [80, 80, 80] });
      bullets(j.bullets);
      y += 4;
    });
  }

  // ── Projects ────────────────────────────────────────────────────────────
  if (data.projects.length) {
    sectionHeader('Key Projects');
    data.projects.forEach(function (p) {
      ensureSpace(36);
      setBody({ bold: true, size: 11 });
      doc.text(p.title, MARGIN, y);
      y += 13;
      if (p.tag) paragraph(p.tag, { italic: true, size: 9, color: [110, 110, 110] });
      bullets(p.bullets);
      y += 4;
    });
  }

  // ── Education ───────────────────────────────────────────────────────────
  if (data.education) {
    sectionHeader('Education');
    ensureSpace(40);
    setBody({ bold: true, size: 11 });
    doc.text(data.education.name, MARGIN, y);
    if (data.education.year) rightAligned(data.education.year, y, { size: 10, color: [110, 110, 110] });
    y += 13;
    data.education.degree.forEach(function (d) {
      ensureSpace(12);
      setBody();
      doc.text(d, MARGIN, y); y += 12;
    });
    y += 4;
  }

  // ── Certifications ──────────────────────────────────────────────────────
  if (data.certifications.length) {
    sectionHeader('Certifications');
    data.certifications.forEach(function (g) {
      ensureSpace(20);
      if (g.title) {
        setBody({ bold: true });
        doc.text(g.title, MARGIN, y);
        y += 13;
      }
      setBody();
      g.items.forEach(function (item) {
        // The rendered DOM nodes include a leading bullet glyph; strip it
        // so the PDF doesn't end up with double bullets.
        var clean = item.replace(/^[\u2022\u00B7•]\s*/, '');
        var lines = doc.splitTextToSize(clean, COL - 14);
        lines.forEach(function (line, i) {
          ensureSpace(12);
          if (i === 0) doc.text('•', MARGIN, y);
          doc.text(line, MARGIN + 12, y);
          y += 12;
        });
      });
      y += 4;
    });
  }

  return doc;
}

/**
 * Public API — call from the Download Resume button click handler.
 * Manages button loading state, lazy-loads jsPDF on first call, scrapes
 * the live page, renders, triggers the browser save dialog. Errors
 * surface as a single user-visible alert; everything else is silent.
 */
export function generateResumePdf() {
  var btn = document.querySelector('.download-resume-btn');
  var lbl = btn && btn.querySelector('[data-i18n="downloadResume"]');
  var origLabel = lbl ? lbl.textContent : '';
  if (btn) btn.setAttribute('aria-busy', 'true');
  if (btn) btn.disabled = true;
  if (lbl) lbl.textContent = 'Generating\u2026';

  return loadJsPDF()
    .then(function (jsPDF) {
      var doc = renderResumePdf(jsPDF, getResumeData());
      doc.save('Abhinav-Kumar-Resume.pdf');
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
