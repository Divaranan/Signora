'use client';
import React, { useRef, useState, useEffect } from 'react';
import { Eraser, Check, X, PenTool, Type } from 'lucide-react';

interface SignaturePadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (signatureDataUrl: string) => void;
  signerName?: string;
}

export default function SignaturePadModal({
  isOpen,
  onClose,
  onSave,
  signerName = '',
}: SignaturePadModalProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [mode, setMode] = useState<'draw' | 'type'>('draw');
  const [typedName, setTypedName] = useState(signerName);

  // Initialize canvas
  useEffect(() => {
    if (!isOpen) return;

    // Small delay to ensure modal is rendered
    const timer = setTimeout(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Handle high-DPI displays
      const ratio = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * ratio;
      canvas.height = rect.height * ratio;
      ctx.scale(ratio, ratio);

      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#0f172a'; // dark navy / black ink

      setHasDrawn(false);
    }, 50);

    return () => clearTimeout(timer);
  }, [isOpen, mode]);

  if (!isOpen) return null;

  // Drawing event handlers
  function getCoordinates(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();

    if ('touches' in e) {
      const touch = e.touches[0];
      return {
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top,
      };
    }
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  function startDrawing(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { x, y } = getCoordinates(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
    setHasDrawn(true);
  }

  function draw(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    if (!isDrawing) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { x, y } = getCoordinates(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function stopDrawing() {
    setIsDrawing(false);
  }

  function clearCanvas() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const ratio = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width / ratio, canvas.height / ratio);
    setHasDrawn(false);
  }

  function handleSave() {
    if (mode === 'draw') {
      const canvas = canvasRef.current;
      if (!canvas || !hasDrawn) {
        alert('Please draw your signature before saving.');
        return;
      }
      const dataUrl = canvas.toDataURL('image/png');
      onSave(dataUrl);
      onClose();
    } else {
      if (!typedName.trim()) {
        alert('Please enter your name.');
        return;
      }
      // Render typed signature to offscreen canvas
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = 450;
      tempCanvas.height = 180;
      const ctx = tempCanvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, 450, 180);
        ctx.font = '60px Caveat, cursive, sans-serif';
        ctx.fillStyle = '#0f172a';
        ctx.textBaseline = 'middle';
        ctx.fillText(typedName.trim(), 30, 90);
        const dataUrl = tempCanvas.toDataURL('image/png');
        onSave(dataUrl);
        onClose();
      }
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Provide Signature</h2>
          <button className="btn sm ghost" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* Tab switch */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button
            className={`btn sm ${mode === 'draw' ? 'secondary' : 'ghost'}`}
            onClick={() => setMode('draw')}
          >
            <PenTool size={14} /> Draw Signature
          </button>
          <button
            className={`btn sm ${mode === 'type' ? 'secondary' : 'ghost'}`}
            onClick={() => setMode('type')}
          >
            <Type size={14} /> Type Signature
          </button>
        </div>

        {mode === 'draw' ? (
          <div>
            <div className="sig-pad-container" style={{ width: '100%', height: 180 }}>
              <canvas
                ref={canvasRef}
                style={{ width: '100%', height: '100%', cursor: 'crosshair', display: 'block' }}
                onMouseDown={startDrawing}
                onMouseMove={draw}
                onMouseUp={stopDrawing}
                onMouseLeave={stopDrawing}
                onTouchStart={startDrawing}
                onTouchMove={draw}
                onTouchEnd={stopDrawing}
              />
              <span
                style={{
                  position: 'absolute',
                  bottom: 8,
                  left: 14,
                  fontSize: 11,
                  color: '#94a3b8',
                  pointerEvents: 'none',
                }}
              >
                Sign on the line above
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }}>
              <span className="muted" style={{ fontSize: 12 }}>
                Use mouse or fingertip / stylus on touch screens
              </span>
              <button className="btn sm ghost" onClick={clearCanvas}>
                <Eraser size={14} /> Clear
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div className="field" style={{ margin: '8px 0 16px' }}>
              <label>Your Full Name</label>
              <input
                type="text"
                value={typedName}
                onChange={(e) => setTypedName(e.target.value)}
                placeholder="e.g. John Doe"
                autoFocus
              />
            </div>
            <div
              style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: 8,
                padding: '24px 18px',
                textAlign: 'center',
                minHeight: 100,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <span className="cursive-font" style={{ fontSize: 44, color: '#0f172a' }}>
                {typedName || 'Your Signature'}
              </span>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 22 }}>
          <button className="btn secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn success" onClick={handleSave}>
            <Check size={16} /> Adopt & Sign
          </button>
        </div>
      </div>
    </div>
  );
}

