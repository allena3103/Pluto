import { describe, expect, it } from "vitest";
import {
  buildAssignmentFileRow,
  buildAssignmentRow,
  classifyFileType,
  DESCRIPTION_MAX_CHARS,
  descriptionToText,
  linkedFileIds,
} from "../../src/map";
import type { CanvasAssignment, CanvasFileMeta } from "../../src/types";

const CANVAS = "https://umamherst.instructure.com";
const COURSE = "10001";
const STUDENT = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-11-14T15:00:00.000Z");
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// The shape Canvas's rich content editor saves: file links carry `instructure_file_link` and a
// `data-api-endpoint`; inline images point at `/files/:id/preview`.
const MILESTONE_HTML = `
<link rel="stylesheet" href="https://instructure-uploads.s3.amazonaws.com/account_1/theme.css"><p>&nbsp;</p>
<h2>BIA Project Milestone</h2>
<p>For this milestone, complete the <strong>Business Impact Analysis</strong> &amp; submit it as a Word file.&nbsp; Use the template below.</p>
<ul>
<li>Identify critical business processes<ul><li>at least 3 processes</li><li>rank by impact &mdash; high, medium, low</li></ul></li>
<li>Estimate the RTO &amp; RPO</li>
</ul>
<p><a class="instructure_file_link instructure_scribd_file inline_disabled" title="BIA_Project_Description.docx" href="${CANVAS}/courses/${COURSE}/files/12345678?wrap=1&amp;verifier=SECRETv1" target="_blank" data-canvas-previewable="false" data-api-endpoint="${CANVAS}/api/v1/courses/${COURSE}/files/12345678" data-api-returntype="File">BIA_Project_Description.docx</a></p>
<p><img src="${CANVAS}/courses/${COURSE}/files/999/preview" alt="Template icon" data-api-endpoint="${CANVAS}/api/v1/courses/${COURSE}/files/999" data-api-returntype="File" /></p>
<script>window.alert("x")</script><style>p { color: red; }</style>
<table><tbody><tr><th>Criteria</th><th>Points</th></tr><tr><td>Processes</td><td>10</td></tr></tbody></table>
<p>Due by 11:59&nbsp;pm &lt;ET&gt; &#8212; late work loses 10&#37;.</p>`;

function file(overrides: Partial<CanvasFileMeta> = {}): CanvasFileMeta {
  return {
    canvasFileId: "12345678",
    title: "BIA_Project_Description.docx",
    contentType: DOCX,
    sizeBytes: 20_172,
    updatedAt: "2026-10-01T12:00:00Z",
    url: `${CANVAS}/files/12345678/download?download_frd=1&verifier=SECRETv1`,
    ...overrides,
  };
}

describe("descriptionToText", () => {
  it("turns a Canvas description into readable plain text", () => {
    expect(descriptionToText(MILESTONE_HTML)).toBe(
      [
        "BIA Project Milestone",
        "",
        "For this milestone, complete the Business Impact Analysis & submit it as a Word file. Use the template below.",
        "",
        "- Identify critical business processes",
        "  - at least 3 processes",
        "  - rank by impact \u2014 high, medium, low",
        "- Estimate the RTO & RPO",
        "",
        "BIA_Project_Description.docx",
        "",
        "Criteria | Points",
        "Processes | 10",
        "",
        "Due by 11:59 pm <ET> \u2014 late work loses 10%.",
      ].join("\n"),
    );
  });

  it("keeps line breaks, handles paragraphs inside list items and leaves unknown entities alone", () => {
    expect(descriptionToText("<div>Line one<br>Line two<br/><br>Line four</div><ol><li><p>Step one</p></li><li>Step &copy; two &bogus;</li></ol>")).toBe(
      "Line one\nLine two\n\nLine four\n\n- Step one\n- Step \u00a9 two &bogus;",
    );
  });

  it("gives an item that only wraps a nested list (Canvas's indent button) no marker of its own", () => {
    const html =
      '<p>Include:</p><ul><li style="list-style-type: none;"><ul><li>A description of your data set</li>' +
      '<li>Research questions</li><li style="list-style-type: none;"><ul><li>Which product sold most?</li></ul></li></ul></li></ul>';
    expect(descriptionToText(html)).toBe(
      "Include:\n\n  - A description of your data set\n  - Research questions\n    - Which product sold most?",
    );
    expect(descriptionToText('<ul><li style="list-style-type: none;"><ul><li>Indented first</li></ul></li></ul>')).toBe("  - Indented first");
  });

  it("is null when nothing readable is left", () => {
    expect(descriptionToText(null)).toBeNull();
    expect(descriptionToText("")).toBeNull();
    expect(descriptionToText('<p>&nbsp;</p><p><img src="/x.png"></p><script>x()</script>')).toBeNull();
  });

  it("drops NUL characters and caps the text without splitting a character", () => {
    expect(descriptionToText("<p>a\u0000b &#0;c</p>")).toBe("ab &#0;c");
    const long = descriptionToText(`<p>${"x".repeat(DESCRIPTION_MAX_CHARS - 1)}\u{1F600}tail</p>`)!;
    expect(long.length).toBe(DESCRIPTION_MAX_CHARS - 1);
    expect(long.endsWith("x")).toBe(true);
  });
});

describe("hostile description HTML", () => {
  const timed = (run: () => unknown): number => {
    const start = performance.now();
    run();
    return performance.now() - start;
  };

  it.each([
    ["whitespace between inline tags", "<i></i> ".repeat(200_000)],
    ["'<a ' inside an unclosed attribute value", `<p><img alt="${"<a ".repeat(200_000)}`],
    ["'<a ' inside a closed attribute value", `<p><img title='${"<a ".repeat(60_000)}'><a href="/files/7">x</a></p>`],
    ["'<a' with no tag end", "<a".repeat(100_000)],
  ])("%s is parsed in under 500 ms", (_label, html) => {
    expect(timed(() => descriptionToText(html))).toBeLessThan(500);
    expect(timed(() => linkedFileIds(html, COURSE))).toBeLessThan(500);
  });

  it("reads only the first 200,000 characters and never treats markup inside an attribute as a link", () => {
    const late = `${"<p>x</p>".repeat(30_000)}<a href="/files/9">late</a>`;
    expect(linkedFileIds(late, COURSE)).toEqual([]);
    expect(linkedFileIds(`<img alt="<a href='/files/9'>"><a href="/files/8">x</a>`, COURSE)).toEqual(["8"]);
    expect(descriptionToText("<i>a</i> <i></i> <b> b</b>")).toBe("a b");
  });
});

describe("linkedFileIds", () => {
  it("finds file links in order, once each, and ignores image previews", () => {
    expect(linkedFileIds(MILESTONE_HTML, COURSE)).toEqual(["12345678"]);

    const html = `
      <p><a class="instructure_file_link" href="${CANVAS}/courses/${COURSE}/files/201?wrap=1" data-api-endpoint="${CANVAS}/api/v1/courses/${COURSE}/files/201" data-api-returntype="File">Case.pdf</a></p>
      <p><a href='/courses/${COURSE}/files/202/download?download_frd=1'>Data.xlsx</a></p>
      <p><a href="${CANVAS}/files/203/download">Shared.docx</a></p>
      <p><a href="${CANVAS}/courses/${COURSE}/files/201/preview">Case.pdf again</a></p>
      <p><a href="${CANVAS}/courses/${COURSE}/files/204~5">Sharded id</a></p>`;
    expect(linkedFileIds(html, COURSE)).toEqual(["201", "202", "203", "204~5"]);
  });

  it("ignores other courses, folders, user files, pages and commented-out links", () => {
    const html = `
      <a href="${CANVAS}/courses/99999/files/301" data-api-endpoint="${CANVAS}/api/v1/courses/99999/files/301">Other course</a>
      <a href="${CANVAS}/courses/${COURSE}/files/folder/Assignments">A folder</a>
      <a href="${CANVAS}/users/7/files/302">User file</a>
      <a href="${CANVAS}/courses/${COURSE}/pages/syllabus">Syllabus</a>
      <a href="mailto:prof@example.edu">Email</a>
      <!-- <a href="${CANVAS}/courses/${COURSE}/files/303">old link</a> -->
      <img src="${CANVAS}/courses/${COURSE}/files/304/preview" data-api-endpoint="${CANVAS}/api/v1/courses/${COURSE}/files/304">`;
    expect(linkedFileIds(html, COURSE)).toEqual([]);
    expect(linkedFileIds(null, COURSE)).toEqual([]);
  });

  it("prefers data-api-endpoint over href", () => {
    const html = `<a href="${CANVAS}/courses/${COURSE}/files/401?wrap=1" data-api-endpoint="${CANVAS}/api/v1/courses/${COURSE}/files/402">x</a>`;
    expect(linkedFileIds(html, COURSE)).toEqual(["402"]);
  });
});

describe("classifyFileType", () => {
  it.each([
    ["BIA_Project_Description.docx", DOCX, "docx"],
    ["template.docx", null, "docx"],
    ["Case.pdf", "application/pdf", "pdf"],
    ["scan", "application/x-pdf; charset=binary", "pdf"],
    ["Notes.PDF", "application/octet-stream", "pdf"],
    ["data.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "other"],
    ["database.accdb", "application/msaccess", "other"],
    ["icon.svg", "image/svg+xml", "other"],
    ["old.doc", "application/msword", "other"],
    ["constructor", "constructor", "other"],
  ] as const)("%s (%s) is %s", (title, contentType, expected) => {
    expect(classifyFileType({ title, contentType })).toBe(expected);
  });
});

describe("attachment rows", () => {
  it("never stores the download URL; other files are skipped, new pdf/docx pending, saved status kept", () => {
    const docx = buildAssignmentFileRow({ studentId: STUDENT, assignmentId: "a1", file: file(), existing: null, now: NOW });
    expect(docx).toEqual({
      student_id: STUDENT,
      assignment_id: "a1",
      canvas_file_id: "12345678",
      title: "BIA_Project_Description.docx",
      file_type: "docx",
      size_bytes: 20_172,
      canvas_updated_at: "2026-10-01T12:00:00Z",
      ingest_status: "pending",
      ingest_attempts: 0,
      updated_at: NOW.toISOString(),
    });
    expect(JSON.stringify(docx)).not.toContain("verifier");

    const saved = {
      id: "f1",
      assignmentId: "a1",
      canvasFileId: "12345678",
      fileType: "docx",
      canvasUpdatedAt: "2026-10-01T12:00:00+00:00",
    };
    const row = (existing: { ingestStatus: string; ingestAttempts: number }, updatedAt = "2026-10-01T12:00:00Z") =>
      buildAssignmentFileRow({ studentId: STUDENT, assignmentId: "a1", file: file({ updatedAt }), existing: { ...saved, ...existing }, now: NOW });

    // Same Canvas version: status and attempts stay (a used-up failure stays failed).
    expect(row({ ingestStatus: "ready", ingestAttempts: 0 })).toMatchObject({ ingest_status: "ready", ingest_attempts: 0 });
    expect(row({ ingestStatus: "failed", ingestAttempts: 2 })).toMatchObject({ ingest_status: "failed", ingest_attempts: 2 });
    // A newer version: fresh attempts; a failed row goes back to pending, a ready one keeps its text.
    expect(row({ ingestStatus: "failed", ingestAttempts: 2 }, "2026-11-02T00:00:00Z")).toMatchObject({ ingest_status: "pending", ingest_attempts: 0 });
    expect(row({ ingestStatus: "ready", ingestAttempts: 1 }, "2026-11-02T00:00:00Z")).toMatchObject({ ingest_status: "ready", ingest_attempts: 0 });
    // An older or unreadable date is not a newer version.
    expect(row({ ingestStatus: "failed", ingestAttempts: 2 }, "2026-09-01T00:00:00Z")).toMatchObject({ ingest_status: "failed", ingest_attempts: 2 });

    const sheet = buildAssignmentFileRow({
      studentId: STUDENT,
      assignmentId: "a1",
      file: file({ title: "x".repeat(400) + ".xlsx", contentType: "application/vnd.ms-excel", sizeBytes: -1, updatedAt: "not a date" }),
      existing: null,
      now: NOW,
    });
    expect(sheet).toMatchObject({ file_type: "other", ingest_status: "skipped", size_bytes: null, canvas_updated_at: null });
    expect(sheet.title).toHaveLength(300);
  });

  it("stores the description as text and the Canvas link only when it is https", () => {
    const assignment: CanvasAssignment = {
      canvasAssignmentId: "900",
      title: "BIA Project Milestone",
      dueAt: null,
      pointsPossible: 100,
      canvasGroupId: null,
      score: null,
      graded: false,
      submitted: false,
      descriptionHtml: "<p>Read the <a href='/courses/1/files/2'>brief</a>.</p>",
      htmlUrl: `${CANVAS}/courses/${COURSE}/assignments/900`,
    };
    const built = (overrides: Partial<CanvasAssignment>) =>
      buildAssignmentRow({ studentId: STUDENT, courseId: "c1", gradeGroupId: null, assignment: { ...assignment, ...overrides }, saved: null, now: NOW }).row;

    expect(built({})).toMatchObject({ description: "Read the brief.", canvas_url: `${CANVAS}/courses/${COURSE}/assignments/900` });
    expect(built({ htmlUrl: "http://canvas.example/courses/1/assignments/900" }).canvas_url).toBeNull();
    expect(built({ htmlUrl: "javascript:alert(1)", descriptionHtml: null })).toMatchObject({ canvas_url: null, description: null });
  });
});
