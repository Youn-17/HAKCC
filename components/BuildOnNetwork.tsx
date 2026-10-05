import React from 'react';
import type { Edge, Note } from '../types';
import BuildOnExplorer from './BuildOnExplorer';

interface Props {
  spaceId?: string;
  initialNoteId?: string|null;
  onShowTimeline?: (id:string)=>void;
  notes: Note[];
  edges: Edge[];
  currentUserId?: string;
  lang: 'zh' | 'en';
  onLocateNote?: (noteId: string) => void;
  onClose: () => void;
}

/** Relationship exploration stays independent from the construction timeline. */
const BuildOnNetwork: React.FC<Props> = props => <BuildOnExplorer {...props} />;
export default BuildOnNetwork;
