import React, { lazy, Suspense, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import MobileTabBar, { type MobileTab } from './MobileTabBar';
import MobileNotesList from './MobileNotesList';
import MobileCommunity from './MobileCommunity';
import MobileProfile from './MobileProfile';
import NoteEditorModal from '../NoteEditorModal';
import WorkspaceAgentPanel from '../WorkspaceAgentPanel';
import RemixIcon from '../RemixIcon';
import { useReportHelpContext } from '../help/helpContext';
import { useSpaceData, apiNoteToNote } from '../../hooks/useSpaceData';
import { useAuth } from '../../contexts/AuthContext';
import { courses as coursesApi, notes as notesApi, noteAiFeedback, relations as relationsApi, scaffolds as scaffoldsApi, trackEvent, workspaceAgent as workspaceAgentApi } from '../../services/apiClient';
import type { RelationType, Space } from '../../services/apiClient';
import { apiRelationToEdge } from '../../hooks/useSpaceData';
import { placeNewNote } from '../notePlacement';
import { hotBuildOnCounts } from '../noteBadges';
import type { Note, Scaffold, UserRole, Language } from '../../types';

interface MobileWorkspaceProps {
  userRole: UserRole;
  lang: Language;
  setLang: (lang: Language) => void;
}
const BuildOnNetwork = lazy(() => import('../BuildOnNetwork'));
const SpaceTimeline = lazy(() => import('../SpaceTimeline'));

const MobileWorkspace: React.FC<MobileWorkspaceProps> = ({ userRole, lang, setLang }) => {
  const params = useParams<{ courseId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const courseId = params.courseId;
  const courseTitle = (location.state as any)?.courseTitle || '';

  const [activeTab, setActiveTab] = useState<MobileTab>('notes');
  const [explorerFocus,setExplorerFocus]=useState<string|null>(null);
  const [explorerSpace,setExplorerSpace]=useState<string|null>(null);
  const [explorerMode, setExplorerMode] = useState<'map' | 'timeline' | null>(null);
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [currentSpace, setCurrentSpace] = useState<Space | null>(null);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [wsAgentConfigs, setWsAgentConfigs] = useState<any[]>([]);
  // 手机端也要有支架：不然支架栏是空的，AI 内容进笔记时那条「必须选 GenAI 支架」
  // 也会因为没有候选而静默放行 —— 学生换个设备就绕过了。
  const [scaffolds, setScaffolds] = useState<Scaffold[]>([]);

  useEffect(() => {
    if (!courseId) return;
    scaffoldsApi.list(courseId)
      .then(({ scaffolds: loaded }) => setScaffolds(loaded.map(item => ({
        id: item.id,
        title: item.title,
        titleEn: item.titleEn ?? undefined,
        description: item.description ?? '',
        category: item.category,
        metadata: item.metadata,
        sortOrder: item.sortOrder,
        icon: item.icon,
        color: item.color,
        usageCount: item.usageCount,
        isMandatory: item.isMandatory,
        isRecommended: item.isRecommended,
        steps: item.steps,
      }))))
      .catch(() => setScaffolds([]));
  }, [courseId]);

  // Load space
  useEffect(() => {
    if (!courseId) return;
    coursesApi.listSpaces(courseId)
      .then(({ spaces }) => {
        if (spaces.length > 0) {
          setCurrentSpace(spaces[0]);
          setSpaceId(spaces[0].id);
        }
      })
      .catch(() => {});
  }, [courseId]);

  // Load AI config
  useEffect(() => {
    if (!courseId) return;
    workspaceAgentApi.getConfigs(courseId)
      .then(({ aiConfigs }) => setWsAgentConfigs(aiConfigs))
      .catch(() => {});
  }, [courseId]);

  const { notes, setNotes, edges, setEdges, loading, refetch: refetchSpace } = useSpaceData(spaceId);
  const hotCounts = useMemo(() => hotBuildOnCounts(edges), [edges]);

  /**
   * 手机端的 Build-on：在别人的笔记页右下角选了一种方式。先开一份不落库的草稿，
   * 问 AI（要 note_id）或点「贡献」时才建笔记和连线 —— 关掉不写就什么都不留。
   * 普通新建还是老样子先建一条「新笔记」。
   */
  const [buildOn, setBuildOn] = useState<{ parentId: string; relationType: RelationType } | null>(null);
  const [buildOnNoteId, setBuildOnNoteId] = useState<string | null>(null);
  const buildOnPersistRef = useRef<{ key: string; promise: Promise<string | null> } | null>(null);

  // 「使用帮助」小球要知道学生在哪个标签页、开没开笔记。必须写在下面 loading 的提前返回之前。
  useReportHelpContext({
    courseId: courseId ?? null,
    surface: editingNote ? 'note-editor' : `mobile-${activeTab}`,
    spaceId,
    noteId: editingNote?.id ?? null,
  });

  const handleNoteOpen = useCallback((note: Note) => {
    setEditingNote(note);
    setIsCreatingNew(false);
  }, []);

  const handleCreateNote = useCallback(async () => {
    if (!spaceId) return;
    try {
      const defaultTitle = lang === 'zh' ? '新笔记' : 'New Note';
      const res = await notesApi.create(spaceId, { title: defaultTitle, content: '', type: 'note' });
      const newNote = apiNoteToNote(res.note);
      setNotes(prev => [...prev, newNote]);
      setEditingNote(newNote);
      setIsCreatingNew(true);
    } catch {}
  }, [spaceId, lang, setNotes]);

  const handleBuildOn = useCallback((parentId: string, relationType: RelationType) => {
    if (spaceId) {
      trackEvent({
        event_type: 'buildon_initiated',
        object_type: 'note',
        object_id: parentId,
        space_id: spaceId,
        metadata_json: { relation_type: relationType, source: 'note_page_mobile' },
      });
    }
    buildOnPersistRef.current = null;
    setBuildOnNoteId(null);
    setEditingNote(null);
    setIsCreatingNew(true);
    setBuildOn({ parentId, relationType });
  }, [spaceId]);

  /** 把 Build-on 草稿落库：建笔记（摆在原笔记旁边、进原笔记所在的 View）再建连线。同一份草稿只建一次。 */
  const persistBuildOn = useCallback((title: string, content: string): Promise<string | null> => {
    if (!spaceId || !buildOn) return Promise.resolve(null);
    const key = `${buildOn.parentId}:${buildOn.relationType}`;
    if (buildOnPersistRef.current?.key === key) return buildOnPersistRef.current.promise;
    const parent = notes.find(n => n.id === buildOn.parentId);
    const pos = placeNewNote(parent, notes, { x: 0, y: 0, zoom: 1 });
    const promise = (async () => {
      try {
        const { note: created } = await notesApi.create(spaceId, {
          type: 'note',
          title: title.trim() || (lang === 'zh' ? '新笔记' : 'New Note'),
          content,
          x: pos.x,
          y: pos.y,
          inquiry_question: currentSpace?.inquiry_question,
          ...(parent?.views?.length ? { views: parent.views } : {}),
        });
        const realNote = apiNoteToNote(created, user?.name);
        setNotes(prev => prev.some(n => n.id === realNote.id) ? prev : [...prev, realNote]);
        setBuildOnNoteId(created.id);
        const { relation } = await relationsApi.create({
          source_note_id: created.id,
          target_note_id: buildOn.parentId,
          relation_type: buildOn.relationType,
          space_id: spaceId,
        });
        setEdges(prev => prev.some(e => e.id === relation.id) ? prev : [...prev, apiRelationToEdge(relation)]);
        trackEvent({
          event_type: 'buildon_created',
          object_type: 'relation',
          object_id: relation.id,
          space_id: spaceId,
          target_note_id: buildOn.parentId,
          metadata_json: { relation_type: buildOn.relationType, source: 'note_page_mobile' },
        });
        return created.id;
      } catch {
        buildOnPersistRef.current = null;   // 失败了下次再试
        return null;
      }
    })();
    buildOnPersistRef.current = { key, promise };
    return promise;
  }, [spaceId, buildOn, notes, lang, currentSpace?.inquiry_question, user?.name, setNotes, setEdges]);

  const handleNoteClose = useCallback(() => {
    setEditingNote(null);
    setIsCreatingNew(false);
    setBuildOn(null);
    setBuildOnNoteId(null);
    buildOnPersistRef.current = null;
  }, []);

  const handleNoteSave = useCallback(async (title: string, content: string) => {
    if (!spaceId) return;
    const reviewFeedback = async (id: string) => {
      try {
        const result = await noteAiFeedback.finalize(id);
        if (result.outcomes.some(row => row.publishedNoteId)) refetchSpace();
      } catch {
        window.alert(lang === 'zh' ? '笔记已保存，反馈发布判断暂未完成；下次贡献时会重试。' : 'Note saved. Feedback review is pending and will retry on your next contribution.');
      }
    };
    if (buildOn) {
      // 问 AI 时草稿已经落过库（或正在落）：那时的正文是旧的，建好后还要再存一次
      const persistedEarlier = Boolean(buildOnNoteId || buildOnPersistRef.current);
      const id = buildOnNoteId ?? await persistBuildOn(title, content);
      if (!id) return;   // 没建成：编辑器留着，学生可以再点一次「贡献」
      if (persistedEarlier) {
        try {
          await notesApi.update(id, { title, content });
          await reviewFeedback(id);
          setNotes(prev => prev.map(n => n.id === id ? { ...n, title, content } : n));
        } catch {
          window.alert(lang === 'zh' ? '笔记保存失败，请重试。' : 'Note could not be saved. Please try again.');
          return;
        }
      }
      handleNoteClose();
      return;
    }
    if (!editingNote) return;
    try {
      await notesApi.update(editingNote.id, { title, content });
      if (editingNote.authorId === user?.id) await reviewFeedback(editingNote.id);
      setNotes(prev => prev.map(n => n.id === editingNote.id ? { ...n, title, content } : n));
    } catch {
      window.alert(lang === 'zh' ? '笔记保存失败，请重试。' : 'Note could not be saved. Please try again.');
      return;
    }
    setEditingNote(null);
    setIsCreatingNew(false);
  }, [editingNote, spaceId, setNotes, buildOn, buildOnNoteId, persistBuildOn, handleNoteClose, user?.id, refetchSpace, lang]);

  const handleExitCourse = useCallback(() => {
    navigate('/dashboard');
  }, [navigate]);

  const lbl = (zh: string, en: string) => lang === 'zh' ? zh : en;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="flex flex-col items-center gap-3 text-gray-400">
          <div className="w-8 h-8 border-2 border-gray-300 border-t-[#000080] rounded-full animate-spin" />
          <span className="text-sm">{lbl('加载中...', 'Loading...')}</span>
        </div>
      </div>
    );
  }

  const openTimelineNote=async(id:string,targetSpace?:string)=>{
    try {
      const {note}=await notesApi.get(id);
      if(targetSpace&&targetSpace!==spaceId&&courseId){const {spaces}=await coursesApi.listSpaces(courseId);const target=spaces.find(s=>s.id===targetSpace);if(!target)throw new Error('Space unavailable');setCurrentSpace(target);setSpaceId(targetSpace);}
      setExplorerMode(null);setExplorerFocus(null);setExplorerSpace(null);setEditingNote(apiNoteToNote(note,user?.name));
    }catch{window.alert(lang==='zh'?'暂时无法打开这条 Note，请重试。':'Could not open this Note. Please retry.');}
  };

  return (
    <div className="flex flex-col h-[100dvh] bg-gray-50">
      {/* Top header */}
      <header className="shrink-0 bg-white border-b border-gray-100 px-4 h-12 flex items-center justify-between safe-area-top">
        <div className="flex items-center gap-2 min-w-0">
          <button onClick={handleExitCourse} className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg active:bg-gray-100">
            <RemixIcon name="arrow-left-s-line" size={20} className="text-gray-600" />
          </button>
          <h1 className="text-sm font-semibold text-gray-900 truncate">{courseTitle || 'HAKCC'}</h1>
        </div>
        <div className="flex items-center gap-1">
          {activeTab === 'notes' && (
            <button onClick={handleCreateNote} className="w-8 h-8 flex items-center justify-center rounded-lg active:bg-gray-100">
              <RemixIcon name="add-line" size={20} className="text-[#000080]" />
            </button>
          )}
        </div>
      </header>

      {/* Tab content */}
      <main className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'notes' && (
          <MobileNotesList
            notes={notes}
            lang={lang}
            onNoteOpen={handleNoteOpen}
            onCreateNote={handleCreateNote}
            currentUserId={user?.id}
            hotCounts={hotCounts}
          />
        )}
        {activeTab === 'agent' && (
          // 底部标签栏是 fixed 的，不占 main 的高度；其他几个页签都自己留了 pb-20。
          // AI 页没留，输入框和发送按钮整个压在标签栏底下，手机上点不到
          <div className="h-full pb-[calc(3.5rem+env(safe-area-inset-bottom,0px))]">
            <WorkspaceAgentPanel
              isOpen={true}
              onClose={() => setActiveTab('notes')}
              courseId={courseId || ''}
              spaceId={spaceId ?? undefined}
              userRole={userRole}
              lang={lang}
              aiConfigs={wsAgentConfigs}
              spaceNotes={notes.filter(note => note.type !== 'attachment' && note.type !== 'drawing').map(note => ({ id: note.id, title: note.title, author: note.author }))}
              embedded
            />
          </div>
        )}
        {activeTab === 'community' && (
          <MobileCommunity
            lang={lang}
            courseTitle={courseTitle}
            noteCount={notes.length}
            onOpenMap={() => {setExplorerFocus(null);setExplorerSpace(null);setExplorerMode('map');}}
            onOpenTimeline={() => {setExplorerFocus(null);setExplorerSpace(null);setExplorerMode('timeline');}}
            onOpenGroups={() => {}}
            onOpenMembers={() => {}}
          />
        )}
        {activeTab === 'profile' && (
          <MobileProfile
            lang={lang}
            userRole={userRole}
            userName={user?.name}
            userEmail={user?.email}
            courseTitle={courseTitle}
            onLogout={logout}
            onExitCourse={handleExitCourse}
          />
        )}
      </main>

      {/* Note editor (full screen on mobile) */}
      {(editingNote || buildOn) && (
        <NoteEditorModal
          isOpen={true}
          onClose={handleNoteClose}
          onSave={handleNoteSave}
          initialData={editingNote
            ? { title: editingNote.title, content: editingNote.content, author: editingNote.author, date: editingNote.date }
            : undefined}
          isBuildOn={Boolean(buildOn)}
          buildOnMoveType={buildOn?.relationType}
          buildOnParentId={buildOn?.parentId}
          isRiseAbove={editingNote?.type === 'riseabove'}
          riseAboveCitedIds={editingNote?.citedNoteIds ?? []}
          lang={lang}
          availableScaffolds={scaffolds}
          courseId={courseId}
          spaceId={spaceId ?? undefined}
          noteId={editingNote?.id ?? buildOnNoteId ?? undefined}
          allNotes={notes}
          allEdges={edges}
          onPersistDraft={buildOn ? persistBuildOn : undefined}
          onBuildOn={handleBuildOn}
          userRole={userRole}
          userId={user?.id}
        />
      )}

      <MobileTabBar active={activeTab} onChange={setActiveTab} lang={lang} />
      {explorerMode && spaceId && <Suspense fallback={<div className="fixed inset-0 z-[130] grid place-items-center bg-white dark:bg-gray-950">{lang === 'zh' ? '正在打开…' : 'Opening…'}</div>}>
        {explorerMode==='map'?<BuildOnNetwork spaceId={explorerSpace??spaceId} notes={notes} edges={edges} currentUserId={user?.id} lang={lang==='zh'?'zh':'en'} initialNoteId={explorerFocus} onClose={()=>{setExplorerMode(null);setExplorerFocus(null);setExplorerSpace(null);}} onShowTimeline={id=>{setExplorerFocus(id);setExplorerMode('timeline');}} onLocateNote={id=>openTimelineNote(id,explorerSpace??spaceId)}/>:<SpaceTimeline spaceId={spaceId} currentUserId={user?.id} lang={lang==='zh'?'zh':'en'} initialNoteId={explorerFocus} onClose={()=>{setExplorerMode(null);setExplorerFocus(null);}} onShowNetwork={(id,sid)=>{setExplorerSpace(sid??spaceId);setExplorerFocus(id);setExplorerMode('map');}} onLocateNote={openTimelineNote}/>}

      </Suspense>}
    </div>
  );
};

export default MobileWorkspace;
