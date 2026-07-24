// src/admin/insights/RichEditor.jsx
// Editor de texto rico — padrão "Minimal Tiptap" do 21st.dev (TipTap + toolbar
// completa), adaptado ao estilo da área privada (classes adm-*).
// Entrada/saída em Markdown (tiptap-markdown), porque o blogue vive em .md.
// Carregado em lazy (React.lazy) para não pesar o bundle base do admin.
import React, { useCallback, useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from 'tiptap-markdown';
import { admPrompt } from '../dialogs';

const I = ({ d, ...p }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
    {Array.isArray(d) ? d.map((x, i) => <path key={i} d={x} />) : <path d={d} />}
  </svg>
);

function Btn({ on, active, disabled, title, children }) {
  return (
    <button type="button" className={'adm-rte-btn' + (active ? ' active' : '')}
            onMouseDown={(e) => e.preventDefault()} onClick={on} disabled={disabled} title={title} aria-label={title}>
      {children}
    </button>
  );
}

export default function RichEditor({ initialMarkdown, onChangeMarkdown, placeholder }) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      Underline,
      Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer' } }),
      Placeholder.configure({ placeholder: placeholder || 'Escreva o artigo…' }),
      Markdown.configure({ html: true, linkify: true, breaks: false }),
    ],
    content: initialMarkdown || '',
    onUpdate: ({ editor: ed }) => {
      onChangeMarkdown && onChangeMarkdown(ed.storage.markdown.getMarkdown());
    },
  });

  // se o markdown inicial mudar (outro artigo), recarrega o conteúdo
  useEffect(() => {
    if (!editor) return;
    const atual = editor.storage.markdown.getMarkdown();
    if ((initialMarkdown || '') !== atual) {
      editor.commands.setContent(initialMarkdown || '', false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMarkdown, editor]);

  const setLink = useCallback(async () => {
    if (!editor) return;
    const prev = editor.getAttributes('link').href || '';
    const url = await admPrompt('Endereço do link:', { title: 'Inserir link', defaultValue: prev, placeholder: 'https://…' });
    if (url == null) return;
    if (url === '') { editor.chain().focus().extendMarkRange('link').unsetLink().run(); return; }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }, [editor]);

  if (!editor) return <div className="adm-rte"><div className="adm-rte-loading">A preparar o editor…</div></div>;

  const c = editor.chain().focus();

  return (
    <div className="adm-rte">
      <div className="adm-rte-toolbar" role="toolbar" aria-label="Formatação">
        <Btn title="Anular (Ctrl+Z)" on={() => c.undo().run()} disabled={!editor.can().undo()}>
          <I d="M3 7v6h6M3 13a9 9 0 1 0 3-7.7L3 7" />
        </Btn>
        <Btn title="Refazer (Ctrl+Y)" on={() => c.redo().run()} disabled={!editor.can().redo()}>
          <I d="M21 7v6h-6M21 13a9 9 0 1 1-3-7.7L21 7" />
        </Btn>
        <span className="adm-rte-sep" />
        <Btn title="Parágrafo" active={editor.isActive('paragraph')} on={() => c.setParagraph().run()}>
          <I d="M13 4v16M17 4v16M19 4H9.5a4.5 4.5 0 0 0 0 9H13" />
        </Btn>
        <Btn title="Título de secção (H2)" active={editor.isActive('heading', { level: 2 })}
             on={() => c.toggleHeading({ level: 2 }).run()}>
          <strong style={{ fontSize: 12 }}>H2</strong>
        </Btn>
        <Btn title="Subtítulo (H3)" active={editor.isActive('heading', { level: 3 })}
             on={() => c.toggleHeading({ level: 3 }).run()}>
          <strong style={{ fontSize: 12 }}>H3</strong>
        </Btn>
        <span className="adm-rte-sep" />
        <Btn title="Negrito (Ctrl+B)" active={editor.isActive('bold')} on={() => c.toggleBold().run()}>
          <I d={["M6 4h8a4 4 0 0 1 0 8H6z", "M6 12h9a4 4 0 0 1 0 8H6z"]} />
        </Btn>
        <Btn title="Itálico (Ctrl+I)" active={editor.isActive('italic')} on={() => c.toggleItalic().run()}>
          <I d={["M19 4h-9", "M14 20H5", "M15 4 9 20"]} />
        </Btn>
        <Btn title="Sublinhado (Ctrl+U)" active={editor.isActive('underline')} on={() => c.toggleUnderline().run()}>
          <I d={["M6 4v6a6 6 0 0 0 12 0V4", "M4 20h16"]} />
        </Btn>
        <Btn title="Rasurado" active={editor.isActive('strike')} on={() => c.toggleStrike().run()}>
          <I d={["M16 4H9a3 3 0 0 0-2.83 4", "M14 12a4 4 0 0 1 0 8H6", "M4 12h16"]} />
        </Btn>
        <span className="adm-rte-sep" />
        <Btn title="Lista de pontos" active={editor.isActive('bulletList')} on={() => c.toggleBulletList().run()}>
          <I d={["M8 6h13", "M8 12h13", "M8 18h13", "M3 6h.01", "M3 12h.01", "M3 18h.01"]} />
        </Btn>
        <Btn title="Lista numerada" active={editor.isActive('orderedList')} on={() => c.toggleOrderedList().run()}>
          <I d={["M10 6h11", "M10 12h11", "M10 18h11", "M4 6h1v4", "M4 10h2", "M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"]} />
        </Btn>
        <Btn title="Caixa de aviso (citação)" active={editor.isActive('blockquote')} on={() => c.toggleBlockquote().run()}>
          <I d={["M17 6H3", "M21 12H8", "M21 18H8", "M3 12v6"]} />
        </Btn>
        <span className="adm-rte-sep" />
        <Btn title="Inserir/editar link" active={editor.isActive('link')} on={setLink}>
          <I d={["M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71", "M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"]} />
        </Btn>
        <Btn title="Remover link" disabled={!editor.isActive('link')}
             on={() => c.unsetLink().run()}>
          <I d={["M18.84 12.25l1.72-1.71a5 5 0 0 0-7.07-7.07l-1.72 1.71", "M5.17 11.75l-1.72 1.71a5 5 0 0 0 7.07 7.07l1.71-1.71", "m2 2 20 20"]} />
        </Btn>
        <span className="adm-rte-sep" />
        <Btn title="Linha separadora" on={() => c.setHorizontalRule().run()}>
          <I d="M3 12h18" />
        </Btn>
        <Btn title="Limpar formatação" on={() => c.clearNodes().unsetAllMarks().run()}>
          <I d={["M4 7V4h16v3", "M5 20h6", "M13 4 8 20", "m15 15 5 5", "m20 15-5 5"]} />
        </Btn>
      </div>
      <EditorContent editor={editor} className="adm-rte-area" />
    </div>
  );
}
