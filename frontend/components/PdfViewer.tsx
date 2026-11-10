'use client';
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';

interface PdfViewerProps {
  pdfUrl?: string;
  pdfData?: ArrayBuffer | null;
  currentPage: number;
  onPageChange: (page: number) => void;
  onTotalPagesLoaded?: (total: number) => void;
  onPageDimensionsChanged?: (dimensions: { width: number; height: number }) => void;
  children?: React.ReactNode;
}

export default function PdfViewer({
  pdfUrl,
  pdfData,
  currentPage,
  onPageChange,
  onTotalPagesLoaded,
  onPageDimensionsChanged,
  children,
}: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [scale, setScale] = useState<number>(1.2);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number }>({ width: 600, height: 800 });

  // Load PDF.js script dynamically
  const getPdfJs = useCallback(async () => {
    if (typeof window === 'undefined') return null;
    if ((window as any).pdfjsLib) {
      return (window as any).pdfjsLib;
    }

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      script.async = true;
      script.onload = () => {
        const lib = (window as any).pdfjsLib;
        if (lib) {
          lib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
          resolve(lib);
        } else {
          reject(new Error('PDF.js library failed to load'));
        }
      };
      script.onerror = () => reject(new Error('Network error loading PDF.js'));
      document.head.appendChild(script);
    });
  }, []);

  // Load Document
  useEffect(() => {
    let isCancelled = false;
    async function loadDocument() {
      setLoading(true);
      setError(null);
      try {
        const pdfjs = await getPdfJs();
        if (!pdfjs) return;

        let loadingTask;
        if (pdfData) {
          loadingTask = pdfjs.getDocument({ data: pdfData });
        } else if (pdfUrl) {
          loadingTask = pdfjs.getDocument(pdfUrl);
        } else {
          return;
        }

        const doc = await loadingTask.promise;
        if (isCancelled) return;

        setPdfDoc(doc);
        setTotalPages(doc.numPages);
        if (onTotalPagesLoaded) onTotalPagesLoaded(doc.numPages);
      } catch (err: any) {
        if (!isCancelled) {
          console.error('Failed to load PDF document:', err);
          setError('Could not load PDF document. Please verify the file.');
        }
      } finally {
        if (!isCancelled) setLoading(false);
      }
    }

    loadDocument();
    return () => {
      isCancelled = true;
    };
  }, [pdfUrl, pdfData, getPdfJs, onTotalPagesLoaded]);

  // Render current page onto canvas
  useEffect(() => {
    let renderTask: any = null;
    let isCancelled = false;

    async function renderPage() {
      if (!pdfDoc || !canvasRef.current) return;

      try {
        const pageNum = Math.min(Math.max(1, currentPage), totalPages);
        const page = await pdfDoc.getPage(pageNum);
        if (isCancelled) return;

        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        if (!context) return;

        canvas.width = viewport.width;
        canvas.height = viewport.height;

        setDimensions({ width: viewport.width, height: viewport.height });
        if (onPageDimensionsChanged) {
          onPageDimensionsChanged({ width: viewport.width, height: viewport.height });
        }

        const renderContext = {
          canvasContext: context,
          viewport: viewport,
        };

        renderTask = page.render(renderContext);
        await renderTask.promise;
      } catch (err: any) {
        if (err?.name !== 'RenderingCancelledException' && !isCancelled) {
          console.error('Page render error:', err);
        }
      }
    }

    renderPage();
    return () => {
      isCancelled = true;
      if (renderTask) {
        renderTask.cancel();
      }
    };
  }, [pdfDoc, currentPage, scale, totalPages, onPageDimensionsChanged]);

  return (
    <div className="pdf-stage-wrapper">
      {/* Toolbar */}
      <div className="pdf-toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            className="btn sm secondary"
            disabled={currentPage <= 1 || loading}
            onClick={() => onPageChange(currentPage - 1)}
            aria-label="Previous Page"
          >
            <ChevronLeft size={16} /> Prev
          </button>
          <span style={{ fontSize: 13, fontWeight: 600 }}>
            Page {currentPage} of {totalPages}
          </span>
          <button
            className="btn sm secondary"
            disabled={currentPage >= totalPages || loading}
            onClick={() => onPageChange(currentPage + 1)}
            aria-label="Next Page"
          >
            Next <ChevronRight size={16} />
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            className="btn sm secondary"
            onClick={() => setScale((s) => Math.max(0.6, s - 0.15))}
            aria-label="Zoom Out"
            title="Zoom Out"
          >
            <ZoomOut size={15} />
          </button>
          <span style={{ fontSize: 13, minWidth: 45, textAlign: 'center' }}>
            {Math.round(scale * 100)}%
          </span>
          <button
            className="btn sm secondary"
            onClick={() => setScale((s) => Math.min(2.5, s + 0.15))}
            aria-label="Zoom In"
            title="Zoom In"
          >
            <ZoomIn size={15} />
          </button>
          <button
            className="btn sm ghost"
            style={{ color: '#cbd5e1' }}
            onClick={() => setScale(1.2)}
            title="Reset Zoom"
          >
            <RotateCcw size={14} />
          </button>
        </div>
      </div>

      {loading && <p style={{ color: 'white', margin: '40px 0' }}>Loading PDF document...</p>}
      {error && <p className="error">{error}</p>}

      {/* Canvas and Overlay Container */}
      <div
        ref={containerRef}
        className="pdf-page-container"
        style={{
          width: dimensions.width,
          height: dimensions.height,
          display: loading || error ? 'none' : 'block',
        }}
      >
        <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />

        {/* Overlay for signature boxes or interaction */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'auto',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
