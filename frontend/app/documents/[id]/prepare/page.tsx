'use client';
import { useEffect, useState, useRef, use } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, Save, ArrowRight, UserCheck } from 'lucide-react';
import Nav from '@/components/Nav';
import WorkflowStepper from '@/components/WorkflowStepper';
import PdfViewer from '@/components/PdfViewer';
import { api, API_URL, getError } from '@/lib/api';

interface Signer {
  id: string;
  name: string;
  email: string;
}

interface Box {
  id?: string;
  signerId?: string | null;
  signerName?: string;
  signerEmail?: string;
  page: number;
  x: number; // percentage (0-100)
  y: number; // percentage (0-100)
  width: number; // percentage
  height: number; // percentage
}

export default function PreparePage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const resolvedParams = use(params);
  const docId = resolvedParams.id;

  const [docTitle, setDocTitle] = useState('');
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null);
  const [signers, setSigners] = useState<Signer[]>([]);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [pageDimensions, setPageDimensions] = useState<{ width: number; height: number }>({ width: 600, height: 800 });

  const [selectedBoxIndex, setSelectedBoxIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [loading, setLoading] = useState(true);

  // Dragging / Resizing interaction state
  const dragRef = useRef<{
    action: 'move' | 'resize';
    boxIndex: number;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    origW: number;
    origH: number;
  } | null>(null);

  // Load document, PDF arraybuffer, signers, and existing boxes
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      router.replace('/login');
      return;
    }

    async function loadAll() {
      try {
        setLoading(true);
        const [pdfRes, signersRes, boxesRes, docsRes] = await Promise.all([
          api.get(`/api/documents/${docId}/view`, { responseType: 'arraybuffer' }),
          api.get(`/api/documents/${docId}/signers`).catch(() => ({ data: { signers: [] } })),
          api.get(`/api/documents/${docId}/boxes`).catch(() => ({ data: { boxes: [] } })),
          api.get('/api/documents'),
        ]);

        setPdfData(pdfRes.data);
        setSigners(signersRes.data.signers || []);
        setBoxes(boxesRes.data.boxes || []);

        const currentDoc = (docsRes.data.documents || []).find((d: any) => d.id === docId);
        if (currentDoc) setDocTitle(currentDoc.title);
      } catch (err) {
        setMessage({ text: getError(err), type: 'error' });
      } finally {
        setLoading(false);
      }
    }

    loadAll();
  }, [docId, router]);

  // Add a new signature box to the current page
  function addBox() {
    const defaultSigner = signers.length > 0 ? signers[0].id : null;
    const newBox: Box = {
      page: currentPage,
      x: 35, // centered horizontally
      y: 40 + (boxes.filter((b) => b.page === currentPage).length * 8) % 40,
      width: 28, // 28% of page width
      height: 9, // 9% of page height
      signerId: defaultSigner,
    };
    setBoxes((prev) => [...prev, newBox]);
    setSelectedBoxIndex(boxes.length);
    setMessage({ text: 'Added new signature box. Drag to position and resize.', type: 'success' });
  }

  // Delete a box
  function deleteBox(index: number) {
    setBoxes((prev) => prev.filter((_, i) => i !== index));
    if (selectedBoxIndex === index) setSelectedBoxIndex(null);
  }

  // Assign box to signer
  function assignSigner(index: number, signerId: string | null) {
    setBoxes((prev) =>
      prev.map((box, i) => (i === index ? { ...box, signerId: signerId || null } : box))
    );
  }

  // Save boxes to backend
  async function saveBoxes() {
    try {
      setSaving(true);
      setMessage(null);
      await api.post(`/api/documents/${docId}/boxes`, {
        boxes: boxes.map((b) => ({
          signerId: b.signerId,
          page: b.page,
          x: Math.round(b.x * 100) / 100,
          y: Math.round(b.y * 100) / 100,
          width: Math.round(b.width * 100) / 100,
          height: Math.round(b.height * 100) / 100,
        })),
      });
      setMessage({ text: 'Signature boxes saved successfully!', type: 'success' });
    } catch (err) {
      setMessage({ text: getError(err), type: 'error' });
    } finally {
      setSaving(false);
    }
  }

  // Mouse / Touch handlers for Move & Resize
  function handleStartAction(
    e: React.MouseEvent | React.TouchEvent,
    index: number,
    action: 'move' | 'resize'
  ) {
    e.stopPropagation();
    setSelectedBoxIndex(index);

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    const box = boxes[index];
    dragRef.current = {
      action,
      boxIndex: index,
      startX: clientX,
      startY: clientY,
      origX: box.x,
      origY: box.y,
      origW: box.width,
      origH: box.height,
    };

    window.addEventListener('mousemove', handleWindowMove);
    window.addEventListener('mouseup', handleWindowUp);
    window.addEventListener('touchmove', handleWindowMove, { passive: false });
    window.addEventListener('touchend', handleWindowUp);
  }

  function handleWindowMove(e: MouseEvent | TouchEvent) {
    if (!dragRef.current || !pageDimensions.width || !pageDimensions.height) return;
    if ('touches' in e) e.preventDefault();

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    const deltaX = ((clientX - dragRef.current.startX) / pageDimensions.width) * 100;
    const deltaY = ((clientY - dragRef.current.startY) / pageDimensions.height) * 100;

    const { action, boxIndex, origX, origY, origW, origH } = dragRef.current;

    setBoxes((prev) => {
      const next = [...prev];
      const target = { ...next[boxIndex] };

      if (action === 'move') {
        let newX = origX + deltaX;
        let newY = origY + deltaY;
        // Keep within page boundaries
        newX = Math.max(0, Math.min(100 - target.width, newX));
        newY = Math.max(0, Math.min(100 - target.height, newY));
        target.x = newX;
        target.y = newY;
      } else if (action === 'resize') {
        let newW = Math.max(12, origW + deltaX);
        let newH = Math.max(5, origH + deltaY);
        // Bound to page
        if (target.x + newW > 100) newW = 100 - target.x;
        if (target.y + newH > 100) newH = 100 - target.y;
        target.width = newW;
        target.height = newH;
      }

      next[boxIndex] = target;
      return next;
    });
  }

  function handleWindowUp() {
    dragRef.current = null;
    window.removeEventListener('mousemove', handleWindowMove);
    window.removeEventListener('mouseup', handleWindowUp);
    window.removeEventListener('touchmove', handleWindowMove);
    window.removeEventListener('touchend', handleWindowUp);
  }

  const currentPageBoxes = boxes
    .map((b, idx) => ({ ...b, originalIndex: idx }))
    .filter((b) => b.page === currentPage);

  return (
    <>
      <Nav />
      <main className="shell">
        <div className="row" style={{ marginBottom: 14 }}>
          <div>
            <h1 className="title">Place Signature Boxes</h1>
            <p className="muted" style={{ margin: 0 }}>
              {docTitle ? `Document: ${docTitle}` : 'Position signature fields on the PDF pages.'}
            </p>
          </div>
          <div className="actions">
            <button className="btn secondary" onClick={addBox} disabled={loading}>
              <Plus size={16} /> Add Signature Box
            </button>
            <button className="btn" onClick={saveBoxes} disabled={saving || loading}>
              <Save size={16} /> {saving ? 'Saving...' : 'Save Boxes'}
            </button>
            <button
              className="btn success"
              onClick={() => router.push(`/documents/${docId}/signers`)}
            >
              Next: Signers <ArrowRight size={16} />
            </button>
          </div>
        </div>

        <WorkflowStepper docId={docId} currentStep="prepare" />

        {message && (
          <div className={message.type} style={{ marginBottom: 14 }}>
            {message.text}
          </div>
        )}

        {/* Selected Box Inspector Toolbar */}
        {selectedBoxIndex !== null && boxes[selectedBoxIndex] && (
          <div
            className="card"
            style={{
              padding: '12px 18px',
              marginBottom: 14,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: '#f8faff',
              borderColor: '#c7d2fe',
              flexWrap: 'wrap',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#4338ca' }}>
                Selected Box #{selectedBoxIndex + 1} (Page {boxes[selectedBoxIndex].page}):
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <UserCheck size={15} color="#4f46e5" />
                <label style={{ fontSize: 13, fontWeight: 600 }}>Assign Signer:</label>
                <select
                  style={{
                    padding: '6px 10px',
                    borderRadius: 6,
                    border: '1px solid #c7d2fe',
                    fontSize: 13,
                  }}
                  value={boxes[selectedBoxIndex].signerId || ''}
                  onChange={(e) => assignSigner(selectedBoxIndex, e.target.value || null)}
                >
                  <option value="">-- Unassigned --</option>
                  {signers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.email})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn sm danger"
                onClick={() => deleteBox(selectedBoxIndex)}
                title="Delete signature box"
              >
                <Trash2 size={14} /> Remove Box
              </button>
            </div>
          </div>
        )}

        {/* PDF Viewer with interactive boxes overlay */}
        <PdfViewer
          pdfData={pdfData}
          currentPage={currentPage}
          onPageChange={setCurrentPage}
          onTotalPagesLoaded={setTotalPages}
          onPageDimensionsChanged={setPageDimensions}
        >
          {currentPageBoxes.map((box) => {
            const isSelected = selectedBoxIndex === box.originalIndex;
            const assignedSigner = signers.find((s) => s.id === box.signerId);

            return (
              <div
                key={box.originalIndex}
                className={`sig-box ${isSelected ? 'selected' : ''}`}
                style={{
                  left: `${box.x}%`,
                  top: `${box.y}%`,
                  width: `${box.width}%`,
                  height: `${box.height}%`,
                }}
                onMouseDown={(e) => handleStartAction(e, box.originalIndex, 'move')}
                onTouchStart={(e) => handleStartAction(e, box.originalIndex, 'move')}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedBoxIndex(box.originalIndex);
                }}
              >
                <div className="sig-box-header">
                  <span>
                    {assignedSigner ? assignedSigner.name : 'Unassigned'}
                  </span>
                  <button
                    className="sig-box-del"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteBox(box.originalIndex);
                    }}
                    title="Delete box"
                  >
                    ×
                  </button>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flex: 1,
                    fontSize: 11,
                    color: '#4f46e5',
                    fontWeight: 600,
                  }}
                >
                  Sign Here
                </div>

                {/* Resize Handle */}
                <div
                  className="sig-box-handle"
                  onMouseDown={(e) => handleStartAction(e, box.originalIndex, 'resize')}
                  onTouchStart={(e) => handleStartAction(e, box.originalIndex, 'resize')}
                  title="Drag to resize"
                />
              </div>
            );
          })}
        </PdfViewer>
      </main>
    </>
  );
}
