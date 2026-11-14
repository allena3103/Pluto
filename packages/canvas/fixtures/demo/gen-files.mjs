// Writes the synthetic Canvas fixture PDFs in ./files. Run from the repo root:
//   node packages/canvas/fixtures/demo/gen-files.mjs
// All text is invented for the demo. Never put real course material here.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
