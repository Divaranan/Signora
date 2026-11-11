'use client';
import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import {
  UserPlus,
  Trash2,
  Send,
  ArrowLeft,
  ArrowRight,
  Mail,
  User,
  Copy,
  Check,
  AlertCircle,
  FileCheck,
} from 'lucide-react';
import Nav from '@/components/Nav';
import WorkflowStepper from '@/components/WorkflowStepper';
import { api, getError } from '@/lib/api';

interface Signer {
  id: string;
  name: string;
  email: string;
  token?: string;
  status: 'pending' | 'signed';
  signedAt?: string;
}

interface Box {
  id: string;
  signerId?: string | null;
  page: number;
}

interface SignerLink {
  name: string;
  email: string;
  signingUrl: string;
}

export default function SignersPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const resolvedParams = use(params);
  const docId = resolvedParams.id;

  const [docTitle, setDocTitle] = useState('');
  const [docStatus, setDocStatus] = useState('draft');
  const [signers, setSigners] = useState<Signer[]>([]);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [generatedLinks, setGeneratedLinks] = useState<SignerLink[] | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      router.replace('/login');
      return;
    }
    loadData();
  }, [docId, router]);

  async function loadData() {
    try {
      setLoading(true);
      setError('');
      const [docRes, signersRes, boxesRes] = await Promise.all([
        api.get('/api/documents'),
        api.get(`/api/documents/${docId}/signers`),
        api.get(`/api/documents/${docId}/boxes`),
      ]);

      const doc = (docRes.data.documents || []).find((d: any) => d.id === docId);
      if (doc) {
        setDocTitle(doc.title);
        setDocStatus(doc.status);
      }
      setSigners(signersRes.data.signers || []);
      setBoxes(boxesRes.data.boxes || []);
    } catch (err) {
      setError(getError(err));
    } finally {
      setLoading(false);
    }
  }

  // Add signer with validation
  async function handleAddSigner(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');

    const trimmedName = name.trim();
    const trimmedEmail = email.trim().toLowerCase();

    if (!trimmedName) {
      setError('Please provide a name for the signer.');
      return;
    }
    if (!trimmedEmail) {
      setError('Please provide an email address for the signer.');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      setError('Please enter a valid email address.');
      return;
    }

    // Check duplicate email
    if (signers.some((s) => s.email.toLowerCase() === trimmedEmail)) {
      setError('A signer with this email address has already been added.');
      return;
    }

    try {
      setSubmitting(true);
      const res = await api.post(`/api/documents/${docId}/signers`, {
        name: trimmedName,
        email: trimmedEmail,
      });

      setSigners((prev) => [...prev, res.data.signer]);
      setName('');
      setEmail('');
      setSuccess(`Signer ${trimmedName} added successfully!`);
      const returnBox = new URLSearchParams(window.location.search).get('returnBox');

if (returnBox !== null && /^\d+$/.test(returnBox)) {
  router.push(
    `/documents/${docId}/prepare?assignBox=${returnBox}&signerId=${res.data.signer.id}`
  );
  return;
}
    } catch (err) {
      setError(getError(err));
    } finally {
      setSubmitting(false);
    }
  }

  // Remove signer
  async function handleRemoveSigner(signerId: string) {
    if (!confirm('Are you sure you want to remove this signer?')) return;
    setError('');
    setSuccess('');

    try {
      await api.delete(`/api/documents/${docId}/signers/${signerId}`);
      setSigners((prev) => prev.filter((s) => s.id !== signerId));
      setSuccess('Signer removed.');
      // Refresh boxes since unlinked
      const boxesRes = await api.get(`/api/documents/${docId}/boxes`);
      setBoxes(boxesRes.data.boxes || []);
    } catch (err) {
      setError(getError(err));
    }
  }

  // Send for signing
  async function handleSendForSigning() {
    if (signers.length === 0) {
      setError('Please add at least one signer before sending.');
      return;
    }

    // Validate that each box is assigned to a signer
    const unassignedCount = boxes.filter((b) => !b.signerId).length;
    if (unassignedCount > 0) {
      setError(
        `There are ${unassignedCount} unassigned signature boxes. Please go back to "Place Boxes" and assign each box to a signer.`
      );
      return;
    }

    try {
      setSending(true);
      setError('');
      const res = await api.post(`/api/documents/${docId}/send`);
      setDocStatus('pending');
      setGeneratedLinks(res.data.links || []);
      setSuccess(res.data.message || 'Document sent for signing!');
    } catch (err) {
      setError(getError(err));
    } finally {
      setSending(false);
    }
  }

  function copyToClipboard(url: string, index: number) {
    navigator.clipboard.writeText(url);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2500);
  }

  const unassignedBoxes = boxes.filter((b) => !b.signerId).length;

  return (
    <>
      <Nav />
      <main className="shell">
        <div className="row" style={{ marginBottom: 14 }}>
          <div>
            <h1 className="title">Signer Management</h1>
            <p className="muted" style={{ margin: 0 }}>
              {docTitle ? `Document: ${docTitle}` : 'Add recipients and send document for signing.'}
            </p>
          </div>
          <div className="actions">
            <button
              className="btn secondary"
              onClick={() => router.push(`/documents/${docId}/prepare`)}
            >
              <ArrowLeft size={16} /> Edit Boxes
            </button>
            <button
              className="btn success"
              onClick={handleSendForSigning}
              disabled={sending || signers.length === 0}
            >
              <Send size={16} /> {sending ? 'Sending...' : 'Send for Signing'}
            </button>
            <button
              className="btn secondary"
              onClick={() => router.push(`/documents/${docId}/status`)}
            >
              Status Page <ArrowRight size={16} />
            </button>
          </div>
        </div>

        <WorkflowStepper docId={docId} currentStep="signers" />

        {error && <div className="error" style={{ marginBottom: 14 }}>{error}</div>}
        {success && <div className="success" style={{ marginBottom: 14 }}>{success}</div>}

        {/* Unassigned boxes warning */}
        {unassignedBoxes > 0 && (
          <div
            className="card"
            style={{
              padding: '12px 18px',
              marginBottom: 16,
              background: '#fffbeb',
              borderColor: '#fde68a',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <AlertCircle size={20} color="#b45309" />
            <div style={{ flex: 1, fontSize: 13.5, color: '#92400e' }}>
              <strong>Notice:</strong> You have {unassignedBoxes} unassigned signature box(es). Each
              box must be assigned to a signer before sending.
            </div>
            <button
              className="btn sm secondary"
              onClick={() => router.push(`/documents/${docId}/prepare`)}
            >
              Assign in Step 1
            </button>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
          {/* Add Signer Form */}
          <div className="card">
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 16px' }}>Add Signer</h2>
            <form onSubmit={handleAddSigner}>
              <div className="field">
                <label>Recipient Name</label>
                <div style={{ position: 'relative' }}>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Jane Doe"
                    disabled={submitting}
                  />
                </div>
              </div>

              <div className="field">
                <label>Recipient Email Address</label>
                <div style={{ position: 'relative' }}>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="e.g. jane.doe@example.com"
                    disabled={submitting}
                  />
                </div>
              </div>

              <button
                type="submit"
                className="btn"
                style={{ width: '100%', marginTop: 10 }}
                disabled={submitting}
              >
                <UserPlus size={16} /> {submitting ? 'Adding...' : 'Add Signer'}
              </button>
            </form>
          </div>

          {/* Current Signers List */}
          <div className="card">
            <div className="row" style={{ marginBottom: 14 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>
                Signers ({signers.length})
              </h2>
              <span className={`badge ${docStatus}`}>{docStatus}</span>
            </div>

            {loading ? (
              <p className="muted">Loading signers...</p>
            ) : signers.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px 10px', color: '#64748b' }}>
                <Mail size={36} color="#94a3b8" style={{ marginBottom: 8 }} />
                <p style={{ margin: 0 }}>No signers added yet.</p>
                <p style={{ fontSize: 13, margin: '4px 0 0' }}>
                  Add signer name and email above to get started.
                </p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {signers.map((signer) => {
                  const assignedBoxesCount = boxes.filter((b) => b.signerId === signer.id).length;
                  return (
                    <div
                      key={signer.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '12px 14px',
                        background: '#f8fafc',
                        borderRadius: 10,
                        border: '1px solid #e2e8f0',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{signer.name}</div>
                        <div className="muted" style={{ fontSize: 12.5 }}>{signer.email}</div>
                        <div style={{ marginTop: 4, display: 'flex', gap: 6, alignItems: 'center' }}>
                          <span
                            className="badge sm"
                            style={{
                              fontSize: 11,
                              padding: '2px 7px',
                              background: assignedBoxesCount > 0 ? '#e0e7ff' : '#fee2e2',
                              color: assignedBoxesCount > 0 ? '#3730a3' : '#b91c1c',
                            }}
                          >
                            {assignedBoxesCount} box(es) assigned
                          </span>
                          <span
                            className="badge sm"
                            style={{
                              fontSize: 11,
                              padding: '2px 7px',
                              background: signer.status === 'signed' ? '#dcfce7' : '#fef3c7',
                              color: signer.status === 'signed' ? '#15803d' : '#b45309',
                            }}
                          >
                            {signer.status}
                          </span>
                        </div>
                      </div>

                      <button
                        className="btn sm danger"
                        onClick={() => handleRemoveSigner(signer.id)}
                        disabled={docStatus === 'completed'}
                        title="Remove signer"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Modal showing generated signing links when document is sent */}
        {generatedLinks && (
          <div className="modal-overlay" onClick={() => setGeneratedLinks(null)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 600 }}>
              <div className="row" style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <FileCheck size={26} color="#16a34a" />
                  <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700 }}>Document Sent for Signing!</h2>
                </div>
              </div>

              <p className="muted" style={{ margin: '0 0 16px' }}>
                Each recipient has received their secure tokenized signing link. You can also copy them
                directly below to test or send manually:
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
                {generatedLinks.map((link, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: '12px 14px',
                      background: '#f8fafc',
                      borderRadius: 10,
                      border: '1px solid #e2e8f0',
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 4 }}>
                      {link.name} ({link.email})
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input
                        type="text"
                        readOnly
                        value={link.signingUrl}
                        style={{
                          flex: 1,
                          fontSize: 12,
                          padding: '6px 10px',
                          background: '#fff',
                          border: '1px solid #cbd5e1',
                          borderRadius: 6,
                        }}
                      />
                      <button
                        className="btn sm secondary"
                        onClick={() => copyToClipboard(link.signingUrl, idx)}
                      >
                        {copiedIndex === idx ? <Check size={14} color="#16a34a" /> : <Copy size={14} />}
                        {copiedIndex === idx ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button
                  className="btn secondary"
                  onClick={() => setGeneratedLinks(null)}
                >
                  Close
                </button>
                <button
                  className="btn"
                  onClick={() => router.push(`/documents/${docId}/status`)}
                >
                  Track in Status Page <ArrowRight size={15} />
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
