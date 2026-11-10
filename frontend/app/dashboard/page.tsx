'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  FileText,
  Eye,
  Download,
  Trash2,
  Plus,
  PenTool,
  Users,
  Activity,
  CheckCircle2,
} from 'lucide-react';
import Nav from '@/components/Nav';
import { api, getError } from '@/lib/api';

type Doc = {
  id: string;
  title: string;
  originalName: string;
  fileSize: number;
  status: string;
  createdAt: string;
};

export default function Dashboard() {
  const router = useRouter();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    if (!localStorage.getItem('token')) {
      router.replace('/login');
      return;
    }
    try {
      const [me, list] = await Promise.all([
        api.get('/api/auth/me'),
        api.get('/api/documents'),
      ]);
      setName(me.data.name);
      setDocs(list.data.documents);
    } catch (e) {
      localStorage.removeItem('token');
      router.replace('/login');
      setError(getError(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function openPDF(id: string, download = false) {
    try {
      const res = await api.get(`/api/documents/${id}/${download ? 'download' : 'view'}`, {
        responseType: 'blob',
      });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      if (download) {
        a.download = 'document.pdf';
        a.click();
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      setError(getError(e));
    }
  }

  async function downloadSignedPDF(id: string, title: string) {
    try {
      const res = await api.get(`/api/documents/${id}/signed-download`, {
        responseType: 'blob',
      });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title}_signed.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      setError(getError(e));
    }
  }

  async function remove(id: string) {
    if (!confirm('Are you sure you want to delete this document?')) return;
    try {
      await api.delete(`/api/documents/${id}`);
      setDocs((old) => old.filter((d) => d.id !== id));
    } catch (e) {
      setError(getError(e));
    }
  }

  return (
    <>
      <Nav />
      <main className="shell">
        <div className="row">
          <div>
            <h1 className="title">My Documents</h1>
            <p className="muted">
              Welcome, {name || '...'}. Prepare, send, and track your electronic documents.
            </p>
          </div>
          <button className="btn" onClick={() => router.push('/upload')}>
            <Plus size={17} /> Upload PDF
          </button>
        </div>

        <div className="spacer" />
        {error && <p className="error">{error}</p>}

        {loading ? (
          <p className="muted">Loading documents...</p>
        ) : docs.length === 0 ? (
          <section className="card" style={{ textAlign: 'center', padding: 50 }}>
            <FileText size={42} color="#818cf8" style={{ margin: '0 auto 12px' }} />
            <h2 style={{ margin: '0 0 6px' }}>No documents yet</h2>
            <p className="muted" style={{ margin: '0 0 20px' }}>
              Upload your first PDF document to begin adding signers and signature boxes.
            </p>
            <button className="btn" onClick={() => router.push('/upload')}>
              Upload a PDF
            </button>
          </section>
        ) : (
          <div className="grid">
            {docs.map((doc) => {
              const isCompleted = doc.status === 'completed';
              return (
                <article className="card doc" key={doc.id}>
                  <div className="row">
                    <FileText color="#6366f1" size={26} />
                    <span className={`badge ${doc.status}`}>{doc.status}</span>
                  </div>

                  <div>
                    <h3 style={{ margin: '4px 0 6px', fontSize: 16 }}>{doc.title}</h3>
                    <p className="muted" style={{ margin: 0, overflowWrap: 'anywhere', fontSize: 13 }}>
                      {doc.originalName}
                    </p>
                  </div>

                  <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                    {(doc.fileSize / 1024 / 1024).toFixed(2)} MB ·{' '}
                    {new Date(doc.createdAt).toLocaleDateString()}
                  </p>

                  {/* Main Workflow Quick Actions */}
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                      background: '#f8fafc',
                      padding: 10,
                      borderRadius: 8,
                      border: '1px solid #e2e8f0',
                    }}
                  >
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        className="btn sm secondary"
                        style={{ flex: 1 }}
                        onClick={() => router.push(`/documents/${doc.id}/prepare`)}
                        title="Place signature boxes on PDF"
                      >
                        <PenTool size={13} /> Boxes
                      </button>
                      <button
                        className="btn sm secondary"
                        style={{ flex: 1 }}
                        onClick={() => router.push(`/documents/${doc.id}/signers`)}
                        title="Manage signers and send"
                      >
                        <Users size={13} /> Signers
                      </button>
                    </div>

                    <button
                      className="btn sm secondary"
                      style={{ width: '100%' }}
                      onClick={() => router.push(`/documents/${doc.id}/status`)}
                      title="Track signing progress and audit logs"
                    >
                      <Activity size={13} /> Status & Audit
                    </button>
                  </div>

                  {/* Document & Download Actions */}
                  <div className="actions" style={{ marginTop: 'auto', paddingTop: 8 }}>
                    {isCompleted ? (
                      <button
                        className="btn sm success"
                        style={{ flex: 1 }}
                        onClick={() => downloadSignedPDF(doc.id, doc.title)}
                        title="Download completed signed PDF"
                      >
                        <Download size={13} /> Signed PDF
                      </button>
                    ) : (
                      <button
                        className="btn sm secondary"
                        style={{ flex: 1 }}
                        onClick={() => openPDF(doc.id)}
                      >
                        <Eye size={13} /> View
                      </button>
                    )}

                    <button
                      className="btn sm secondary"
                      onClick={() => openPDF(doc.id, true)}
                      title="Download Original"
                    >
                      <Download size={13} />
                    </button>
                    <button
                      className="btn sm danger"
                      onClick={() => remove(doc.id)}
                      aria-label="Delete"
                      title="Delete document"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>
    </>
  );
}
