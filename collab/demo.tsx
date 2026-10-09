import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import CollaborativeDocumentEditor from '../components/CollaborativeDocumentEditor';
import type { CollaborationAdapter, CollaborationSession } from '../services/collaborativeDocuments';
import '../styles/remixicon/remixicon.css';

function Demo() {
  const [person, setPerson] = useState(new URLSearchParams(location.search).get('person') || 'student-a');
  const [open, setOpen] = useState(true);
  const adapter = useMemo<CollaborationAdapter>(() => {
    let token = '';
    const session = async () => {
      const response = await fetch('/demo/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ person }) });
      if (!response.ok) throw new Error('试点会话创建失败');
      const result = await response.json(); token = result.token;
      return { ...result, websocketUrl: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/collab` } as CollaborationSession;
    };
    const request = async (action: string, method = 'GET') => {
      const response = await fetch(`/demo/documents/demo-document/${action}`, { method, headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error('操作失败，请重新连接'); return response;
    };
    return { session, token: async () => { await session(); return token; },
      export: async () => (await request('export')).blob(), snapshot: async () => { await request('snapshots', 'POST'); } };
  }, [person]);
  return <main className="collab-demo">
    <div className="collab-demo-banner">
      <strong>HAKCC <span>协作文档试点</span></strong><span className="collab-demo-note">虚构身份 · 不连接生产数据</span>
      <label>当前身份 <select aria-label="当前身份" value={person} onChange={event => { setPerson(event.target.value); setOpen(true); }}>
        <option value="student-a">试点学生 A</option><option value="student-b">试点学生 B</option><option value="viewer">只读访客</option>
      </select></label>{!open && <button onClick={() => setOpen(true)}>打开协作文档</button>}
    </div>
    {open && <CollaborativeDocumentEditor key={person} adapter={adapter} onClose={() => setOpen(false)} />}
    <style>{`.collab-demo .collab-shell{top:36px}body{margin:0;background:#e9edf2}.collab-demo-banner{height:36px;box-sizing:border-box;padding:0 23px;display:flex;align-items:center;gap:18px;font:11px 'Segoe UI','PingFang SC',sans-serif;background:#edf3fc;color:#4a6286;border-bottom:1px solid #dce6f6}.collab-demo-banner strong{font-size:11px;letter-spacing:.02em;color:#2155a3}.collab-demo-banner strong span{font-weight:400;margin-left:8px}.collab-demo-banner label{margin-left:auto;display:flex;align-items:center;gap:7px}.collab-demo-banner select{font:inherit;border:1px solid #d5dfed;background:#fff;border-radius:4px;padding:2px 6px;color:#486184}.collab-demo-banner button{font:inherit;border:0;background:transparent;color:#2155a3;cursor:pointer}@media(max-width:600px){.collab-demo-banner{padding-inline:12px;gap:8px}.collab-demo-note{display:none}}`}</style>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Demo />);
