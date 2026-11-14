"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type TouchEvent as ReactTouchEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from "pdfjs-dist";
import { AlertCircle, ChevronLeft, ChevronRight, RefreshCcw, ScanText, Shrink, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

type PdfViewerProps = {
  signedUrl: string;
  initialPage: number;
  pageCountHint: number | null;
  pageTextByNumber: Record<number, string>;
};

type ViewState =
  | { kind: "loading" }
  | { kind: "ready"; pageCount: number }
  | { kind: "error"; message: string };

const MIN_ZOOM = 0.6;
const MAX_ZOOM = 3;
const DEFAULT_ZOOM = 1;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function PdfViewer({ signedUrl, initialPage, pageCountHint, pageTextByNumber }: PdfViewerProps) {
  const router = useRouter();
  const pathname = usePathname();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const pinchDistanceRef = useRef<number | null>(null);
  const pinchStartZoomRef = useRef<number>(DEFAULT_ZOOM);

  const [view, setView] = useState<ViewState>({ kind: "loading" });
  const [page, setPage] = useState(initialPage);
  const [jumpValue, setJumpValue] = useState(String(initialPage));
  const [manualZoom, setManualZoom] = useState(DEFAULT_ZOOM);
  const [fitWidth, setFitWidth] = useState(true);
  const [retryCount, setRetryCount] = useState(0);
  const [renderTick, setRenderTick] = useState(0);
  const [showPageText, setShowPageText] = useState(false);

  const pageCount = view.kind === "ready" ? view.pageCount : pageCountHint ?? null;

  const updateUrl = useCallback(
    (nextPage: number) => {
      const params = new URLSearchParams();
      params.set("page", String(nextPage));
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router],
  );

  const moveToPage = useCallback(
    (requestedPage: number) => {
      const upper = pageCount ?? Number.MAX_SAFE_INTEGER;
      const nextPage = clamp(requestedPage, 1, upper);
      setPage(nextPage);
      setJumpValue(String(nextPage));
      updateUrl(nextPage);
    },
    [pageCount, updateUrl],
  );

  useEffect(() => {
    let cancelled = false;
    let loadingTask: ReturnType<typeof getDocument> | null = null;

    async function loadPdf() {
      try {
        loadingTask = getDocument({
          url: signedUrl,
          useWorkerFetch: true,
        });

        const pdf = await loadingTask.promise;
        if (cancelled) {
          await loadingTask.destroy();
          return;
        }

        pdfRef.current = pdf;
        setView({ kind: "ready", pageCount: pdf.numPages });

        setPage((current) => {
          const clamped = clamp(current, 1, pdf.numPages);
          if (clamped !== current) {
            setJumpValue(String(clamped));
            updateUrl(clamped);
          }
          return clamped;
        });
      } catch {
        if (!cancelled) {
          setView({ kind: "error", message: "Could not open this PDF. The link may have expired." });
        }
      }
    }

    loadPdf();

    return () => {
      cancelled = true;
      if (loadingTask) {
        void loadingTask.destroy();
      }
      if (pdfRef.current) {
        void pdfRef.current.cleanup();
        pdfRef.current = null;
      }
    };
  }, [retryCount, signedUrl, updateUrl]);

  useEffect(() => {
    if (view.kind !== "ready") {
      return;
    }

    let cancelled = false;
    const render = async () => {
      const pdf = pdfRef.current;
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!pdf || !canvas || !container) {
        return;
      }

      try {
        const pdfPage = await pdf.getPage(page);
        const baseline = pdfPage.getViewport({ scale: 1 });
        const containerWidth = Math.max(container.clientWidth - 16, 240);
        const fitScale = containerWidth / baseline.width;
        const scale = fitWidth ? fitScale : fitScale * manualZoom;
        const viewport = pdfPage.getViewport({ scale });

        const context = canvas.getContext("2d");
        if (!context) {
          throw new Error("missing canvas context");
        }

        const ratio = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        context.setTransform(ratio, 0, 0, ratio, 0, 0);

        await pdfPage.render({ canvas, canvasContext: context, viewport }).promise;
      } catch {
        if (!cancelled) {
          setView({ kind: "error", message: "Could not render this page. Please retry." });
        }
      }
    };

    void render();
    return () => {
      cancelled = true;
    };
  }, [fitWidth, manualZoom, page, renderTick, view.kind]);

  useEffect(() => {
    if (view.kind !== "ready") return;

    const onResize = () => {
      if (fitWidth) {
        setRenderTick((value) => value + 1);
      }
    };

    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [fitWidth, view.kind]);

  const canGoPrev = page > 1;
  const canGoNext = pageCount ? page < pageCount : true;
  const currentPageText = useMemo(() => pageTextByNumber[page] ?? null, [page, pageTextByNumber]);

  const onPinchStart = useCallback((event: ReactTouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 2) {
      return;
    }
    const a = event.touches.item(0);
    const b = event.touches.item(1);
    if (!a || !b) {
      return;
    }
    pinchDistanceRef.current = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    pinchStartZoomRef.current = manualZoom;
  }, [manualZoom]);

  const onPinchMove = useCallback((event: ReactTouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 2 || pinchDistanceRef.current === null) {
      return;
    }
    const a = event.touches.item(0);
    const b = event.touches.item(1);
    if (!a || !b) {
      return;
    }
    event.preventDefault();
    const currentDistance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const nextZoom = clamp((currentDistance / pinchDistanceRef.current) * pinchStartZoomRef.current, MIN_ZOOM, MAX_ZOOM);
    setFitWidth(false);
    setManualZoom(nextZoom);
  }, []);

  const onPinchEnd = useCallback(() => {
    pinchDistanceRef.current = null;
  }, []);

  if (view.kind === "error") {
    return (
      <Card>
        <CardContent className="space-y-3 py-4">
          <div className="flex items-start gap-2 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p>{view.message}</p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => {
              setView({ kind: "loading" });
              setPage(initialPage);
              setJumpValue(String(initialPage));
              setRetryCount((value) => value + 1);
            }}
          >
            <RefreshCcw className="h-4 w-4" aria-hidden />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="space-y-3 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" disabled={!canGoPrev} onClick={() => moveToPage(page - 1)}>
              <ChevronLeft className="h-4 w-4" aria-hidden />
              Prev
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={!canGoNext} onClick={() => moveToPage(page + 1)}>
              Next
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Button>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Page</span>
              <Input
                value={jumpValue}
                onChange={(event) => setJumpValue(event.target.value)}
                onBlur={() => moveToPage(Number.parseInt(jumpValue, 10) || 1)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    moveToPage(Number.parseInt(jumpValue, 10) || 1);
                  }
                }}
                inputMode="numeric"
                pattern="[0-9]*"
                className="h-8 w-16"
                aria-label="Jump to page"
              />
              <span>of {pageCount ?? "..."}</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setFitWidth(true)}>
              <Shrink className="h-4 w-4" aria-hidden />
              Fit width
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setFitWidth(false);
                setManualZoom((value) => clamp(value - 0.1, MIN_ZOOM, MAX_ZOOM));
              }}
            >
              <ZoomOut className="h-4 w-4" aria-hidden />
              Zoom out
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setFitWidth(false);
                setManualZoom((value) => clamp(value + 0.1, MIN_ZOOM, MAX_ZOOM));
              }}
            >
              <ZoomIn className="h-4 w-4" aria-hidden />
              Zoom in
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowPageText((value) => !value)}>
              <ScanText className="h-4 w-4" aria-hidden />
              {showPageText ? "Hide page text" : "Show page text"}
            </Button>
          </div>

          <div
            ref={containerRef}
            className="overflow-x-auto rounded-lg border bg-muted/20 p-2"
            onTouchStart={onPinchStart}
            onTouchMove={onPinchMove}
            onTouchEnd={onPinchEnd}
          >
            <canvas ref={canvasRef} className="mx-auto block max-w-none rounded-md bg-white shadow" />
            {view.kind === "loading" ? (
              <p className="p-3 text-center text-sm text-muted-foreground">Loading PDF…</p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {showPageText ? (
        <Card>
          <CardContent className="py-4">
            <h3 className="mb-2 text-sm font-medium text-foreground">Page text</h3>
            {currentPageText ? (
              <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{currentPageText}</p>
            ) : (
              <p className="text-sm text-muted-foreground">No extracted text for this page.</p>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
