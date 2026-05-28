// src/upload/UploadPage.jsx — Página pública (sem login) para o cliente enviar documentos.
import React, { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import './upload.css';

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp';

function fmtSize(b) {
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1024 / 1024).toFixed(1) + ' MB';
}

export default function UploadPage() {
  const { token } = useParams();
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(null);
  const [done, setDone] = useState([]); // [{filename,size,ok}]
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/public/upload/' + token);
      const d = await r.json();
      if (!r.ok || d.error) { setError(d.error || 'Link inválido'); return; }
      setInfo(d);
    } catch (e) {
      setError('Não foi possível carregar: ' + e.message);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [token]);

  const uploadFile = async (file) => {
    if (!file) return;
    setUploading(true);
    setProgress({ filename: file.name, size: file.size });
    try {
      const r = await fetch('/api/public/upload/' + token, {
        method: 'POST',
        headers: { 'Content-Type': file.type, 'X-Filename': file.name },
        body: file,
      });
      const d = await r.json();
      setDone((prev) => [{ filename: file.name, size: file.size, ok: r.ok && d.ok, error: d.error }, ...prev]);
      if (r.ok) await load();
    } catch (e) {
      setDone((prev) => [{ filename: file.name, size: file.size, ok: false, error: e.message }, ...prev]);
    } finally {
      setUploading(false);
      setProgress(null);
    }
  };

  const handleFiles = async (files) => {
    for (const f of Array.from(files || [])) await uploadFile(f);
    if (fileInput.current) fileInput.current.value = '';
  };

  const onDrop = (e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); };

  if (loading) return <div className="up-shell"><div className="up-card">A carregar…</div></div>;
  if (error) return (
    <div className="up-shell">
      <div className="up-card up-card-err">
        <h1>Link indisponível</h1>
        <p>{error}</p>
        <p style={{ fontSize: '0.9rem', color: '#666', marginTop: '1.5rem' }}>
          Se este link foi partilhado consigo recentemente, por favor contacte o escritório.
        </p>
      </div>
    </div>
  );

  return (
    <div className="up-shell">
      <header className="up-header">
        <div className="up-brand">
          <strong>VYVIAN AVENA</strong>
          <span>Advogada</span>
        </div>
      </header>
      <main className="up-card">
        <h1>Envio de documentos</h1>
        <p className="up-greet">Olá, <strong>{info.client_name}</strong>.</p>
        {info.instructions && <div className="up-instructions">{info.instructions}</div>}

        <div
          className={'up-dropzone' + (dragOver ? ' is-over' : '') + (uploading ? ' is-busy' : '')}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => !uploading && fileInput.current && fileInput.current.click()}
        >
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPT}
            multiple
            style={{ display: 'none' }}
            onChange={(e) => handleFiles(e.target.files)}
          />
          <div className="up-dz-icon">📎</div>
          <div className="up-dz-title">
            {uploading ? `A enviar ${progress?.filename}…` : 'Arrastar ficheiros ou clicar para escolher'}
          </div>
          <div className="up-dz-sub">
            PDF, JPG, PNG ou WEBP · até {Math.round((info.max_bytes || 15 * 1024 * 1024) / 1024 / 1024)} MB por ficheiro
          </div>
        </div>

        {(done.length > 0 || (info.uploaded && info.uploaded.length > 0)) && (
          <div className="up-list">
            <div className="up-list-title">Documentos enviados</div>
            <ul>
              {info.uploaded?.map((u) => (
                <li key={u.id} className="ok">
                  <span className="up-check">✓</span>
                  <span className="up-name">{u.filename}</span>
                  <span className="up-meta">{fmtSize(u.size_bytes)}</span>
                </li>
              ))}
              {done.filter((d) => !d.ok).map((d, i) => (
                <li key={'err' + i} className="err">
                  <span className="up-cross">✕</span>
                  <span className="up-name">{d.filename}</span>
                  <span className="up-meta">{d.error || 'erro'}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="up-footer">
          Link válido até {new Date(info.expires_at).toLocaleDateString('pt-PT')}.
          Os documentos enviados ficam guardados em segurança e acessíveis apenas pela Dra. Vyvian Avena.
        </p>
      </main>
    </div>
  );
}
