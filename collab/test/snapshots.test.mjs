import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import * as Y from 'yjs';import jwt from 'jsonwebtoken';import {createCollaborationServer} from '../src/server.mjs';
test('historical preview is scoped to its document, read-only and preserves live content',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'hakcc-snapshot-preview-'));const secret='fictional-test-only-secret-more-than-32';const app=createCollaborationServer({port:0,path:join(folder,'docs.sqlite'),secret,demo:true});
 const doc=new Y.Doc();const paragraph=new Y.XmlElement('paragraph');const text=new Y.XmlText();text.insert(0,'早期证据');paragraph.insert(0,[text]);doc.getXmlFragment('default').insert(0,[paragraph]);
 try {await app.server.listen();app.store.save('demo-document',doc);const snapshot=app.store.snapshot('demo-document');text.insert(text.length,'，之后修订');app.store.save('demo-document',doc);const live=app.store.get('demo-document').hash;
 const token=jwt.sign({},secret,{algorithm:'HS256',issuer:'hakcc-demo',audience:'demo-document',subject:'viewer',expiresIn:'1h'});const base=app.server.webSocketURL.replace('ws:','http:');const headers={Authorization:`Bearer ${token}`};
 const response=await fetch(`${base}/demo/documents/demo-document/snapshots/${snapshot}`,{headers});assert.equal(response.status,200);const data=await response.json();assert.equal(data.id,snapshot);assert.equal(data.content.content[0].content[0].text,'早期证据');assert.equal(app.store.get('demo-document').hash,live);
 app.store.create('other-document','另一文档');const other=app.store.snapshot('other-document');assert.equal((await fetch(`${base}/demo/documents/demo-document/snapshots/${other}`,{headers})).status,404);
 assert.equal((await fetch(`${base}/demo/documents/demo-document/snapshots/${snapshot}`,{method:'POST',headers})).status,403);
 assert.equal((await fetch(`${base}/demo/documents/demo-document/snapshots/0`,{headers})).status,404);
 }finally{doc.destroy();await app.server.destroy();app.store.close();rmSync(folder,{recursive:true,force:true});}
});
