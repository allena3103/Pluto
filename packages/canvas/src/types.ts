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
};

export type CanvasCourseFile = {
  canvasFileId: string;
  title: string;
  url: string;
  updatedAt: string | null;
  createdAt: string | null;
  sizeBytes: number | null;
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
