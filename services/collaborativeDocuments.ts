import type {JSONContent} from '@tiptap/core';
import type { Note } from '../types';

export interface CollaborationSession {
  documentId: string;
  title: string;
  websocketUrl: string;
  user: { id: string; name: string; color: string };
  canEdit: boolean;
}
export interface CollaborationSnapshot {id:number;version:number;created_at:string;}
export interface CollaborationSnapshotContent extends CollaborationSnapshot {content:JSONContent;}
export interface CollaborationAdapter {
  session(): Promise<CollaborationSession>;
  token(): Promise<string>;
  export(): Promise<Blob>;
  snapshot(): Promise<void>;
  snapshots?(): Promise<CollaborationSnapshot[]>;
  readSnapshot?(id:number): Promise<CollaborationSnapshotContent>;
}
export function isCollaborativeDocument(note: Pick<Note, 'metadata'>): boolean {
  return (note.metadata?.collaborative_document as { version?: number } | undefined)?.version === 1;
}
