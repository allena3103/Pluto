import { describe, expect, it } from "vitest";
import { createCanvasClient } from "../../src/client";
import { createDiskFixturesFetch } from "../../src/sync";
import type { CanvasAssignment, CanvasAssignmentGroup, CanvasCourseFile } from "../../src/types";
import {
  buildAssignmentRow,
  buildFileRow,
  buildGradeGroupRow,
  decideDueDate,
  fileStoragePath,
  sameInstant,
} from "../../src/map";

const NOW = new Date("2026-11-14T15:00:00.000Z");
const STUDENT = "11111111-1111-4111-8111-111111111111";

function assignment(overrides: Partial<CanvasAssignment> = {}): CanvasAssignment {
  return {
    canvasAssignmentId: "seed-102",
    title: "Reading Response 5",
    dueAt: "2026-11-26T04:59:00.000Z",
    pointsPossible: 20,
    canvasGroupId: "seed-hist-responses",
    score: null,
    graded: false,
    submitted: false,
    ...overrides,
  };
}

describe("disk fixtures fetch", () => {
  it("matches the package fixtures client, including resolved due dates", async () => {
    const now = () => new Date("2026-11-14T12:00:00Z");
    const baseUrl = "https://fixtures.canvas.local";
    const real = createCanvasClient({ baseUrl, token: "unused", mode: "fixtures", now });
    const disk = createCanvasClient({
      baseUrl,
      token: "unused",
      mode: "fixtures",
      fetch: createDiskFixturesFetch(baseUrl, now),
    });

    expect(await disk.listCourses()).toEqual(await real.listCourses());
    expect(await disk.listAssignmentGroups("seed-hist-105")).toEqual(
      await real.listAssignmentGroups("seed-hist-105"),
    );
    expect(await disk.listAssignments("seed-hist-105")).toEqual(await real.listAssignments("seed-hist-105"));
    expect(await disk.listCourseFiles("seed-stat-240")).toEqual(await real.listCourseFiles("seed-stat-240"));
    expect(await disk.listModuleItems("seed-bio-151")).toEqual(await real.listModuleItems("seed-bio-151"));
  });
});

describe("due date decisions", () => {
  it("treats offset and Z timestamps of the same instant as unchanged", () => {
    expect(sameInstant("2026-11-20T04:59:00Z", "2026-11-20T04:59:00.000+00:00")).toBe(true);
    const decision = decideDueDate(
      {
        id: "a1",
        dueAt: "2026-11-20T04:59:00+00:00",
        previousDueAt: "2026-11-18T04:59:00+00:00",
        dueChangedAt: "2026-11-01T00:00:00+00:00",
      },
      "2026-11-20T04:59:00.000Z",
      NOW,
    );
    expect(decision.changed).toBe(false);
    expect(decision.previousDueAt).toBe("2026-11-18T04:59:00+00:00");
    expect(decision.dueChangedAt).toBe("2026-11-01T00:00:00+00:00");
  });

  it("records a move and keeps the saved due instant as previous_due_at", () => {
    const decision = decideDueDate(
      { id: "a1", dueAt: "2026-11-20T04:59:00+00:00", previousDueAt: null, dueChangedAt: null },
      "2026-11-22T04:59:00Z",
      NOW,
    );
    expect(decision.changed).toBe(true);
    expect(decision.previousDueAt).toBe("2026-11-20T04:59:00+00:00");
    expect(decision.dueChangedAt).toBe(NOW.toISOString());
    expect(decision.oldDueAt).toBe("2026-11-20T04:59:00.000Z");
    expect(decision.newDueAt).toBe("2026-11-22T04:59:00.000Z");
  });

  it("ignores a title-only difference, a first due date, and a cleared due date", () => {
    const saved = {
      id: "a1",
      dueAt: "2026-11-20T04:59:00Z",
      previousDueAt: "2026-11-10T04:59:00Z",
      dueChangedAt: "2026-11-01T00:00:00Z",
    };
    const titleOnly = buildAssignmentRow({
      studentId: STUDENT,
      courseId: "c1",
      gradeGroupId: null,
      assignment: assignment({ title: "Renamed", dueAt: saved.dueAt }),
      saved,
      now: NOW,
    });
    expect(titleOnly.dueChange).toBeNull();
    expect(titleOnly.row.previous_due_at).toBe(saved.previousDueAt);
    expect(titleOnly.row.title).toBe("Renamed");

    const firstDue = decideDueDate({ ...saved, dueAt: null }, "2026-11-22T04:59:00Z", NOW);
    expect(firstDue.changed).toBe(false);
    expect(firstDue.previousDueAt).toBe(saved.previousDueAt);

    const cleared = decideDueDate(saved, null, NOW);
    expect(cleared.changed).toBe(false);
    expect(cleared.previousDueAt).toBe(saved.previousDueAt);
    expect(cleared.dueChangedAt).toBe(saved.dueChangedAt);
  });
});

describe("row mapping", () => {
  it("keeps a Canvas group weight of 0", () => {
    const group: CanvasAssignmentGroup = { canvasGroupId: "g0", name: "Extra", weightPercent: 0 };
    expect(buildGradeGroupRow(STUDENT, "c1", group).weight_percent).toBe(0);
  });

  it("builds a new file as pending and keeps an existing ready file", () => {
    const file: CanvasCourseFile = {
      canvasFileId: "hist-file-1",
      title: "Week 7 Lecture Notes.pdf",
      url: "https://fixtures.canvas.local/files/hist-week-7.pdf",
      updatedAt: null,
      createdAt: "2026-09-10T14:00:00Z",
      sizeBytes: 10,
    };
    const created = buildFileRow({
      studentId: STUDENT,
      courseId: "c1",
      file,
      existing: null,
      weekLabel: "Week 7: Primary Sources",
      now: NOW,
    });
    expect(created.ingest_status).toBe("pending");
    expect(created.source).toBe("canvas");
    expect(created.storage_path).toBe(fileStoragePath(STUDENT, created.id ?? ""));
    expect(created.week_label).toBe("Week 7: Primary Sources");
    expect(created.student_id).toBe(STUDENT);

    const kept = buildFileRow({
      studentId: STUDENT,
      courseId: "c1",
      file,
      existing: {
        id: "f1",
        addedAt: "2026-09-10T14:00:00Z",
        weekLabel: "Week 7: Primary Sources",
        ingestStatus: "ready",
        ingestError: null,
        pageCount: 4,
      },
      weekLabel: "Week 7: Primary Sources",
      now: NOW,
    });
    expect(kept.id).toBe("f1");
    expect(kept.ingest_status).toBe("ready");
    expect(kept.page_count).toBe(4);
    expect(kept.storage_path).toBe(`${STUDENT}/f1.pdf`);
  });
});
