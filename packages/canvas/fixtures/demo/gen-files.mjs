// Writes the synthetic Canvas fixture files in ./files (PDFs, plus one Word file used as an
// assignment attachment). Run from the repo root:
//   node packages/canvas/fixtures/demo/gen-files.mjs
// All text is invented for the demo. Never put real course material here.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32 } from "node:zlib";
import { PDFDocument, StandardFonts } from "pdf-lib";

const here = dirname(fileURLToPath(import.meta.url));
const files = {
  "hist-week-7.pdf": [
    "History 105 - Week 7 (Canvas). The Congress of Vienna, 1814-1815, redrew the map of Europe after Napoleon.",
    "Week 7 page 2. Metternich's Concert of Europe aimed to keep a balance of power and stop new revolutions.",
    "Week 7 page 3. The revolutions of 1848 spread from Paris to Vienna and Berlin within a few weeks.",
  ],
  "bio-lab-3.pdf": [
    "Biology 151 - Lab 3 Prep (Canvas). Bring goggles. Today we measure enzyme activity at three temperatures.",
    "Lab 3 page 2. Catalase breaks hydrogen peroxide into water and oxygen; count bubbles for 60 seconds.",
  ],
  "stat-regression.pdf": [
    "Statistics 240 - Regression Notes (Canvas). The least squares line minimizes the sum of squared residuals.",
    "Regression page 2. R squared is the share of the variance in y explained by the linear model.",
  ],
  // Assignment attachment (Statistics 240, Project Proposal), linked from its description.
  "stat-proposal-guidelines.pdf": [
    "Statistics 240 - Project Proposal Guidelines (Canvas). The proposal is two pages long and names one research question.",
    "Guidelines page 2. Include a scatterplot of your two main variables and one sentence about any outliers.",
  ],
};

// Assignment attachments (Word). Each string is one paragraph.
const wordFiles = {
  "stat-proposal-template.docx": [
    "Statistics 240 - Project Proposal Template (Canvas)",
    "1. Research question: state one question your dataset can answer.",
    "2. Data source: name the dataset and say how many rows it has.",
    "3. Planned method: say which regression you will run and why it fits the question.",
  ],
  // Biology 151 Lab Report 3 handout: same text as its seeded page in supabase/seed.sql.
  "bio-lab3-handout.docx": [
    "Lab 3 Handout: Mitosis in Onion Root Tips. Count 200 cells under the microscope and record how many are in interphase, prophase, metaphase, anaphase and telophase. Your report must include a mitotic index table, a labeled drawing of each phase, and a discussion of why the root tip has so many dividing cells. Length: 4 to 6 pages, double spaced. Due at 11:59 PM; late reports lose 10 percent per day.",
  ],
};

mkdirSync(join(here, "files"), { recursive: true });
for (const [name, pages] of Object.entries(files)) {
  const doc = await PDFDocument.create();
  doc.setTitle(name);
  doc.setCreationDate(new Date("2026-11-01T00:00:00Z"));
  doc.setModificationDate(new Date("2026-11-01T00:00:00Z"));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of pages) {
    const page = doc.addPage([612, 792]);
    const words = text.split(" ");
    let line = "";
    let y = 720;
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, 12) > 512) {
        page.drawText(line, { x: 50, y, size: 12, font });
        y -= 18;
        line = word;
      } else {
        line = next;
      }
    }
    if (line) page.drawText(line, { x: 50, y, size: 12, font });
  }
  writeFileSync(join(here, "files", name), await doc.save({ useObjectStreams: false }));
}
console.log(`wrote ${Object.keys(files).length} PDFs`);

/** A stored (uncompressed) zip: enough for a .docx that Word and mammoth open. */
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const data = Buffer.from(text, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x21, 12); // 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

for (const [name, paragraphs] of Object.entries(wordFiles)) {
  const body = paragraphs
    .map((text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"))
    .map((text) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`)
    .join("");
  writeFileSync(
    join(here, "files", name),
    zip([
      [
        "[Content_Types].xml",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      ],
      [
        "_rels/.rels",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      ],
      [
        "word/document.xml",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
      ],
    ]),
  );
}
console.log(`wrote ${Object.keys(wordFiles).length} Word files`);
