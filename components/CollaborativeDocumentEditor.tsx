import React, { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import Placeholder from '@tiptap/extension-placeholder';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';
import type { CollaborationAdapter, CollaborationSession } from '../services/collaborativeDocuments';
import RemixIcon from './RemixIcon';
import CollaborationHistory from './CollaborationHistory';
import {useInteractionMotion} from '../hooks/useInteractionMotion';
import './CollaborativeDocumentEditor.css';

async function hash(doc: Y.Doc) {
  const normalized = new Y.Doc();
  let bytes: Uint8Array;
  try {
    Y.applyUpdate(normalized, Y.encodeStateAsUpdate(doc));
    bytes = Y.encodeStateAsUpdate(normalized);
  } finally { normalized.destroy(); }
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
type Room = { doc: Y.Doc; provider: HocuspocusProvider; session: CollaborationSession };
export default function CollaborativeDocumentEditor({ adapter, onClose }: { adapter: CollaborationAdapter; onClose(): void }) {
  const [room, setRoom] = useState<Room>();
  const [status, setStatus] = useState('正在连接…');
  const [error, setError] = useState('');
  const [people, setPeople] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [characterCount, setCharacterCount] = useState(0);
  const [zoom, setZoom] = useState(100);
  const [showRuler, setShowRuler] = useState(true);
  const savedRef = useRef(false);
  const shell=useRef<HTMLElement>(null);const motion=useInteractionMotion();
  const [historyOpen,setHistoryOpen]=useState(false),[snapshotRevision,setSnapshotRevision]=useState(0);
  const previousSaved=useRef(false);
  useEffect(()=>{if(saved&&!previousSaved.current){const target=shell.current?.querySelector<HTMLElement>('.collab-save-state');if(target)motion.highlight(target,'collab-saved');}previousSaved.current=saved;},[saved,motion]);
  useEffect(()=>{if(snapshotRevision){const target=shell.current?.querySelector<HTMLElement>('[data-save-snapshot]');if(target)motion.highlight(target,'version-saved');}},[snapshotRevision,motion]);
  useEffect(()=>{if(room){motion.enter([...(shell.current?.querySelectorAll<HTMLElement>('.collab-header,.collab-footer')??[])],'document-open');}},[room,motion]);
  useEffect(() => {
    let cancelled = false;
    let doc: Y.Doc | undefined;
    let provider: HocuspocusProvider | undefined;
    let persistence: IndexeddbPersistence | undefined;
    let savedHash = '';
    let revision = 0;
    const markSaved = (value: boolean) => { savedRef.current = value; if (!cancelled) setSaved(value); };
    const check = async () => {
      const current = ++revision;
      if (!doc) return;
      const actual = await hash(doc);
      if (!cancelled && current === revision) markSaved(actual === savedHash && provider?.isSynced === true);
    };
    void (async () => {
      const session = await adapter.session();
      if (cancelled) return;
      doc = new Y.Doc();
      // Cache is isolated by account AND room. Read-only sessions never upload cached writes.
      if (session.canEdit) {
        persistence = new IndexeddbPersistence(`hakcc-collab:${session.user.id}:${session.documentId}`, doc);
        await persistence.whenSynced;
        if (cancelled) return;
      }
      doc.on('update', () => { markSaved(false); void check(); });
      provider = new HocuspocusProvider({
        url: session.websocketUrl, name: session.documentId, document: doc, token: () => adapter.token(),
        onStatus: ({ status: value }) => { if (!cancelled) { setStatus(value === 'connected' ? '在线' : '离线 · 等待重连'); if (value !== 'connected') markSaved(false); } },
        onAuthenticationFailed: () => { if (!cancelled) { setError('文档权限失效，请关闭后重新打开'); markSaved(false); } },
        onAuthenticated: ({ scope }) => { if (scope === 'readonly' && session.canEdit && !cancelled) setError('当前会话已变为只读，请重新打开文档'); },
        onSynced: () => { provider?.sendStateless('saved-state'); void check(); },
        onAwarenessChange: ({ states }) => { if (!cancelled) setPeople([...new Set(states.map(state => state.user?.name).filter(Boolean))] as string[]); },
        onStateless: ({ payload }) => {
          let message;
          try { message = JSON.parse(payload); } catch { return; }
          if (message.type === 'saved') { savedHash = message.hash; void check(); }
          if (message.type === 'save-error' && !cancelled) { setError(message.message); markSaved(false); }
        },
      });
      provider.setAwarenessField('user', session.user);
      setRoom({ doc, provider, session });
    })().catch(() => { if (!cancelled) setError('无法连接协作文档，请确认本地服务已启动'); });
    const beforeUnload = (event: BeforeUnloadEvent) => { if (!savedRef.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      cancelled = true;
      window.removeEventListener('beforeunload', beforeUnload);
      provider?.destroy();
      // Let IndexedDB finish its last queued write before releasing the document.
      if (persistence) void persistence.destroy().finally(() => doc?.destroy());
      else doc?.destroy();
    };
  }, [adapter]);
  const action = async (kind: 'export' | 'snapshot') => {
    setBusy(true); setError('');
    try {
      if (!saved) throw new Error('请等到显示“已保存”后再操作');
      if (kind === 'snapshot') { await adapter.snapshot(); setStatus('在线 · 已保存版本快照'); setSnapshotRevision(value=>value+1); }
      else {
        const url = URL.createObjectURL(await adapter.export());
        const link = document.createElement('a'); link.href = url;
        link.download = `${(room?.session.title || '协作文档').replace(/[\\/:*?"<>|]/g, '_')}.docx`;
        link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (err) { setError(err instanceof Error ? err.message : '操作失败'); }
    finally { setBusy(false); }
  };
  return <section ref={shell} className="collab-shell" role="dialog" aria-modal="true" aria-label="协作文档" data-canvas-overlay>
    <header className="collab-header">
      <button className="collab-back collab-icon-button" aria-label="关闭协作文档" title="返回知识空间" onClick={onClose}><RemixIcon name="arrow-left-line" size={19} /></button>
      <span className="collab-document-mark"><RemixIcon name="file-word-2-line" size={24} /></span>
      <div className="collab-document-title">
        <h1 title={room?.session.title}>{room?.session.title || '协作文档'}</h1>
        <div className="collab-save-state" role="status"><RemixIcon name={saved ? 'checkbox-circle-line' : 'cloud-line'} size={13} />
          <span>{saved ? '已保存' : '待同步'}</span><span className="collab-status-separator">·</span><span>{status}</span>
          {room && !room.session.canEdit && <span className="collab-readonly"><RemixIcon name="lock-line" size={11} />只读</span>}
        </div>
      </div>
      <div className="collab-presence" aria-label="文档参与者">
        <div className="collab-avatar-stack">{people.slice(0, 4).map((name, index) => <span className={`collab-avatar collab-avatar-${index % 3}`} title={name} key={name}>{/[AB]$/.test(name) ? name.slice(-1) : name.slice(0, 1)}</span>)}</div>
        <span>{people.length ? `${people.length} 人协作` : '正在连接'}</span>
      </div>
      <div className="collab-actions">
        {adapter.snapshots&&adapter.readSnapshot&&<button disabled={!room} aria-expanded={historyOpen} onClick={()=>setHistoryOpen(open=>!open)} title="查看已保存版本"><RemixIcon name="time-line" size={16}/><span>版本记录</span></button>}
        {room?.session.canEdit && <button data-save-snapshot disabled={!saved || busy} onClick={() => void action('snapshot')} title="保留当前版本快照"><RemixIcon name="history-line" size={16} /><span>保存版本</span></button>}
        <button className="collab-export" disabled={!saved || busy} onClick={() => void action('export')} title="下载 Word 副本，复杂排版可能简化"><RemixIcon name="download-2-line" size={16} /><span>导出 Word</span></button>
      </div>
    </header>
    {error && <p className="collab-error" role="alert">{error}</p>}
    {room ? <div className="collab-document-stage"><DocumentBody room={room} onError={setError} onCount={setCharacterCount} zoom={zoom} onZoom={setZoom} showRuler={showRuler} onRuler={setShowRuler} />{historyOpen&&<CollaborationHistory adapter={adapter} revision={snapshotRevision} onClose={()=>setHistoryOpen(false)}/>}</div>
      : <div className="collab-loading">正在打开文档…</div>}
    <footer className="collab-footer">
      <div className="collab-document-info"><span><RemixIcon name="file-text-line" size={14} />页面视图</span><span>{characterCount.toLocaleString()} 字</span><span className="collab-footer-mode">{room?.session.canEdit ? '协同编辑' : '只读模式'}</span></div>
      <div className="collab-zoom-controls"><button className="collab-icon-button" aria-label="缩小页面" disabled={zoom <= 75} onClick={() => setZoom(value => Math.max(75, value - 5))}><RemixIcon name="subtract-line" size={16} /></button>
        <input aria-label="页面缩放" type="range" min={75} max={150} step={5} value={zoom} onChange={event => setZoom(Number(event.target.value))} />
        <button className="collab-icon-button" aria-label="放大页面" disabled={zoom >= 150} onClick={() => setZoom(value => Math.min(150, value + 5))}><RemixIcon name="add-line" size={16} /></button>
        <button className="collab-zoom-value" aria-label="恢复百分之百缩放" onClick={() => setZoom(100)}>{zoom}%</button>
      </div>
    </footer>
  </section>;
}
function DocumentBody({ room, onError, onCount, zoom, onZoom, showRuler, onRuler }: {
  room: Room; onError(message: string): void; onCount(value: number): void;
  zoom: number; onZoom(value: number): void; showRuler: boolean; onRuler(value: boolean): void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<'start' | 'insert' | 'view'>('start');
  const ribbon=useRef<HTMLElement>(null);const motion=useInteractionMotion();
  useEffect(()=>{if(ribbon.current)motion.enter([ribbon.current],'document-toolbar');return()=>motion.stop('document-toolbar');},[tab,motion]);
  const editor = useEditor({
    immediatelyRender: false, editable: room.session.canEdit,
    extensions: [StarterKit.configure({ undoRedo: false }), Collaboration.configure({ document: room.doc }),
      CollaborationCaret.configure({ provider: room.provider, user: room.session.user }),
      Image.configure({ allowBase64: true }), TableKit.configure({ table: { resizable: true } }),
      Placeholder.configure({ placeholder: '一起写下观点、证据与尚待解决的问题…' })],
    editorProps: { attributes: { 'aria-label': '协作文档正文', 'data-testid': 'collab-editor' } },
    onCreate: ({ editor }) => onCount(editor.getText().replace(/\s/g, '').length),
    onUpdate: ({ editor }) => onCount(editor.getText().replace(/\s/g, '').length),
  });
  const state = useEditorState({ editor, selector: ({ editor }) => editor ? {
    editable: editor.isEditable, bold: editor.isActive('bold'), italic: editor.isActive('italic'),
    underline: editor.isActive('underline'), strike: editor.isActive('strike'),
    bullet: editor.isActive('bulletList'), ordered: editor.isActive('orderedList'), table: editor.isActive('table'),
    heading: [1, 2, 3].find(level => editor.isActive('heading', { level })) || 0,
    undo: editor.can().undo(), redo: editor.can().redo(),
  } : null });
  useEffect(() => {
    const changed = ({ scope }: { scope: string }) => editor?.setEditable(scope === 'read-write');
    room.provider.on('authenticated', changed);
    return () => { room.provider.off('authenticated', changed); };
  }, [editor, room]);
  const image = async (file?: File) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 1_000_000) { onError('请选择不超过 1 MB 的 PNG 或 JPG 图片'); return; }
    const reader = new FileReader();
    reader.onload = () => editor?.chain().focus().setImage({ src: String(reader.result), alt: file.name }).run();
    reader.onerror = () => onError('图片读取失败'); reader.readAsDataURL(file);
  };
  if (!editor || !state) return <div className="collab-loading">正在载入正文…</div>;
  const disabled = !room.session.canEdit || !state.editable;
  const button = (label: string, icon: string, command: () => void, active?: boolean, unavailable = false, large = false) =>
    <button type="button" className={`collab-format-button ${large ? 'collab-large-button' : ''} ${active ? 'is-active' : ''}`} aria-label={label} aria-pressed={active} title={label}
      disabled={disabled || unavailable} onClick={command} onMouseDown={event => event.preventDefault()}><RemixIcon name={icon} size={large ? 25 : 19} />{large && <span>{label}</span>}</button>;
  const group = (label: string, children: React.ReactNode) => <div className="collab-ribbon-group"><div className="collab-group-content">{children}</div><span className="collab-group-label">{label}</span></div>;
  const tabs = [{ id: 'start', label: '开始' }, { id: 'insert', label: '插入' }, { id: 'view', label: '视图' }] as const;
  return <>
    <div className="collab-tab-row">
      <div role="tablist" aria-label="文档工具">{tabs.map((item, index) => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id}
        aria-controls={`collab-ribbon-${item.id}`} id={`collab-tab-${item.id}`} tabIndex={tab === item.id ? 0 : -1}
        className={tab === item.id ? 'is-selected' : ''} onClick={() => setTab(item.id)} onKeyDown={event => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault(); const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : 2)) % tabs.length];
          setTab(next.id); document.getElementById(`collab-tab-${next.id}`)?.focus();
        }}>{item.label}</button>)}</div>
      <span className="collab-edit-mode"><RemixIcon name={disabled ? 'lock-line' : 'edit-line'} size={13} />{disabled ? '只读' : '编辑中'}</span>
    </div>
    <nav ref={ribbon} className="collab-ribbon" role="tabpanel" aria-labelledby={`collab-tab-${tab}`} id={`collab-ribbon-${tab}`}>
      {tab === 'start' && <>
        {group('历史', <div className="collab-history-buttons">{button('撤销', 'arrow-go-back-line', () => { editor.chain().focus().undo().run(); }, undefined, !state.undo)}{button('重做', 'arrow-go-forward-line', () => { editor.chain().focus().redo().run(); }, undefined, !state.redo)}</div>)}
        {group('文字格式', <div className="collab-font-controls"><span className="collab-font-caption">文字与重点</span><div className="collab-button-row">
          {button('加粗', 'bold', () => { editor.chain().focus().toggleBold().run(); }, state.bold)}
          {button('斜体', 'italic', () => { editor.chain().focus().toggleItalic().run(); }, state.italic)}
          {button('下划线', 'underline', () => { editor.chain().focus().toggleUnderline().run(); }, state.underline)}
          {button('删除线', 'strikethrough', () => { editor.chain().focus().toggleStrike().run(); }, state.strike)}
          {button('清除文字格式', 'format-clear', () => { editor.chain().focus().unsetAllMarks().run(); })}</div></div>)}
        {group('段落', <div className="collab-paragraph-controls"><select aria-label="段落样式" disabled={disabled} value={state.heading} onChange={event => {
          const level = Number(event.target.value); if (level === 0) editor.chain().focus().setParagraph().run();
          else editor.chain().focus().setHeading({ level: level as 1 | 2 | 3 }).run();
        }}><option value={0}>正文</option><option value={1}>标题 1</option><option value={2}>标题 2</option><option value={3}>标题 3</option></select><div className="collab-button-row">
          {button('项目符号', 'list-unordered', () => { editor.chain().focus().toggleBulletList().run(); }, state.bullet)}
          {button('编号', 'list-ordered', () => { editor.chain().focus().toggleOrderedList().run(); }, state.ordered)}</div></div>)}
        {group('样式', <div className="collab-style-gallery">{[0, 1, 2].map(level => <button key={level} aria-label={level === 0 ? '正文' : level === 1 ? '一级标题' : '标题'} aria-pressed={state.heading === level}
          className={state.heading === level ? 'is-active' : ''} disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={() => {
            if (!level) editor.chain().focus().setParagraph().run(); else editor.chain().focus().setHeading({ level: level as 1 | 2 }).run();
          }}><span className={`collab-style-preview collab-style-preview-${level}`}>{level ? '标题' : '正文'}</span><span>{level ? `标题 ${level}` : '正文'}</span></button>)}</div>)}
      </>}
      {tab === 'insert' && <>
        {group('内容', <><div className="collab-button-row">{button('表格', 'table-2', () => { editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); }, undefined, false, true)}
          {button('图片', 'image-add-line', () => fileRef.current?.click(), undefined, false, true)}</div></>)}
        {state.table && group('表格编辑', <div className="collab-table-actions"><button disabled={disabled} onClick={() => editor.chain().focus().addRowAfter().run()}>添加行</button><button disabled={disabled} onClick={() => editor.chain().focus().addColumnAfter().run()}>添加列</button><button disabled={disabled} onClick={() => editor.chain().focus().deleteTable().run()}>删除表格</button></div>)}
        <span className="collab-ribbon-hint">把证据与资料放进共同的文档</span>
      </>}
      {tab === 'view' && <>
        {group('显示', <label className="collab-ruler-option"><input type="checkbox" checked={showRuler} onChange={event => onRuler(event.target.checked)} /><RemixIcon name="ruler-line" size={22} /><span>标尺</span></label>)}
        {group('缩放', <div className="collab-view-controls"><button onClick={() => onZoom(100)}><RemixIcon name="zoom-in-line" size={22} /><span>100%</span></button><span>右下角可调整页面大小</span></div>)}
      </>}
      <input hidden ref={fileRef} type="file" accept="image/png,image/jpeg" onChange={event => { void image(event.target.files?.[0]); event.target.value = ''; }} />
    </nav>
    <div className="collab-page">
      <div className="collab-paper-stack" style={{ zoom: zoom / 100 }}>
        {showRuler && <div className="collab-ruler" aria-hidden="true"><div className="collab-ruler-ticks">{Array.from({ length: 16 }, (_, i) => <span key={i}>{i || ''}</span>)}</div></div>}
        <div className="collab-paper"><EditorContent editor={editor} /></div>
      </div>
    </div>
  </>;
}
