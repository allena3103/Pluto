"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy, type RenderTask } from "pdfjs-dist/legacy/build/pdf.mjs";
import { AlertCircle, ChevronLeft, ChevronRight, RefreshCcw, ScanText, Shrink, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();

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
    let renderTask: RenderTask | null = null;
    const render = async () => {
      const pdf = pdfRef.current;
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!pdf || !canvas || !container) {
        return;
      }

      try {
        const pdfPage = await pdf.getPage(page);
        if (cancelled) {
          return;
        }
        const baseline = pdfPage.getViewport({ scale: 1 });
        const containerWidth = Math.max(container.clientWidth - 16, 240);
        const fitScale = containerWidth / baseline.width;
        const scale = fitWidth ? fitScale : fitScale * manualZoom;
        const viewport = pdfPage.getViewport({ scale });

        const ratio = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        renderTask = pdfPage.render({ canvas, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
        await renderTask.promise;
      } catch (err) {
        if (err instanceof Error && err.name === "RenderingCancelledException") {
          return;
        }
        if (!cancelled) {
          setView({ kind: "error", message: "Could not render this page. Please retry." });
        }
      }
    };

    void render();
    return () => {
      cancelled = true;
      renderTask?.cancel();
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

  const manualZoomRef = useRef(manualZoom);
  useEffect(() => {
    manualZoomRef.current = manualZoom;
  }, [manualZoom]);

  // React registers touch handlers as passive, so preventDefault only works on a native non-passive listener.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const distance = (event: TouchEvent): number | null => {
      const a = event.touches.item(0);
      const b = event.touches.item(1);
      return a && b ? Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) : null;
    };
    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 2) return;
      const d = distance(event);
      if (d === null) return;
      pinchDistanceRef.current = d;
      pinchStartZoomRef.current = manualZoomRef.current;
    };
    const onMove = (event: TouchEvent) => {
      if (event.touches.length !== 2 || pinchDistanceRef.current === null) return;
      const d = distance(event);
      if (d === null) return;
      event.preventDefault();
      setFitWidth(false);
      setManualZoom(clamp((d / pinchDistanceRef.current) * pinchStartZoomRef.current, MIN_ZOOM, MAX_ZOOM));
    };
    const onEnd = () => {
      pinchDistanceRef.current = null;
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [view.kind]);

  if (view.kind === "error") {
    return (
      <Card>
        <CardContent className="space-y-4 py-2 text-center">
          <div className="flex items-start justify-center gap-2 rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p>{view.message}</p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => {
              setView({ kind: "loading" });
              setPage(initialPage);
              setJumpValue(String(initialPage));
              // The signed URL lasts 60s; ask the server component for a fresh one. The new
              // signedUrl prop re-runs the load effect. retryCount covers an unchanged URL.
              router.refresh();
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
    <div className="space-y-4">
      <Card className="gap-3 py-3 sm:py-4">
        <CardContent className="space-y-3 px-3 sm:px-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1 rounded-full bg-muted p-1">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={!canGoPrev}
                onClick={() => moveToPage(page - 1)}
                aria-label="Previous page"
                className="hover:bg-card"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden />
              </Button>
              <div className="flex items-center gap-1.5 px-1 text-sm font-bold text-muted-foreground">
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
                  className="h-8 w-12 rounded-full px-2 text-center font-bold shadow-none"
                  aria-label="Jump to page"
                />
                <span className="whitespace-nowrap">of {pageCount ?? "..."}</span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={!canGoNext}
                onClick={() => moveToPage(page + 1)}
                aria-label="Next page"
                className="hover:bg-card"
              >
                <ChevronRight className="h-4 w-4" aria-hidden />
              </Button>
            </div>

            <div className="flex items-center gap-1 rounded-full bg-muted p-1">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => setFitWidth(true)}
                aria-label="Fit width"
                title="Fit width"
                className={fitWidth ? "bg-card text-primary shadow-warm-sm" : "hover:bg-card"}
              >
                <Shrink className="h-4 w-4" aria-hidden />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Zoom out"
                title="Zoom out"
                className="hover:bg-card"
                onClick={() => {
                  setFitWidth(false);
                  setManualZoom((value) => clamp(value - 0.1, MIN_ZOOM, MAX_ZOOM));
                }}
              >
                <ZoomOut className="h-4 w-4" aria-hidden />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Zoom in"
                title="Zoom in"
                className="hover:bg-card"
                onClick={() => {
                  setFitWidth(false);
                  setManualZoom((value) => clamp(value + 0.1, MIN_ZOOM, MAX_ZOOM));
                }}
              >
                <ZoomIn className="h-4 w-4" aria-hidden />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-pressed={showPageText}
                onClick={() => setShowPageText((value) => !value)}
                className={showPageText ? "bg-card text-primary shadow-warm-sm" : "hover:bg-card"}
              >
                <ScanText className="h-4 w-4" aria-hidden />
                {showPageText ? "Hide text" : "Page text"}
              </Button>
            </div>
          </div>

          <div
            ref={containerRef}
            className="overflow-x-auto rounded-2xl bg-muted/60 p-2"
          >
            <canvas ref={canvasRef} className="mx-auto block max-w-none rounded-xl bg-white shadow-warm" />
            {view.kind === "loading" ? (
              <p className="p-6 text-center text-sm font-bold text-muted-foreground">Loading PDF…</p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {showPageText ? (
        <Card>
          <CardContent className="py-1">
            <h3 className="mb-2 text-sm font-extrabold text-foreground">Page text</h3>
            {currentPageText ? (
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">{currentPageText}</p>
            ) : (
              <p className="text-sm text-muted-foreground">No extracted text for this page.</p>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
