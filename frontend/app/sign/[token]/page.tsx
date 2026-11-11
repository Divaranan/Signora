'use client';
import { useEffect, useState, use, useCallback } from 'react';
import {
  FileText,
  CheckCircle2,
  AlertTriangle,
  Clock,
  PenTool,
  Check,
  Send,
  ShieldCheck,
  ArrowRight,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import PdfViewer from '@/components/PdfViewer';
import SignaturePadModal from '@/components/SignaturePadModal';
import { API_URL, getError } from '@/lib/api';
import axios from 'axios';

interface Signer {
  id: string;
  name: string;
  email: string;
  status: string;
}

interface DocInfo {
  id: string;
  title: string;
  originalName: string;
  status: string;
}

interface Box {
  id: string;
  signerId: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export default function SignerPage({ params }: { params: Promise<{ token: string }> }) {
  const resolvedParams = use(params);
  const token = resolvedParams.token;

  const [loading, setLoading] = useState(true);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [errorState, setErrorState] = useState('');
  const [signatureSetupError, setSignatureSetupError] = useState('');
  const [signer, setSigner] = useState<Signer | null>(null);
  const [document, setDocument] = useState<DocInfo | null>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null);

  const [currentPage, setCurrentPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [pdfPagesLoaded, setPdfPagesLoaded] = useState(false);

  // Signatures recorded: map of box index or global signature
  const [adoptedSignature, setAdoptedSignature] = useState<string | null>(null);
  const [isPadOpen, setIsPadOpen] = useState(false);
  const [targetBoxIndex, setTargetBoxIndex] = useState<number | null>(null);

  // Submitting & success
  const [submitting, setSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [completionDate, setCompletionDate] = useState<string>('');

  useEffect(() => {
    async function loadSigningData() {
      try {
        setLoading(true);
        setPdfPagesLoaded(false);
        setBoxes([]);
        setPdfData(null);
        setSignatureSetupError('');
        setErrorStatus(null);
        setErrorMessage('');
        setErrorState('');

        // 1. Fetch signing info
        const infoRes = await axios.get(`${API_URL}/api/signing/${token}`);
        setSigner(infoRes.data.signer);
        setDocument(infoRes.data.document);
        setBoxes(infoRes.data.boxes || []);

        // If boxes exist, navigate to the first box's page
        if (infoRes.data.boxes && infoRes.data.boxes.length > 0) {
          setCurrentPage(infoRes.data.boxes[0].page);
        }

        // 2. Fetch PDF
        const pdfRes = await axios.get(`${API_URL}/api/signing/${token}/pdf`, {
          responseType: 'arraybuffer',
        });
        setPdfData(pdfRes.data);
      } catch (err: any) {
        if (axios.isAxiosError(err)) {
          const status = err.response?.status || 500;
          const msg = err.response?.data?.error || err.message;
          setErrorStatus(status);
          setErrorMessage(msg);
          setErrorState(err.response?.data?.state || stateFromStatus(status));
        } else {
          setErrorStatus(500);
          setErrorMessage('Could not load signing session.');
          setErrorState('invalid');
        }
      } finally {
        setLoading(false);
      }
    }

    loadSigningData();
  }, [token]);

  function stateFromStatus(status: number): string {
    if (status === 404) return 'invalid';
    if (status === 410) return 'expired';
    if (status === 422) return 'setup';
    if (status === 409) return 'conflict';
    return 'unavailable';
  }

  const handleTotalPagesLoaded = useCallback((total: number) => {
    setTotalPages(total);
    setPdfPagesLoaded(true);
  }, []);

  useEffect(() => {
    if (!pdfPagesLoaded) return;
    const firstValidBox = boxes.find((box) =>
      Number.isInteger(box.page) && box.page >= 1 && box.page <= totalPages
    );
    if (currentPage < 1 || currentPage > totalPages) {
      setCurrentPage(firstValidBox?.page || 1);
    }
  }, [boxes, currentPage, pdfPagesLoaded, totalPages]);

  // Handle signature adoption
  function handleSignatureAdopted(dataUrl: string) {
    setAdoptedSignature(dataUrl);
    setIsPadOpen(false);
  }

  // Submit all signatures
  async function handleSubmit() {
    if (!canSubmit) {
      setSignatureSetupError('The PDF and all assigned signature boxes must finish loading and pass verification before you can submit.');
      return;
    }
    if (!adoptedSignature) {
      setIsPadOpen(true);
      return;
    }

    try {
      setSubmitting(true);
      const res = await axios.post(`${API_URL}/api/signing/${token}/submit`, {
        signatureData: adoptedSignature,
      });

      setCompletionDate(new Date().toLocaleString());
      setIsSuccess(true);

      // Trigger confetti celebration!
      try {
        confetti({
          particleCount: 90,
          spread: 70,
          origin: { y: 0.6 },
        });
      } catch {}
    } catch (err: any) {
      if (axios.isAxiosError(err) && [404, 409, 410, 422].includes(err.response?.status || 0)) {
        const status = err.response?.status || 500;
        setErrorStatus(status);
        setErrorMessage(err.response?.data?.error || getError(err));
        setErrorState(err.response?.data?.state || stateFromStatus(status));
      } else {
        alert(getError(err));
      }
    } finally {
      setSubmitting(false);
    }
  }

  // Guide to next box
  function goToNextBox() {
    const unvisited = boxes.find((b) => b.page !== currentPage);
    if (unvisited) {
      setCurrentPage(unvisited.page);
    } else if (!adoptedSignature) {
      setIsPadOpen(true);
    }
  }

  // Render Error Screens
  if (errorStatus) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20,
          background: '#f8fafc',
        }}
      >
        <div className="card" style={{ maxWidth: 480, textAlign: 'center', padding: '40px 24px' }}>
          {errorState === 'signed' ? (
            <>
              <CheckCircle2 size={54} color="#16a34a" style={{ margin: '0 auto 16px' }} />
              <h2 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 10px' }}>
                Already Signed
              </h2>
              <p className="muted" style={{ margin: '0 0 20px', lineHeight: 1.5 }}>
                {errorMessage || 'You have already completed signing this document.'}
              </p>
            </>
          ) : errorState === 'expired' ? (
            <>
              <Clock size={54} color="#d97706" style={{ margin: '0 auto 16px' }} />
              <h2 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 10px' }}>
                Link Expired
              </h2>
              <p className="muted" style={{ margin: '0 0 20px', lineHeight: 1.5 }}>
                {errorMessage ||
                  'This signing link has expired. Please contact the document sender to receive an updated link.'}
              </p>
            </>
          ) : errorState === 'setup' ? (
            <>
              <AlertTriangle size={54} color="#d97706" style={{ margin: '0 auto 16px' }} />
              <h2 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 10px' }}>
                Signing Setup Needs Attention
              </h2>
              <p className="muted" style={{ margin: '0 0 20px', lineHeight: 1.5 }}>
                {errorMessage || 'The sender needs to correct the signature boxes before you can sign.'}
              </p>
            </>
          ) : errorState === 'draft' ? (
            <>
              <Clock size={54} color="#d97706" style={{ margin: '0 auto 16px' }} />
              <h2 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 10px' }}>Not Sent Yet</h2>
              <p className="muted" style={{ margin: '0 0 20px', lineHeight: 1.5 }}>
                {errorMessage || 'The sender has not sent this document for signing yet.'}
              </p>
            </>
          ) : errorState === 'closed' ? (
            <>
              <Clock size={54} color="#64748b" style={{ margin: '0 auto 16px' }} />
              <h2 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 10px' }}>Document Unavailable</h2>
              <p className="muted" style={{ margin: '0 0 20px', lineHeight: 1.5 }}>
                {errorMessage || 'This document is no longer accepting signatures.'}
              </p>
            </>
          ) : errorState === 'conflict' ? (
            <>
              <AlertTriangle size={54} color="#d97706" style={{ margin: '0 auto 16px' }} />
              <h2 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 10px' }}>Cannot Sign Yet</h2>
              <p className="muted" style={{ margin: '0 0 20px', lineHeight: 1.5 }}>
                {errorMessage || 'The signing request is not currently available.'}
              </p>
            </>
          ) : errorState === 'invalid' ? (
            <>
              <AlertTriangle size={54} color="#dc2626" style={{ margin: '0 auto 16px' }} />
              <h2 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 10px' }}>
                Invalid Signing Link
              </h2>
              <p className="muted" style={{ margin: '0 0 20px', lineHeight: 1.5 }}>
                {errorMessage ||
                  'This signing link is invalid or no longer exists. Please verify the URL from your invitation.'}
              </p>
            </>
          ) : (
            <>
              <AlertTriangle size={54} color="#dc2626" style={{ margin: '0 auto 16px' }} />
              <h2 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 10px' }}>
                Unable to Load Signing Request
              </h2>
              <p className="muted" style={{ margin: '0 0 20px', lineHeight: 1.5 }}>
                {errorMessage || 'A temporary error prevented this signing request from loading. Please try again later.'}
              </p>
            </>
          )}

          <div
            style={{
              padding: '10px 14px',
              background: '#f1f5f9',
              borderRadius: 8,
              fontSize: 12.5,
              color: '#475569',
            }}
          >
            Secured by Signora Document Signing Workflow
          </div>
        </div>
      </div>
    );
  }

  // Render Success Screen
  if (isSuccess) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20,
          background: 'linear-gradient(135deg, #f0fdf4 0%, #e0e7ff 100%)',
        }}
      >
        <div
          className="card"
          style={{
            maxWidth: 520,
            textAlign: 'center',
            padding: '48px 32px',
            boxShadow: '0 20px 40px rgba(0,0,0,0.08)',
          }}
        >
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: '50%',
              background: '#dcfce7',
              color: '#15803d',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 20px',
            }}
          >
            <CheckCircle2 size={44} />
          </div>

          <h1 style={{ fontSize: 26, fontWeight: 800, margin: '0 0 10px', color: '#0f172a' }}>
            Signing Completed!
          </h1>
          <p className="muted" style={{ fontSize: 15, margin: '0 0 24px', lineHeight: 1.5 }}>
            Thank you, <strong>{signer?.name}</strong>. Your electronic signature for{' '}
            <strong>"{document?.title}"</strong> has been securely recorded.
          </p>

          <div
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 12,
              padding: '18px 20px',
              textAlign: 'left',
              marginBottom: 24,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span className="muted" style={{ fontSize: 13 }}>Signer:</span>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{signer?.name} ({signer?.email})</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span className="muted" style={{ fontSize: 13 }}>Document:</span>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{document?.title}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="muted" style={{ fontSize: 13 }}>Signed Timestamp:</span>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{completionDate}</span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, color: '#15803d', fontSize: 13, fontWeight: 600 }}>
            <ShieldCheck size={18} /> Digitally logged in Document Audit Trail
          </div>
        </div>
      </div>
    );
  }

  const currentPageBoxes = boxes.filter((b) => b.page === currentPage);
  const hasInvalidBoxes = pdfPagesLoaded && boxes.some((box) =>
    !Number.isInteger(box.page) || box.page < 1 || box.page > totalPages ||
    ![box.x, box.y, box.width, box.height].every(Number.isFinite) ||
    box.x < 0 || box.y < 0 || box.width <= 0 || box.height <= 0 ||
    box.x + box.width > 100 || box.y + box.height > 100
  );
  const canSubmit = !loading && !!pdfData && pdfPagesLoaded && boxes.length > 0 && !hasInvalidBoxes;
  const boxValidationMessage = hasInvalidBoxes
    ? 'One or more assigned signature boxes do not fit on this PDF. The PDF is still available for review; please contact the sender to correct the document.'
    : pdfPagesLoaded && boxes.length === 0
      ? 'No signature boxes are assigned to you. You can review the PDF, but signing is disabled until the sender assigns at least one box.'
      : '';

  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9' }}>
      {/* Signer Header Bar */}
      <header
        style={{
          background: 'white',
          borderBottom: '1px solid #e2e8f0',
          padding: '14px 24px',
          position: 'sticky',
          top: 0,
          zIndex: 100,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <div style={{ fontSize: 17, fontWeight: 700, color: '#1e293b' }}>
            {document?.title || 'Review and Sign Document'}
          </div>
          <div className="muted" style={{ fontSize: 13 }}>
            Signing as: <strong>{signer?.name}</strong> ({signer?.email})
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {adoptedSignature ? (
            <button
              className="btn sm secondary"
              onClick={() => setIsPadOpen(true)}
              title="Change drawn signature"
            >
              <PenTool size={14} /> Change Signature
            </button>
          ) : (
            <button
              className="btn sm"
              onClick={() => setIsPadOpen(true)}
            >
              <PenTool size={14} /> Draw Signature
            </button>
          )}

          <button
            className="btn success"
            onClick={handleSubmit}
            disabled={submitting || !canSubmit}
            title={!canSubmit ? 'Waiting for the PDF and assigned signature boxes to be verified' : undefined}
          >
            <Send size={15} /> {submitting ? 'Submitting...' : canSubmit ? 'Finish & Submit' : 'Preparing PDF...'}
          </button>
        </div>
      </header>

      {/* Guide Banner */}
      {document?.status === 'pending' && signer?.status === 'pending' && (
        <div style={{ background: '#f0fdf4', borderBottom: '1px solid #bbf7d0', padding: '8px 24px', color: '#166534', fontSize: 13 }}>
          Pending — this document is ready for your signature.
        </div>
      )}
      <div
        style={{
          background: adoptedSignature ? '#f0fdf4' : '#eff6ff',
          borderBottom: `1px solid ${adoptedSignature ? '#bbf7d0' : '#bfdbfe'}`,
          padding: '10px 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 13.5,
          color: adoptedSignature ? '#166534' : '#1e40af',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <PenTool size={16} />
          {adoptedSignature ? (
            <span>
              Signature adopted! Click <strong>Finish & Submit</strong> to complete signing.
            </span>
          ) : (
            <span>
              Please review the document and click the glowing <strong>"Click to Sign"</strong> box
              or <strong>Draw Signature</strong> above.
            </span>
          )}
        </div>

        {boxes.length > 1 && (
          <button className="btn sm ghost" onClick={goToNextBox} style={{ fontSize: 12 }}>
            Next Box <ArrowRight size={13} />
          </button>
        )}
      </div>

      <main className="shell" style={{ padding: '20px 16px' }}>
        {signatureSetupError && <div className="error" role="alert" style={{ marginBottom: 14 }}>{signatureSetupError}</div>}
        {boxValidationMessage && <div className="error" role="alert" style={{ marginBottom: 14 }}>{boxValidationMessage}</div>}
        {loading ? (
          <p className="muted" style={{ textAlign: 'center', margin: '40px 0' }}>
            Loading document for signing...
          </p>
        ) : (
          <PdfViewer
            pdfData={pdfData}
            currentPage={currentPage}
            onPageChange={setCurrentPage}
            onTotalPagesLoaded={handleTotalPagesLoaded}
          >
            {currentPageBoxes.map((box, idx) => (
              <div
                key={box.id || idx}
                style={{
                  position: 'absolute',
                  left: `${box.x}%`,
                  top: `${box.y}%`,
                  width: `${box.width}%`,
                  height: `${box.height}%`,
                  zIndex: 2,
                  border: adoptedSignature ? '2px solid #16a34a' : '2px dashed #4f46e5',
                  background: adoptedSignature ? 'rgba(34, 197, 94, 0.15)' : 'rgba(99, 102, 241, 0.18)',
                  borderRadius: 6,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  boxShadow: adoptedSignature ? 'none' : '0 0 12px rgba(79, 70, 229, 0.4)',
                  padding: 4,
                  boxSizing: 'border-box',
                }}
                onClick={() => setIsPadOpen(true)}
                title={`Signature required for ${signer?.name || 'you'} - click to sign`}
                aria-label={`Signature box on page ${box.page}; click to provide your signature`}
              >
                {adoptedSignature ? (
                  <img
                    src={adoptedSignature}
                    alt="Your Signature"
                    style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                  />
                ) : (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      color: '#4338ca',
                      fontWeight: 700,
                      fontSize: 12,
                    }}
                  >
                    <PenTool size={14} /> Click to Sign
                  </div>
                )}
              </div>
            ))}
          </PdfViewer>
        )}
      </main>

      {/* Signature Pad Modal */}
      <SignaturePadModal
        isOpen={isPadOpen}
        onClose={() => setIsPadOpen(false)}
        onSave={handleSignatureAdopted}
        signerName={signer?.name || ''}
      />
    </div>
  );
}
