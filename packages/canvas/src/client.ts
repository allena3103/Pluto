import { createCanvasHttpClient } from "./http";
import { createFixturesFetch } from "./fixtures";
import { mapInBatches } from "./map";
import type {
  CanvasAssignment,
  CanvasAssignmentGroup,
  CanvasClientOptions,
  CanvasCourse,
  CanvasCourseFile,
  CanvasFileMeta,
  CanvasMode,
  CanvasModuleFileItem,
} from "./types";
import { CanvasHttpError, CanvasNotFoundError } from "./types";

const MODE_FIXTURES: CanvasMode = "fixtures";
const MODE_LIVE: CanvasMode = "live";
/** Parallel single-file lookups (module files, assignment attachments). Small to stay clear of Canvas throttling. */
export const FILE_LOOKUP_CONCURRENCY = 4;

type CanvasCourseApi = {
  id: number | string;
  name?: string;
  term?: { name?: string | null } | null;
};

type CanvasAssignmentGroupApi = {
  id: number | string;
  name?: string;
  group_weight?: number | null;
};

type CanvasSubmissionApi = {
  score?: number | null;
  workflow_state?: string | null;
  submitted_at?: string | null;
};

type CanvasAssignmentApi = {
  id: number | string;
  name?: string;
  due_at?: string | null;
  points_possible?: number | null;
  assignment_group_id?: number | string | null;
  submission?: CanvasSubmissionApi | null;
  description?: string | null;
  html_url?: string | null;
};

type CanvasFileApi = {
  id: number | string;
  display_name?: string | null;
  filename?: string | null;
  "content-type"?: string | null;
  url?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  size?: number | null;
};

type CanvasModuleApi = {
  name?: string | null;
  items?: Array<{
    type?: string | null;
    content_id?: number | string | null;
  }> | null;
};

export type CanvasClient = {
  listCourses: () => Promise<CanvasCourse[]>;
  listAssignmentGroups: (canvasCourseId: string) => Promise<CanvasAssignmentGroup[]>;
  listAssignments: (canvasCourseId: string) => Promise<CanvasAssignment[]>;
  listCourseFiles: (canvasCourseId: string) => Promise<CanvasCourseFile[]>;
  listModuleItems: (canvasCourseId: string) => Promise<CanvasModuleFileItem[]>;
  /** One course file of any type by id; null when the student can't open it (403/404). */
  getCourseFile: (canvasCourseId: string, canvasFileId: string) => Promise<CanvasFileMeta | null>;
};

export function createCanvasClient(options: CanvasClientOptions): CanvasClient {
  const mode = resolveMode(options.mode);
  const fetchImpl =
    options.fetch ??
    (mode === MODE_FIXTURES ? createFixturesFetch(options.baseUrl, { now: options.now }) : fetch);
  const warnedPaths = new Set<string>();

  const http = createCanvasHttpClient({
    baseUrl: options.baseUrl,
    token: options.token,
    includeAuthHeader: mode === MODE_LIVE,
    fetchImpl,
    timeoutMs: options.timeoutMs,
    maxPages: options.maxPages,
    sleep: options.sleep,
  });

  async function listModuleItems(canvasCourseId: string): Promise<CanvasModuleFileItem[]> {
    try {
      const rows = await http.getPaginatedArray({
        path: courseApiPath(canvasCourseId, "modules"),
        endpointName: "module items",
        searchParams: new URLSearchParams({
          "include[]": "items",
          per_page: "100",
        }),
      });
      return rows.flatMap(mapModuleItems).filter((item): item is CanvasModuleFileItem => item !== null);
    } catch (error) {
      if (error instanceof CanvasHttpError && error.status === 403) {
        return [];
      }
      throw error;
    }
  }

  /** One file object by id, or null when the student can't open it (locked or unpublished: 403/404). */
  async function readFileRow(canvasCourseId: string, fileId: string, endpointName: string) {
    try {
      return await http.getObject({
        path: courseApiPath(canvasCourseId, `files/${encodeURIComponent(fileId)}`),
        endpointName,
      });
    } catch (error) {
      if (error instanceof CanvasNotFoundError) return null;
      if (error instanceof CanvasHttpError && error.status === 403) return null;
      throw error;
    }
  }

  /**
   * Many courses hide the Files tab, so `/files` is 403 for students while the same PDFs are
   * linked from Modules. Read each module file by id instead. Files the student can't open
   * are skipped; auth and rate-limit errors still throw.
   */
  async function listModuleFiles(canvasCourseId: string): Promise<CanvasCourseFile[]> {
    const ids = [...new Set((await listModuleItems(canvasCourseId)).map((item) => item.canvasFileId))];
    const files = await mapInBatches(ids, FILE_LOOKUP_CONCURRENCY, async (fileId) => {
      const row = await readFileRow(canvasCourseId, fileId, "module file");
      return row ? mapCourseFile(row) : null;
    });
    return files.filter((file): file is CanvasCourseFile => file !== null);
  }

  return {
    async listCourses() {
      const rows = await http.getPaginatedArray({
        path: "/api/v1/courses",
        endpointName: "courses",
        searchParams: new URLSearchParams({
          enrollment_state: "active",
          "include[]": "term",
          per_page: "100",
        }),
      });
      return rows.map(mapCourse).filter((course): course is CanvasCourse => course !== null);
    },

    async listAssignmentGroups(canvasCourseId) {
      const rows = await http.getPaginatedArray({
        path: courseApiPath(canvasCourseId, "assignment_groups"),
        endpointName: "assignment groups",
      });
      return rows
        .map(mapAssignmentGroup)
        .filter((group): group is CanvasAssignmentGroup => group !== null);
    },

    async listAssignments(canvasCourseId) {
      const rows = await http.getPaginatedArray({
        path: courseApiPath(canvasCourseId, "assignments"),
        endpointName: "assignments",
        searchParams: new URLSearchParams({
          "include[]": "submission",
          per_page: "100",
        }),
      });
      return rows
        .map(mapAssignment)
        .filter((assignment): assignment is CanvasAssignment => assignment !== null);
    },

    async listCourseFiles(canvasCourseId) {
      try {
        const rows = await http.getPaginatedArray({
          path: courseApiPath(canvasCourseId, "files"),
          endpointName: "course files",
        });
        return rows
          .map(mapCourseFile)
          .filter((file): file is CanvasCourseFile => file !== null);
      } catch (error) {
        if (error instanceof CanvasHttpError && error.status === 403) {
          const key = courseApiPath(canvasCourseId, "files");
          if (!warnedPaths.has(key)) {
            warnedPaths.add(key);
            console.warn(`Canvas files tab hidden for ${key}; reading files from modules.`);
          }
          return listModuleFiles(canvasCourseId);
        }
        throw error;
      }
    },

    listModuleItems,

    async getCourseFile(canvasCourseId, canvasFileId) {
      const row = await readFileRow(canvasCourseId, canvasFileId, "course file");
      return row ? mapFileMeta(row) : null;
    },
  };
}

function courseApiPath(canvasCourseId: string, resource: string): string {
  return `/api/v1/courses/${encodeURIComponent(canvasCourseId)}/${resource}`;
}

function resolveMode(mode: CanvasMode | undefined): CanvasMode {
  if (mode) {
    return mode;
  }
  return process.env.CANVAS_MODE === MODE_LIVE ? MODE_LIVE : MODE_FIXTURES;
}

function mapCourse(row: unknown): CanvasCourse | null {
  const source = row as CanvasCourseApi;
  if (!source || source.id == null || typeof source.name !== "string") {
    return null;
  }
  return {
    canvasCourseId: String(source.id),
    name: source.name,
    term: typeof source.term?.name === "string" ? source.term.name : null,
  };
}

function mapAssignmentGroup(row: unknown): CanvasAssignmentGroup | null {
  const source = row as CanvasAssignmentGroupApi;
  if (!source || source.id == null || typeof source.name !== "string") {
    return null;
  }
  return {
    canvasGroupId: String(source.id),
    name: source.name,
    weightPercent: typeof source.group_weight === "number" ? source.group_weight : 0,
  };
}

function mapAssignment(row: unknown): CanvasAssignment | null {
  const source = row as CanvasAssignmentApi;
  if (!source || source.id == null || typeof source.name !== "string") {
    return null;
  }

  const submission = source.submission ?? null;
  const workflowState = submission?.workflow_state ?? null;
  const hasScore = typeof submission?.score === "number";
  const graded = hasScore && workflowState === "graded";
  const submitted =
    submission?.submitted_at != null ||
    workflowState === "submitted" ||
    workflowState === "graded";

  return {
    canvasAssignmentId: String(source.id),
    title: source.name,
    dueAt: typeof source.due_at === "string" ? source.due_at : null,
    pointsPossible:
      typeof source.points_possible === "number" ? source.points_possible : null,
    canvasGroupId:
      source.assignment_group_id == null ? null : String(source.assignment_group_id),
    score: hasScore ? submission.score ?? null : null,
    graded,
    submitted,
    descriptionHtml: typeof source.description === "string" && source.description ? source.description : null,
    htmlUrl: typeof source.html_url === "string" ? source.html_url : null,
  };
}

function mapCourseFile(row: unknown): CanvasCourseFile | null {
  const source = row as CanvasFileApi;
  if (!source || source.id == null || typeof source.display_name !== "string") {
    return null;
  }
  if (!isPdfFile(source)) {
    return null;
  }
  return {
    canvasFileId: String(source.id),
    title: source.display_name,
    url: typeof source.url === "string" ? source.url : "",
    updatedAt: typeof source.updated_at === "string" ? source.updated_at : null,
    createdAt: typeof source.created_at === "string" ? source.created_at : null,
    sizeBytes: typeof source.size === "number" ? source.size : null,
  };
}

function mapFileMeta(row: unknown): CanvasFileMeta | null {
  const source = row as CanvasFileApi | null;
  if (!source || source.id == null) return null;
  const title = typeof source.display_name === "string" ? source.display_name : source.filename;
  if (typeof title !== "string" || !title.trim()) return null;
  return {
    canvasFileId: String(source.id),
    title,
    contentType: typeof source["content-type"] === "string" ? source["content-type"] : null,
    sizeBytes: typeof source.size === "number" ? source.size : null,
    updatedAt: typeof source.updated_at === "string" ? source.updated_at : null,
    url: typeof source.url === "string" ? source.url : "",
  };
}

function mapModuleItems(row: unknown): Array<CanvasModuleFileItem | null> {
  const source = row as CanvasModuleApi;
  const moduleName = typeof source.name === "string" ? source.name : null;
  if (!moduleName || !Array.isArray(source.items)) {
    return [];
  }

  return source.items.map((item) => {
    if (!item || item.type !== "File" || item.content_id == null) {
      return null;
    }
    return {
      moduleName,
      canvasFileId: String(item.content_id),
    };
  });
}

function isPdfFile(file: CanvasFileApi): boolean {
  const contentType = file["content-type"]?.toLowerCase();
  if (contentType === "application/pdf") {
    return true;
  }
  const filename = (file.filename ?? file.display_name ?? "").toLowerCase();
  return filename.endsWith(".pdf");
}
