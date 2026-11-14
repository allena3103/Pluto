// `npm exec tsx scripts/gen-pdfs.ts`: writes the synthetic lecture PDFs and seed/pdfs/manifest.json.
// Output is deterministic (fixed metadata dates), so re-running does not dirty git.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { COURSE_NAMES } from "./lib/seed-ids";
import { LECTURES, type Lecture } from "./lib/lectures";

const outDir = fileURLToPath(new URL("../seed/pdfs/", import.meta.url));
const FIXED_DATE = new Date("2026-11-13T00:00:00Z");
const PAGE = { width: 612, height: 792, margin: 64 };

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

async function buildPdf(lecture: Lecture): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const courseName = COURSE_NAMES[lecture.courseKey];
  doc.setTitle(`${courseName} - ${lecture.title}`);
  doc.setAuthor("Pluto synthetic seed notes");
  doc.setProducer("Pluto gen-pdfs");
  doc.setCreator("Pluto gen-pdfs");
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const maxWidth = PAGE.width - PAGE.margin * 2;

  lecture.pages.forEach((content, index) => {
    const page = doc.addPage([PAGE.width, PAGE.height]);
    let y = PAGE.height - PAGE.margin;
    const draw = (text: string, font: PDFFont, size: number, gapAfter: number) => {
      for (const line of wrap(text, font, size, maxWidth)) {
        page.drawText(line, { x: PAGE.margin, y, size, font, color: rgb(0.1, 0.1, 0.1) });
        y -= size * 1.45;
      }
      y -= gapAfter;
    };

    if (index === 0) {
      draw(courseName, bold, 13, 2);
      draw(lecture.title, bold, 20, 10);
    } else {
      draw(`${courseName} - ${lecture.title}`, regular, 10, 10);
    }
    draw(content.heading, bold, 15, 6);
    draw(content.fact, regular, 12, 8);
    for (const paragraph of content.body) draw(paragraph, regular, 12, 8);

    const footer = `Page ${index + 1} of ${lecture.pages.length}`;
    page.drawText(footer, { x: PAGE.margin, y: PAGE.margin / 2, size: 9, font: regular, color: rgb(0.4, 0.4, 0.4) });
  });

  return doc.save({ useObjectStreams: false });
}

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  const manifest = [];
  for (const lecture of LECTURES) {
    writeFileSync(join(outDir, lecture.file), await buildPdf(lecture));
    manifest.push({
      file: lecture.file,
      courseKey: lecture.courseKey,
      title: lecture.title,
      weekLabel: lecture.weekLabel,
      addedDaysAgo: lecture.addedDaysAgo,
      pages: lecture.pages.map((p, i) => ({ page: i + 1, fact: p.fact, query: p.query })),
    });
    console.log(`gen-pdfs: ${lecture.file} (${lecture.pages.length} pages)`);
  }
  writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`gen-pdfs: wrote ${manifest.length} PDFs and manifest.json to seed/pdfs/`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
