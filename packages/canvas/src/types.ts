export type CanvasMode = "live" | "fixtures";

export type CanvasClientOptions = {
  baseUrl: string;
  token: string;
  mode?: CanvasMode;
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxPages?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
};

export type CanvasCourse = {
  canvasCourseId: string;
  name: string;
  term: string | null;
};

export type CanvasAssignmentGroup = {
  canvasGroupId: string;
  name: string;
  weightPercent: number;
};

export type CanvasAssignment = {
  canvasAssignmentId: string;
  title: string;
  dueAt: string | null;
  pointsPossible: number | null;
  canvasGroupId: string | null;
  score: number | null;
  graded: boolean;
  submitted: boolean;
  /** The assignment description as Canvas HTML; attachments live here as file links. */
  descriptionHtml: string | null;
  /** The assignment's page in Canvas. */
  htmlUrl: string | null;
};

export type CanvasCourseFile = {
  canvasFileId: string;
  title: string;
  url: string;
  updatedAt: string | null;
  createdAt: string | null;
  sizeBytes: number | null;
};

/**
 * One course file of any type, read by id. `url` is a capability download link that works
 * without auth: keep it in memory for the download only, never store, log or return it.
 */
export type CanvasFileMeta = {
  canvasFileId: string;
  title: string;
  contentType: string | null;
  sizeBytes: number | null;
  updatedAt: string | null;
  url: string;
};

export type CanvasModuleFileItem = {
  moduleName: string;
  canvasFileId: string;
};

type CanvasErrorArgs = {
  status: number;
  requestPath: string;
  message: string;
};

export class CanvasError extends Error {
  readonly status: number;
  readonly requestPath: string;

  constructor({ status, requestPath, message }: CanvasErrorArgs) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.requestPath = requestPath;
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      status: this.status,
      requestPath: this.requestPath,
    };
  }
}

export class CanvasAuthError extends CanvasError {}
export class CanvasNotFoundError extends CanvasError {}
export class CanvasRateLimitError extends CanvasError {}
export class CanvasTimeoutError extends CanvasError {}
export class CanvasHttpError extends CanvasError {}
