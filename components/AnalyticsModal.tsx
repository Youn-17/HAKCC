
import React, { useEffect, useState, useMemo } from 'react';
import {
  X, BarChart3, Clock, Users, FileText, Download, Eye, EyeOff,
  Search, Filter, Calendar, ChevronDown, MessageSquare, Cpu, Network,
  Lightbulb, Activity, Quote, BrainCircuit, History, Tag, Layers,
  FileBarChart, MessageCircle, GraduationCap, Layout,
  Link as LinkIcon, Zap, Timer, RefreshCw, ZoomIn, ZoomOut, Move, Play, AlertCircle,
  Award, Hammer, Brain, Mic, Star, Book, Mail, MapPin, ArrowUpRight,
  User, Sparkles, CheckCircle as CheckCircleIcon, Upload, TrendingUp
} from 'lucide-react';
import { AnalyticsData, AnalyticsLogEntry, Language, AnalyticsModuleData, StudentDetailMetrics, CitationNode, StudentProfileData, UserRole, Note, Edge } from '../types';
import { metrics as metricsApi, ai as aiApi, research as researchApi, courseSettings as courseSettingsApi, scaffolds as scaffoldsApi, notes as notesApi, relations as relationsApi, triggers as triggersApi, ExperimentCondition, ResearchSummary, CourseMember, ConditionAssignment, AISummary, ApiScaffold, ApiNote, ApiRelation, AIIntervention } from '../services/apiClient';
import { downloadBlob, downloadCsv } from './dashboard/downloadUtils';
import { notePreviewText } from './noteText';

interface AnalyticsModalProps {
  isOpen: boolean;
  onClose: () => void;
  courseId: string;
  spaceId?: string | null;
  lang: Language;
  userRole?: UserRole;
  userId?: string;
  currentViewId?: string;
  currentViewName?: string;
  notes?: Note[];
  edges?: Edge[];
}

// Sidebar Navigation Items
const MODULES = [
    { id: 'citation', icon: Quote, labelZh: '引用仪表盘', labelEn: 'Citation Dashboard' },
    { id: 'building', icon: FileBarChart, labelZh: '理念建构', labelEn: 'Ideas Building' },
    { id: 'thread', icon: Network, labelZh: '理念线索图', labelEn: 'Idea Thread Mapper' },
    { id: 'design', icon: Lightbulb, labelZh: '设计理念', labelEn: 'Design Idea' },
    { id: 'concepts', icon: Layers, labelZh: '关键概念', labelEn: 'Key Concepts' },
    { id: 'wordcloud', icon: Tag, labelZh: '词云', labelEn: 'Word Cloud' },
];

// --- Chart Helpers (Simple SVG Components) ---

const TimelineChart: React.FC<{ data: {date: string; notes: number; buildons: number; comments: number}[], width?: number, height?: number }> = ({ data, width=600, height=200 }) => {
    if(!data || data.length === 0) return null;
    const maxVal = Math.max(...data.map(d => Math.max(d.notes, d.buildons, d.comments))) + 1;
    const pad = 30;
    const chartW = width - pad*2;
    const chartH = height - pad*2;
    
    const makePath = (key: 'notes' | 'buildons' | 'comments') => {
        return data.map((d, i) => {
            const x = pad + (i / (data.length - 1)) * chartW;
            const y = height - pad - (d[key] / maxVal) * chartH;
            return `${x},${y}`;
        }).join(' ');
    };

    return (
        <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
            <line x1={pad} y1={height-pad} x2={width-pad} y2={height-pad} stroke="#e2e8f0" strokeWidth="1"/>
            <line x1={pad} y1={height-pad} x2={pad} y2={pad} stroke="#e2e8f0" strokeWidth="1"/>
            <polyline fill="none" stroke="#3b82f6" strokeWidth="2" points={makePath('notes')} />
            <polyline fill="none" stroke="#10b981" strokeWidth="2" points={makePath('buildons')} />
            <polyline fill="none" stroke="#f59e0b" strokeWidth="2" points={makePath('comments')} />
            {data.map((d, i) => (
                 <text key={i} x={pad + (i / (data.length - 1)) * chartW} y={height - 10} fontSize="10" textAnchor="middle" fill="#94a3b8">{d.date}</text>
            ))}
        </svg>
    );
};

const RadarChart: React.FC<{ data: {subject: string; A: number; fullMark: number}[], size?: number }> = ({ data, size=200 }) => {
    const count = data.length;
    const radius = size / 2 - 20;
    const center = size / 2;
    const angleSlice = (Math.PI * 2) / count;
    
    const getPoints = (valueKey: 'A' | 'fullMark') => {
        return data.map((d, i) => {
            const r = (d[valueKey as keyof typeof d] as number / 100) * radius;
            const angle = i * angleSlice - Math.PI / 2;
            return `${center + r * Math.cos(angle)},${center + r * Math.sin(angle)}`;
        }).join(' ');
    };

    return (
        <svg width="100%" height="100%" viewBox={`0 0 ${size} ${size}`}>
            {[0.2, 0.4, 0.6, 0.8, 1].map(scale => (
                <polygon key={scale} points={getPoints('fullMark').split(' ').map((p, i) => {
                    const [x, y] = p.split(',').map(Number);
                    return `${center + (x-center)*scale},${center + (y-center)*scale}`;
                }).join(' ')} fill="none" stroke="#e2e8f0" strokeWidth="1" />
            ))}
            <polygon points={getPoints('A')} fill="rgba(59, 130, 246, 0.2)" stroke="#3b82f6" strokeWidth="2" />
            {data.map((d, i) => {
                const angle = i * angleSlice - Math.PI / 2;
                const r = radius + 15;
                const x = center + r * Math.cos(angle);
                const y = center + r * Math.sin(angle);
                return <text key={i} x={x} y={y} fontSize="10" textAnchor="middle" fill="#64748b" dy="0.35em">{d.subject}</text>
            })}
        </svg>
    );
};

// --- Sub Components ---

const StudentProfileModule: React.FC<{
  data: AnalyticsModuleData;
  lang: Language;
  isAnonymous: boolean;
  userRole?: UserRole;
  currentUserId?: string;
}> = ({ data, lang, isAnonymous, userRole = 'student', currentUserId = 's1' }) => {
    // Logic to handle profile selection based on role
    const studentList = data.studentDetails;
    const [selectedStudentId, setSelectedStudentId] = useState<string>(currentUserId);
    const [activeTab, setActiveTab] = useState<'portfolio'|'timeline'>('portfolio');

    // Initialize selection based on role
    useEffect(() => {
        if (userRole === 'student') {
             setSelectedStudentId(currentUserId);
        } else if (userRole === 'teacher' || userRole === 'admin') {
             if (studentList.length > 0) {
                 setSelectedStudentId(studentList[0].studentId);
             }
        }
    }, [userRole, currentUserId, studentList]);

    const selectedDetail = studentList.find(s => s.studentId === selectedStudentId) || studentList[0];
    
    const p = useMemo(() => {
        if (!selectedDetail) return data.studentProfile;
        
        return {
            ...data.studentProfile,
            studentId: selectedDetail.studentId,
            info: {
                ...data.studentProfile.info,
                name: selectedDetail.name,
                id: selectedDetail.studentNumber,
                lastActive: selectedDetail.lastActive,
                avatar: selectedDetail.avatar
            },
            stats: {
                ...data.studentProfile.stats,
                totalNotes: selectedDetail.content.noteCount,
                aiUsage: selectedDetail.ai.sessions,
                totalHours: selectedDetail.time.totalHours,
                activeDays: selectedDetail.time.activeDays
            },
        };
    }, [data.studentProfile, selectedDetail]);

    const getIcon = (name: string) => {
        switch(name) {
            case 'Award': return <Award size={16}/>;
            case 'Hammer': return <Hammer size={16}/>;
            case 'Brain': return <Brain size={16}/>;
            case 'Mic': return <Mic size={16}/>;
            case 'Users': return <Users size={16}/>;
            default: return <Star size={16}/>;
        }
    };

    if (!p) return <div>Loading...</div>;

    return (
        <div className="h-full overflow-y-auto bg-gray-50">
            
            {/* Teacher Control Bar */}
            {(userRole === 'teacher' || userRole === 'admin') && (
                <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-4 sticky top-0 z-20 shadow-sm">
                    <span className="text-xs font-bold text-gray-500 uppercase flex items-center gap-1">
                        <User size={14}/> Viewing Student:
                    </span>
                    <div className="relative w-64">
                        <select 
                            className="w-full pl-3 pr-8 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-gray-50"
                            value={selectedStudentId}
                            onChange={(e) => setSelectedStudentId(e.target.value)}
                        >
                            {studentList.map(s => (
                                <option key={s.studentId} value={s.studentId}>{s.name} ({s.studentNumber})</option>
                            ))}
                        </select>
                        <ChevronDown size={14} className="absolute right-3 top-2.5 text-gray-400 pointer-events-none"/>
                    </div>
                </div>
            )}

            {/* Header Card */}
            <div className="relative bg-white mb-6">
                <div className="h-32 w-full bg-gradient-to-r from-blue-600 to-cyan-500 relative overflow-hidden">
                    <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-20"></div>
                </div>
                <div className="px-8 pb-6 flex flex-col md:flex-row gap-6 relative">
                    <div className="relative -top-10">
                        <div className="w-28 h-28 rounded-xl bg-white p-1 shadow-lg">
                            <div className="w-full h-full bg-gray-100 rounded-lg flex items-center justify-center text-4xl font-bold text-blue-500 overflow-hidden">
                                {p.info.avatar ? <img src={p.info.avatar} alt="avatar" className="w-full h-full object-cover"/> : p.info.name.charAt(0)}
                            </div>
                        </div>
                    </div>
                    
                    <div className="flex-1 pt-2 md:pt-4">
                         <div className="flex justify-between items-start">
                             <div>
                                 <h1 className="text-2xl font-bold text-gray-900">{isAnonymous ? 'Student' : p.info.name}</h1>
                                 <div className="flex flex-wrap gap-4 text-sm text-gray-500 mt-1">
                                     <span className="flex items-center gap-1"><GraduationCap size={14}/> {p.info.major}</span>
                                     <span className="flex items-center gap-1"><Mail size={14}/> {p.info.email}</span>
                                     <span className="flex items-center gap-1"><Calendar size={14}/> Joined {p.info.joinDate}</span>
                                 </div>
                             </div>
                             <div className="flex gap-2">
                                 <button className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold shadow-sm hover:bg-blue-700 flex items-center gap-2">
                                     <Download size={14}/> Export Profile
                                 </button>
                             </div>
                         </div>
                         
                         {/* Badges List */}
                         <div className="flex gap-3 mt-4 overflow-x-auto pb-2">
                             {p.badges.map(badge => (
                                 <div key={badge.id} className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-bold ${badge.level==='gold' ? 'bg-yellow-50 border-yellow-200 text-yellow-700' : badge.level==='silver' ? 'bg-gray-50 border-gray-200 text-gray-700' : 'bg-orange-50 border-orange-200 text-orange-800'}`} title={badge.description}>
                                     {getIcon(badge.icon)}
                                     {badge.name}
                                 </div>
                             ))}
                         </div>
                    </div>
                </div>
            </div>

            <div className="px-6 pb-10 space-y-6">
                {/* Stats Overview */}
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                    {[
                        { label: 'Total Notes', value: p.stats.totalNotes, sub: `Top ${100-p.stats.noteRank}%`, icon: FileText, color: 'blue' },
                        { label: 'Build-on Score', value: p.stats.buildOnScore, sub: 'High Impact', icon: Hammer, color: 'green' },
                        { label: 'Collaboration', value: p.stats.collabScore, sub: 'Very Active', icon: Users, color: 'purple' },
                        { label: 'AI Usage', value: p.stats.aiUsage, sub: 'Sessions', icon: Cpu, color: 'indigo' },
                        { label: 'Total Hours', value: p.stats.totalHours, sub: 'Online', icon: Clock, color: 'orange' },
                        { label: 'Active Days', value: p.stats.activeDays, sub: 'Consistent', icon: Calendar, color: 'teal' },
                    ].map((stat, i) => (
                        <div key={i} className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                            <div className={`w-8 h-8 rounded-lg bg-${stat.color}-50 text-${stat.color}-600 flex items-center justify-center mb-2`}>
                                <stat.icon size={16}/>
                            </div>
                            <div className="text-2xl font-bold text-gray-800">{stat.value}</div>
                            <div className="text-xs text-gray-500">{stat.label}</div>
                            <div className={`text-[0.6875rem] font-medium mt-1 text-${stat.color}-600`}>{stat.sub}</div>
                        </div>
                    ))}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Left Column: Timeline & Portfolio */}
                    <div className="lg:col-span-2 space-y-6">
                        {/* Tabs */}
                        <div className="flex gap-4 border-b border-gray-200">
                            <button 
                                onClick={() => setActiveTab('portfolio')}
                                className={`pb-2 px-2 text-sm font-bold transition-colors ${activeTab==='portfolio' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                                Portfolio & Works
                            </button>
                            <button 
                                onClick={() => setActiveTab('timeline')}
                                className={`pb-2 px-2 text-sm font-bold transition-colors ${activeTab==='timeline' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                                Learning Journey
                            </button>
                        </div>

                        {activeTab === 'portfolio' && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {p.portfolio.map(item => (
                                    <div key={item.id} className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-all group cursor-pointer">
                                        <div className="flex justify-between items-start mb-2">
                                            <div className={`px-2 py-0.5 rounded text-[0.6875rem] font-bold uppercase ${item.type==='discussion' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                                                {item.type}
                                            </div>
                                            <div className="text-gray-400 text-xs">{item.date}</div>
                                        </div>
                                        <h3 className="font-bold text-gray-800 mb-2 line-clamp-1 group-hover:text-blue-600 transition-colors">{item.title}</h3>
                                        <p className="text-xs text-gray-500 line-clamp-2 mb-4">{item.preview}</p>
                                        <div className="flex items-center justify-between text-xs text-gray-400 border-t border-gray-50 pt-3">
                                            <div className="flex gap-3">
                                                <span className="flex items-center gap-1"><Hammer size={12}/> {item.stats.buildons}</span>
                                                <span className="flex items-center gap-1"><Eye size={12}/> {item.stats.reads}</span>
                                            </div>
                                            <ArrowUpRight size={14} className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-600"/>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {activeTab === 'timeline' && (
                            <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                                <div className="relative space-y-8 before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-slate-300 before:to-transparent">
                                    {p.timeline.map((event, i) => (
                                        <div key={event.id} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                                            <div className="flex items-center justify-center w-10 h-10 rounded-full border border-white bg-slate-100 shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10 text-gray-500">
                                                {event.type === 'join' && <MapPin size={16}/>}
                                                {event.type === 'note' && <FileText size={16}/>}
                                                {event.type === 'milestone' && <Award size={16} className="text-yellow-600"/>}
                                                {event.type === 'buildon' && <Hammer size={16}/>}
                                                {event.type === 'ai' && <Cpu size={16} className="text-purple-500"/>}
                                                {event.type === 'feedback' && <MessageCircle size={16} className="text-green-500"/>}
                                            </div>
                                            <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                                                <div className="flex items-center justify-between space-x-2 mb-1">
                                                    <div className="font-bold text-slate-900 text-sm">{event.title}</div>
                                                    <time className="font-mono text-xs text-slate-500">{event.date}</time>
                                                </div>
                                                <div className="text-slate-500 text-xs">{event.description}</div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Right Column: Analysis */}
                    <div className="space-y-6">
                        {/* Learning Style */}
                        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                            <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2"><Brain size={18}/> Learning Style</h3>
                            <div className="h-48 flex justify-center mb-4">
                                <RadarChart data={p.learningStyle.radar} size={180} />
                            </div>
                            <div className="flex flex-wrap gap-2 justify-center">
                                {p.learningStyle.personaTags.map(tag => (
                                    <span key={tag} className="px-2 py-1 bg-blue-50 text-blue-700 text-xs font-bold rounded-full border border-blue-100">
                                        {tag}
                                    </span>
                                ))}
                            </div>
                        </div>

                        {/* Preferences */}
                        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm space-y-4">
                            <div>
                                <div className="flex justify-between text-xs font-bold text-gray-500 mb-1">
                                    <span>Independent</span>
                                    <span>Collaborative</span>
                                </div>
                                <div className="h-2 bg-gray-100 rounded-full overflow-hidden flex">
                                    <div className="bg-blue-400 h-full" style={{width: `${p.learningStyle.creationPreference.independent}%`}}></div>
                                    <div className="bg-purple-500 h-full" style={{width: `${p.learningStyle.creationPreference.collaborative}%`}}></div>
                                </div>
                            </div>
                            <div>
                                <div className="text-xs font-bold text-gray-500 mb-2">Top Topics</div>
                                <div className="flex flex-wrap gap-1">
                                    {p.learningStyle.topTopics.map(topic => (
                                        <span 
                                            key={topic.text} 
                                            className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded hover:bg-gray-200"
                                            style={{ fontSize: `${Math.max(10, 10 + topic.value/20)}px` }}
                                        >
                                            {topic.text}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

const StudentDashboard: React.FC<{ 
  data: AnalyticsModuleData; 
  lang: Language; 
  isAnonymous: boolean; 
}> = ({ data, lang, isAnonymous }) => {
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [studentSearch, setStudentSearch] = useState('');
  const [studentFilter, setStudentFilter] = useState<'all' | 'active' | 'moderate' | 'inactive'>('all');
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  useEffect(() => {
     if (!selectedStudentId && data.studentDetails.length > 0) {
         setSelectedStudentId(data.studentDetails[0].studentId);
     }
  }, [data, selectedStudentId]);

  const formatName = (name: string) => isAnonymous ? `Student ${name.charCodeAt(0)%100}` : name;
  
  const allStudents = data.studentDetails;
  const filteredStudents = allStudents.filter(s => {
      if (studentFilter !== 'all' && s.status !== studentFilter) return false;
      if (studentSearch && !s.name.toLowerCase().includes(studentSearch.toLowerCase())) return false;
      return true;
  });
  
  const selectedStudent = allStudents.find(s => s.studentId === selectedStudentId) || allStudents[0];

  const handleGenerateReport = async () => {
      if (!selectedStudent) return;
      setIsAnalyzing(true);
      // AI analysis via backend — student_dash module now uses real data, this is legacy
      setAiAnalysis(lang === 'zh'
        ? '请使用活动仪表板中的 AI 分析功能获取实时数据分析。'
        : 'Use the AI Analysis button in the Activity Dashboard for real-time insights.');
      setIsAnalyzing(false);
  };

  if (!selectedStudent) return <div>No student data</div>;

  return (
      <div className="flex h-full">
          {/* LEFT: Student List (30%) */}
          <div className="w-[30%] border-r border-gray-200 flex flex-col bg-white">
             <div className="p-4 border-b border-gray-100 space-y-3">
                <div className="relative">
                    <Search size={14} className="absolute left-2.5 top-2.5 text-gray-400"/>
                    <input 
                       type="text" 
                       placeholder={lang === 'zh' ? "搜索学生..." : "Search student..."}
                       value={studentSearch}
                       onChange={e => setStudentSearch(e.target.value)}
                       className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50"
                    />
                </div>
                <div className="flex gap-2">
                    <select 
                       className="flex-1 text-xs border border-gray-200 rounded-lg p-1.5 bg-gray-50"
                       value={studentFilter}
                       onChange={(e) => setStudentFilter(e.target.value as any)}
                    >
                        <option value="all">All Status</option>
                        <option value="active">Active</option>
                        <option value="moderate">Moderate</option>
                        <option value="inactive">Inactive</option>
                    </select>
                    <button className="p-1.5 border border-gray-200 rounded-lg bg-gray-50 hover:bg-gray-100" title="Sort">
                        <Filter size={14} className="text-gray-500"/>
                    </button>
                </div>
             </div>
             <div className="flex-1 overflow-y-auto custom-scrollbar">
                {filteredStudents.map(s => (
                    <div 
                       key={s.studentId}
                       onClick={() => { setSelectedStudentId(s.studentId); setAiAnalysis(null); }}
                       className={`p-3 border-b border-gray-50 cursor-pointer flex items-center gap-3 hover:bg-blue-50 transition-colors ${selectedStudentId === s.studentId ? 'bg-blue-50 border-l-4 border-l-blue-500' : ''}`}
                    >
                       <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-indigo-400 flex-shrink-0 flex items-center justify-center text-white font-bold text-sm overflow-hidden">
                           {s.avatar ? <img src={s.avatar} alt="av" className="w-full h-full object-cover"/> : s.name.charAt(0)}
                       </div>
                       <div className="flex-1 min-w-0">
                           <div className="flex justify-between items-start">
                              <div className="font-bold text-sm text-gray-800 truncate">{formatName(s.name)}</div>
                              <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${s.status === 'active' ? 'bg-green-500' : s.status === 'moderate' ? 'bg-yellow-500' : 'bg-gray-400'}`}></div>
                           </div>
                           <div className="text-xs text-gray-500 flex gap-2 mt-0.5">
                              <span className="flex items-center gap-1"><FileText size={10}/> {s.content.noteCount}</span>
                              <span className="flex items-center gap-1"><LinkIcon size={10}/> {s.kb.buildOnGiven}</span>
                           </div>
                       </div>
                    </div>
                ))}
             </div>
          </div>

          {/* RIGHT: Detailed Metrics (70%) */}
          <div className="flex-1 bg-gray-50 overflow-y-auto p-6">
              {/* Header Profile */}
              <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-200 mb-6 flex justify-between items-center">
                  <div className="flex items-center gap-4">
                     <div className="w-16 h-16 rounded-full bg-gradient-to-tr from-blue-600 to-purple-600 flex items-center justify-center text-white text-2xl font-bold shadow-lg overflow-hidden">
                        {selectedStudent.avatar ? <img src={selectedStudent.avatar} alt="av" className="w-full h-full object-cover"/> : selectedStudent.name.charAt(0)}
                     </div>
                     <div>
                        <h2 className="text-xl font-bold text-gray-900">{formatName(selectedStudent.name)}</h2>
                        <div className="flex items-center gap-3 text-sm text-gray-500 mt-1">
                            <span className="bg-gray-100 px-2 py-0.5 rounded text-xs">ID: {selectedStudent.studentNumber}</span>
                            <span className="flex items-center gap-1"><Clock size={12}/> Active: {selectedStudent.lastActive}</span>
                        </div>
                     </div>
                  </div>
                  <div className="flex gap-3">
                     <button 
                        onClick={handleGenerateReport}
                        disabled={isAnalyzing}
                        className="flex items-center gap-2 px-4 py-2 bg-purple-50 text-purple-700 border border-purple-100 rounded-lg text-sm font-bold hover:bg-purple-100 shadow-sm transition-colors"
                     >
                        {isAnalyzing ? <RefreshCw size={14} className="animate-spin"/> : <Sparkles size={14}/>} 
                        {lang === 'zh' ? 'AI 分析报告' : 'AI Report'}
                     </button>
                     <button className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700 shadow-md">
                        <Download size={14}/> Export Report
                     </button>
                  </div>
              </div>

              {/* AI Analysis Result */}
              {aiAnalysis && (
                  <div className="mb-6 bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-100 rounded-xl p-5 shadow-sm animate-in slide-in-from-top-4">
                      <h3 className="text-sm font-bold text-purple-800 mb-2 flex items-center gap-2">
                          <Sparkles size={16}/> AI Insight
                      </h3>
                      <div className="text-sm text-gray-700 whitespace-pre-line leading-relaxed">
                          {aiAnalysis}
                      </div>
                  </div>
              )}

              {/* Key Metrics Grid */}
              <div className="grid grid-cols-3 gap-4 mb-6">
                  {/* Card 1: Content */}
                  <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
                      <div className="flex items-center gap-2 mb-3 text-blue-600 font-bold text-sm uppercase tracking-wide">
                         <FileText size={16}/> Content Creation
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                         <div>
                            <div className="text-2xl font-bold text-gray-800">{selectedStudent.content.noteCount}</div>
                            <div className="text-xs text-gray-500">Notes Created</div>
                         </div>
                         <div>
                            <div className="text-2xl font-bold text-gray-800">{(selectedStudent.content.totalWords / 1000).toFixed(1)}k</div>
                            <div className="text-xs text-gray-500">Total Words</div>
                         </div>
                      </div>
                  </div>
                  {/* Card 2: KB */}
                  <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
                      <div className="flex items-center gap-2 mb-3 text-green-600 font-bold text-sm uppercase tracking-wide">
                         <LinkIcon size={16}/> Knowledge Building
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                         <div>
                            <div className="text-xl font-bold text-gray-800">{selectedStudent.kb.buildOnGiven}</div>
                            <div className="text-[0.6875rem] text-gray-500">Build-ons</div>
                         </div>
                         <div>
                            <div className="text-xl font-bold text-gray-800">{selectedStudent.kb.buildOnReceived}</div>
                            <div className="text-[0.6875rem] text-gray-500">Received</div>
                         </div>
                         <div>
                            <div className="text-xl font-bold text-gray-800">{selectedStudent.kb.depth}</div>
                            <div className="text-[0.6875rem] text-gray-500">Max Depth</div>
                         </div>
                      </div>
                  </div>
                  {/* Card 3: Engagement */}
                  <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
                       <div className="flex items-center gap-2 mb-3 text-purple-600 font-bold text-sm uppercase tracking-wide">
                         <Zap size={16}/> Engagement Score
                      </div>
                      <div className="flex items-end justify-between">
                          <div>
                             <div className="text-3xl font-bold text-gray-800">{selectedStudent.score.value}</div>
                             <div className="text-xs font-bold text-green-600 px-2 py-0.5 bg-green-50 rounded-full inline-block mt-1">{selectedStudent.score.level}</div>
                          </div>
                          <div className="h-10 w-20 bg-gray-100 rounded overflow-hidden relative">
                              <div className="absolute bottom-0 left-0 w-full bg-purple-500 transition-all" style={{ height: `${selectedStudent.score.value}%` }}></div>
                          </div>
                      </div>
                  </div>
                  {/* Card 4: AI */}
                  <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
                       <div className="flex items-center gap-2 mb-3 text-indigo-600 font-bold text-sm uppercase tracking-wide">
                         <Cpu size={16}/> AI Usage
                      </div>
                      <div className="flex justify-between items-center">
                          <div>
                             <div className="text-xl font-bold text-gray-800">{selectedStudent.ai.sessions} <span className="text-xs font-normal text-gray-400">sess</span></div>
                             <div className="text-xs text-gray-500">{selectedStudent.ai.messages} msgs</div>
                          </div>
                          <div className="text-right">
                             <div className="text-xs text-gray-400 uppercase font-bold">Top Tool</div>
                             <div className="font-bold text-indigo-700">{selectedStudent.ai.topProvider}</div>
                          </div>
                      </div>
                  </div>
                  {/* Card 5: Collab */}
                  <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
                       <div className="flex items-center gap-2 mb-3 text-orange-600 font-bold text-sm uppercase tracking-wide">
                         <MessageCircle size={16}/> Collaboration
                      </div>
                      <div className="flex justify-between text-sm">
                          <div className="text-center">
                             <div className="font-bold">{selectedStudent.collab.readCount}</div>
                             <div className="text-[0.6875rem] text-gray-500">Reads</div>
                          </div>
                          <div className="text-center">
                             <div className="font-bold">{selectedStudent.collab.commentsGiven}</div>
                             <div className="text-[0.6875rem] text-gray-500">Comments</div>
                          </div>
                          <div className="text-center">
                             <div className="font-bold">{selectedStudent.collab.feedbackReceived}</div>
                             <div className="text-[0.6875rem] text-gray-500">Feedback</div>
                          </div>
                      </div>
                  </div>
                  {/* Card 6: Time */}
                  <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
                       <div className="flex items-center gap-2 mb-3 text-teal-600 font-bold text-sm uppercase tracking-wide">
                         <Timer size={16}/> Time Invested
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                          <div>
                             <div className="text-xl font-bold text-gray-800">{selectedStudent.time.totalHours}h</div>
                             <div className="text-[0.6875rem] text-gray-500">Total Online</div>
                          </div>
                          <div>
                             <div className="text-xl font-bold text-gray-800">{selectedStudent.time.activeDays}</div>
                             <div className="text-[0.6875rem] text-gray-500">Active Days</div>
                          </div>
                      </div>
                  </div>
              </div>

              {/* Charts Section */}
              <div className="space-y-6">
                  {/* Timeline */}
                  <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                      <h3 className="font-bold text-gray-700 mb-4 flex items-center gap-2"><Activity size={18}/> Activity Timeline (Last 7 Days)</h3>
                      <div className="h-48 w-full">
                         <TimelineChart data={selectedStudent.timelineData} />
                      </div>
                      <div className="flex justify-center gap-6 mt-4">
                         <div className="flex items-center gap-2 text-xs font-bold text-gray-600"><span className="w-3 h-1 bg-blue-500 rounded-full"></span> Notes</div>
                         <div className="flex items-center gap-2 text-xs font-bold text-gray-600"><span className="w-3 h-1 bg-green-500 rounded-full"></span> Build-ons</div>
                         <div className="flex items-center gap-2 text-xs font-bold text-gray-600"><span className="w-3 h-1 bg-orange-400 rounded-full"></span> Comments</div>
                      </div>
                  </div>

                  <div className="grid grid-cols-2 gap-6">
                      {/* Radar */}
                      <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                          <h3 className="font-bold text-gray-700 mb-4 flex items-center gap-2"><Users size={18}/> Learning Style</h3>
                          <div className="h-64 flex items-center justify-center">
                              <RadarChart data={selectedStudent.radarData} size={240} />
                          </div>
                      </div>

                      {/* Heatmap */}
                      <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                          <h3 className="font-bold text-gray-700 mb-4 flex items-center gap-2"><Calendar size={18}/> Activity Heatmap</h3>
                          <div className="grid grid-cols-7 gap-2">
                             {selectedStudent.heatmapData.map((d, i) => (
                                 <div key={i} className="aspect-square rounded relative group" style={{ backgroundColor: `rgba(59, 130, 246, ${0.1 + (d.count / 10)})` }}>
                                    <div className="opacity-0 group-hover:opacity-100 absolute bottom-full left-1/2 -translate-x-1/2 bg-black text-white text-xs p-1 rounded mb-1 pointer-events-none whitespace-nowrap z-10">
                                        {d.date}: {d.count}
                                    </div>
                                 </div>
                             ))}
                          </div>
                          <div className="mt-6">
                              <h4 className="font-bold text-gray-600 text-sm mb-2">Note Type Distribution</h4>
                              <div className="space-y-2">
                                  {selectedStudent.noteTypeDist.map(t => (
                                      <div key={t.type} className="flex items-center gap-2 text-xs">
                                          <span className="w-20 font-medium text-gray-500">{t.type}</span>
                                          <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                                              <div className="h-full bg-blue-500" style={{ width: `${(t.value / 15) * 100}%` }}></div>
                                          </div>
                                          <span className="text-gray-700 font-bold">{t.value}</span>
                                      </div>
                                  ))}
                              </div>
                          </div>
                      </div>
                  </div>
              </div>
          </div>
      </div>
  );
};

const GenAIHistoryModule: React.FC<{ 
  data: AnalyticsModuleData; 
  lang: Language; 
  isAnonymous: boolean;
}> = ({ data, lang, isAnonymous }) => {
  const [genAiDimension, setGenAiDimension] = useState<'user'|'note'|'time'|'provider'>('user');
  const [selectedLog, setSelectedLog] = useState<AnalyticsLogEntry | null>(null);

  const formatName = (name: string) => isAnonymous ? `Student ${name.charCodeAt(0)%100}` : name;
  const logs = data.genAiHistory;


  return (
      <div className="h-full flex flex-col">
        {/* Dimension Tabs */}
        <div className="flex gap-2 mb-4 border-b border-gray-200 pb-1 items-center justify-between">
           <div className="flex gap-2">
             {['user', 'note', 'time', 'provider'].map(d => (
                <button 
                  key={d}
                  onClick={() => setGenAiDimension(d as any)}
                  className={`px-4 py-2 text-sm font-bold rounded-t-lg transition-colors capitalize ${genAiDimension === d ? 'bg-blue-50 text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:bg-gray-50'}`}
                >
                  {lang === 'zh' ? (d === 'user' ? '用户' : d === 'note' ? '笔记' : d === 'time' ? '时间' : 'AI提供商') : d}
                </button>
             ))}
           </div>
        </div>

        {/* Detailed View based on Dimension */}
        <div className="flex-1 overflow-auto">
           {genAiDimension === 'user' && (
             <table className="w-full text-left text-sm">
               <thead className="bg-gray-50 sticky top-0">
                 <tr>
                   <th className="p-3 font-semibold text-gray-600">Student</th>
                   <th className="p-3 font-semibold text-gray-600">Total Sessions</th>
                   <th className="p-3 font-semibold text-gray-600">Messages</th>
                   <th className="p-3 font-semibold text-gray-600">Last Active</th>
                   <th className="p-3 text-right">Action</th>
                 </tr>
               </thead>
               <tbody className="divide-y">
                 {data.studentMetrics.map((s, i) => (
                   <tr key={i} className="hover:bg-blue-50/30 group">
                     <td className="p-3 font-medium">{formatName(s.name)}</td>
                     <td className="p-3">{s.aiConversations}</td>
                     <td className="p-3">{logs.filter(l => l.studentName === s.name).reduce((a,b)=>a+b.messageCount,0)}</td>
                     <td className="p-3 text-gray-500">{logs.find(l => l.studentName === s.name)?.timestamp.split(' ')[0] || '-'}</td>
                     <td className="p-3 text-right flex justify-end gap-2">
                        <button className="text-blue-600 hover:underline text-xs font-bold">View Chats</button>
                     </td>
                   </tr>
                 ))}
               </tbody>
             </table>
           )}

           {genAiDimension === 'provider' && (
             <div className="space-y-6">
                <div className="h-64 flex items-end gap-4 px-4 border-b border-gray-200 pb-4">
                   {['OpenAI', 'Anthropic', 'Google', 'Baidu', 'Others'].map((p, i) => {
                      const count = logs.filter(l => l.provider.toLowerCase().includes(p.toLowerCase()) || (p==='Others' && !['openai','anthropic','google','baidu'].some(k=>l.provider.includes(k)))).length;
                      const height = Math.max(10, (count / logs.length) * 200);
                      return (
                        <div key={p} className="flex-1 flex flex-col justify-end group">
                           <div className="bg-purple-500 rounded-t-md w-full hover:bg-purple-600 transition-all relative" style={{ height: `${height}px` }}>
                              <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-xs font-bold text-gray-600">{count}</div>
                           </div>
                           <div className="text-center text-xs mt-2 font-medium text-gray-600">{p}</div>
                        </div>
                      )
                   })}
                </div>
                <div className="grid grid-cols-2 gap-4">
                   {logs.slice(0, 5).map(log => (
                      <div key={log.id} onClick={() => setSelectedLog(log)} className="p-3 border rounded-lg hover:shadow-md cursor-pointer transition-all bg-white">
                         <div className="flex justify-between mb-1">
                            <span className="font-bold text-xs text-purple-600">{log.provider}</span>
                            <span className="text-xs text-gray-400">{log.timestamp}</span>
                         </div>
                         <div className="text-sm font-medium truncate">{log.noteTitle}</div>
                         <div className="text-xs text-gray-500 mt-1">{formatName(log.studentName)} • {log.messageCount} msgs</div>
                      </div>
                   ))}
                </div>
             </div>
           )}

           {(genAiDimension === 'note' || genAiDimension === 'time') && (
             <div className="p-4 text-center text-gray-500 italic">
               Advanced {genAiDimension} visualization would appear here.
             </div>
           )}
        </div>
        
        {/* Log Detail Modal */}
        {selectedLog && (
         <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] flex items-center justify-center z-[110] p-4">
            <div className="bg-white rounded-xl shadow-2xl w-[600px] max-h-[80vh] flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 duration-200">
               <div className="p-4 border-b border-gray-200 bg-gray-50 flex justify-between items-center">
                  <div>
                     <h3 className="font-bold text-gray-800">Conversation Detail</h3>
                     <div className="flex items-center gap-2 text-xs text-gray-500 mt-1">
                        <span className="bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-medium">{selectedLog.provider}</span>
                        <span>{selectedLog.timestamp}</span>
                     </div>
                  </div>
                  <button onClick={() => setSelectedLog(null)}><X size={20} className="text-gray-400 hover:text-red-500 transition-colors"/></button>
               </div>
               <div className="p-6 overflow-y-auto space-y-6 bg-white">
                   <div className="space-y-4">
                      <div className="flex gap-3 flex-row-reverse">
                         <div className="w-8 h-8 bg-blue-100 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold text-blue-600">S</div>
                         <div className="bg-blue-600 text-white px-4 py-2.5 rounded-2xl rounded-tr-none text-sm max-w-[85%] shadow-md">
                            I'm trying to understand how {selectedLog.topics[0]} applies to this note. Can you explain?
                         </div>
                      </div>
                      <div className="flex gap-3">
                         <div className="w-8 h-8 bg-purple-100 rounded-full flex-shrink-0 flex items-center justify-center text-lg">✨</div>
                         <div className="bg-gray-100 text-gray-800 px-4 py-2.5 rounded-2xl rounded-tl-none text-sm max-w-[85%] border border-gray-200">
                            <p className="mb-2">That's a great question. <strong>{selectedLog.topics[0]}</strong> is key here because:</p>
                            <ul className="list-disc pl-4 space-y-1">
                               <li>It connects the theoretical framework to your observation.</li>
                               <li>It suggests a mechanism for the phenomenon you described.</li>
                            </ul>
                            <p className="mt-2">Would you like to explore related concepts?</p>
                         </div>
                      </div>
                   </div>
               </div>
               <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-end">
                  <button onClick={() => setSelectedLog(null)} className="px-4 py-2 text-sm font-bold text-gray-600 hover:bg-gray-200 rounded transition-colors">Close</button>
               </div>
            </div>
         </div>
      )}
      </div>
  );
}

const CitationDashboard: React.FC<{
  data: AnalyticsModuleData; 
  lang: Language; 
  isAnonymous: boolean;
}> = ({ data, lang, isAnonymous }) => {
  const [citationTime, setCitationTime] = useState(100);
  const [selectedNode, setSelectedNode] = useState<CitationNode | null>(null);
  const [networkZoom, setNetworkZoom] = useState(1);
  const [networkPan, setNetworkPan] = useState({x: 0, y: 0});
  const [citationColorMode, setCitationColorMode] = useState<'author'|'cluster'|'time'|'type'>('cluster');
  
  const { nodes, links, metrics } = data.citationNetwork;
  
  const formatName = (name: string) => isAnonymous ? `Student ${name.charCodeAt(0)%100}` : name;

  // Filter nodes by time
  const visibleNodes = useMemo(() => {
      const count = Math.floor((citationTime / 100) * nodes.length);
      return nodes.slice(0, Math.max(5, count));
  }, [citationTime, nodes]);

  const visibleLinks = useMemo(() => {
      const nodeIds = new Set(visibleNodes.map(n => n.id));
      return links.filter(l => nodeIds.has(l.source) && nodeIds.has(l.target));
  }, [visibleNodes, links]);

  // Helper for node color
  const getNodeColor = (n: CitationNode) => {
      if (citationColorMode === 'cluster') return ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#f43f5e'][n.group % 5];
      if (citationColorMode === 'type') {
          if (n.type === 'question') return '#ef4444';
          if (n.type === 'theory') return '#8b5cf6';
          return '#64748b';
      }
      return '#3b82f6';
  };
  

  return (
        <div className="flex h-full bg-gray-50 overflow-hidden">
            {/* LEFT: Graph Area */}
            <div className="flex-1 relative flex flex-col h-full">
                {/* Toolbar */}
                <div className="absolute top-4 left-4 z-10 flex flex-col gap-2">
                    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-1 flex gap-1">
                        <button onClick={() => setNetworkZoom(z => Math.min(z+0.1, 2))} className="p-1.5 hover:bg-gray-100 rounded"><ZoomIn size={16} className="text-gray-600"/></button>
                        <button onClick={() => setNetworkZoom(z => Math.max(z-0.1, 0.5))} className="p-1.5 hover:bg-gray-100 rounded"><ZoomOut size={16} className="text-gray-600"/></button>
                        <button onClick={() => setNetworkPan({x:0, y:0})} className="p-1.5 hover:bg-gray-100 rounded"><Move size={16} className="text-gray-600"/></button>
                    </div>
                    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-2 text-xs">
                        <div className="font-bold text-gray-500 mb-1">Color By</div>
                        <select 
                           value={citationColorMode} 
                           onChange={(e) => setCitationColorMode(e.target.value as any)}
                           className="w-full border rounded p-1"
                        >
                            <option value="cluster">Community</option>
                            <option value="author">Author</option>
                            <option value="type">Note Type</option>
                        </select>
                    </div>
                </div>

                {/* Canvas */}
                <div className="flex-1 overflow-hidden cursor-grab active:cursor-grabbing bg-slate-50">
                    <svg className="w-full h-full" viewBox="0 0 800 600">
                        <g transform={`translate(${networkPan.x}, ${networkPan.y}) scale(${networkZoom})`}>
                           {/* Links */}
                           {visibleLinks.map((l, i) => {
                               const s = visibleNodes.find(n => n.id === l.source)!;
                               const t = visibleNodes.find(n => n.id === l.target)!;
                               if (!s || !t) return null;
                               return (
                                   <line 
                                      key={i} 
                                      x1={s.x} y1={s.y} x2={t.x} y2={t.y} 
                                      stroke="#cbd5e1" 
                                      strokeWidth={1.5}
                                      markerEnd="url(#arrow)"
                                   />
                               );
                           })}
                           
                           {/* Nodes */}
                           {visibleNodes.map((n, i) => (
                               <g key={n.id} onClick={() => setSelectedNode(n)} className="cursor-pointer hover:opacity-80 transition-opacity">
                                   <circle 
                                      cx={n.x} cy={n.y} 
                                      r={4 + n.val * 2} 
                                      fill={getNodeColor(n)} 
                                      stroke={selectedNode?.id === n.id ? '#000' : 'white'}
                                      strokeWidth={selectedNode?.id === n.id ? 2 : 1}
                                   />
                                   {n.val > 2 && (
                                       <text x={n.x} y={n.y} dy={-10} textAnchor="middle" fontSize="8" fill="#475569" pointerEvents="none">
                                           {n.label.substring(0, 10)}...
                                       </text>
                                   )}
                               </g>
                           ))}
                        </g>
                        <defs>
                            <marker id="arrow" markerWidth="10" markerHeight="10" refX="15" refY="3" orient="auto" markerUnits="strokeWidth">
                                <path d="M0,0 L0,6 L9,3 z" fill="#cbd5e1" />
                            </marker>
                        </defs>
                    </svg>
                </div>

                {/* Time Machine Control */}
                <div className="h-16 bg-white border-t border-gray-200 flex items-center px-6 gap-4 shadow-sm z-10">
                    <button 
                        className="w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center hover:bg-blue-700 shadow-sm"
                        onClick={() => setCitationTime(t => t >= 100 ? 0 : t + 10)} // Mock Play
                    >
                        {citationTime >= 100 ? <RefreshCw size={18}/> : <Play size={18} fill="currentColor"/>}
                    </button>
                    <div className="flex-1 flex flex-col gap-1">
                        <div className="flex justify-between text-xs font-bold text-gray-500 uppercase">
                            <span>Course Start</span>
                            <span>Current State ({Math.round(citationTime)}%)</span>
                        </div>
                        <input 
                            type="range" 
                            min="0" max="100" 
                            value={citationTime}
                            onChange={(e) => setCitationTime(parseInt(e.target.value))}
                            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                        />
                    </div>
                </div>
            </div>

            {/* RIGHT: Metrics & Details Panel */}
            <div className="w-80 bg-white border-l border-gray-200 flex flex-col shadow-xl z-20">
                <div className="p-4 border-b border-gray-200 bg-gray-50">
                    <h3 className="font-bold text-gray-800 flex items-center gap-2"><Quote size={18} className="text-blue-500"/> Citation Analysis</h3>
                </div>
                
                <div className="flex-1 overflow-y-auto p-4 space-y-6">
                    {/* Selected Node Detail */}
                    {selectedNode ? (
                        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 animate-in slide-in-from-right-4">
                            <div className="flex justify-between items-start mb-2">
                                <div className="font-bold text-sm text-blue-900 line-clamp-2">{selectedNode.label}</div>
                                <button onClick={() => setSelectedNode(null)}><X size={14} className="text-blue-400 hover:text-blue-700"/></button>
                            </div>
                            <div className="text-xs text-blue-700 space-y-1 mb-3">
                                <div>Author: <span className="font-bold">{formatName(selectedNode.author)}</span></div>
                                <div>Type: <span className="uppercase text-[0.6875rem] bg-white px-1 rounded border border-blue-100">{selectedNode.type}</span></div>
                                <div>Citations: {selectedNode.val}</div>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-center">
                                <div className="bg-white p-2 rounded border border-blue-100">
                                    <div className="text-lg font-bold text-blue-600">{selectedNode.degreeCentrality.toFixed(2)}</div>
                                    <div className="text-[0.6875rem] text-gray-400 uppercase">Degree</div>
                                </div>
                                <div className="bg-white p-2 rounded border border-blue-100">
                                    <div className="text-lg font-bold text-blue-600">{links.filter(l => l.source === selectedNode.id).length}</div>
                                    <div className="text-[0.6875rem] text-gray-400 uppercase">Out Links</div>
                                </div>
                            </div>
                            <button className="w-full mt-3 py-1.5 bg-blue-600 text-white text-xs font-bold rounded hover:bg-blue-700 flex items-center justify-center gap-2">
                                <Layout size={12}/> Create Focus View
                            </button>
                        </div>
                    ) : (
                        <div className="text-center py-8 text-gray-400 text-sm italic border-2 border-dashed border-gray-100 rounded-xl">
                            Select a node to view details
                        </div>
                    )}

                    {/* Global Metrics */}
                    <div>
                        <h4 className="text-xs font-bold text-gray-500 uppercase mb-3 flex items-center gap-2"><Activity size={14}/> Network Health</h4>
                        <div className="grid grid-cols-2 gap-3">
                             <div className="bg-white p-3 rounded-lg border border-gray-100 shadow-sm">
                                 <div className="text-2xl font-bold text-gray-800">{metrics.density.toFixed(2)}</div>
                                 <div className="text-[0.6875rem] text-gray-400 font-bold uppercase">Density</div>
                             </div>
                             <div className="bg-white p-3 rounded-lg border border-gray-100 shadow-sm">
                                 <div className="text-2xl font-bold text-gray-800">{metrics.avgClusteringCoefficient}</div>
                                 <div className="text-[0.6875rem] text-gray-400 font-bold uppercase">Clustering</div>
                             </div>
                             <div className="bg-white p-3 rounded-lg border border-gray-100 shadow-sm">
                                 <div className="text-2xl font-bold text-gray-800">{metrics.diameter}</div>
                                 <div className="text-[0.6875rem] text-gray-400 font-bold uppercase">Diameter</div>
                             </div>
                             <div className="bg-white p-3 rounded-lg border border-gray-100 shadow-sm">
                                 <div className="text-2xl font-bold text-gray-800">{metrics.connectedComponents}</div>
                                 <div className="text-[0.6875rem] text-gray-400 font-bold uppercase">Components</div>
                             </div>
                        </div>
                    </div>

                    {/* Insights / Actions */}
                    <div>
                         <h4 className="text-xs font-bold text-gray-500 uppercase mb-3 flex items-center gap-2"><Lightbulb size={14}/> Insights</h4>
                         <div className="space-y-2">
                            <div className="bg-yellow-50 border border-yellow-100 p-3 rounded-lg text-xs text-yellow-800 flex gap-2">
                                <AlertCircle size={16} className="flex-shrink-0 text-yellow-600"/>
                                <div>
                                    <span className="font-bold">Isolated Cluster detected.</span> 
                                    Group 3 is disconnected from the main discussion.
                                </div>
                            </div>
                         </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ── Research Tab Component ─────────────────────────────────────
const ResearchTab: React.FC<{ spaceId?: string; courseId?: string; lang: Language; userRole?: UserRole }> = ({ spaceId, courseId, lang, userRole }) => {
  const [conditions, setConditions] = useState<ExperimentCondition[]>([]);
  const [summary, setSummary] = useState<ResearchSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [newAiEnabled, setNewAiEnabled] = useState(true);
  const [newWozEnabled, setNewWozEnabled] = useState(false);
  const [exportFrom, setExportFrom] = useState('');
  const [exportTo, setExportTo] = useState('');
  const [exporting, setExporting] = useState(false);
  // Student assignment
  const [expandedConditionId, setExpandedConditionId] = useState<string | null>(null);
  const [courseMembers, setCourseMembers] = useState<CourseMember[]>([]);
  const [assignmentsMap, setAssignmentsMap] = useState<Record<string, ConditionAssignment[]>>({});
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [assigningLoading, setAssigningLoading] = useState(false);

  const t = lang === 'zh' ? {
    title: '实验条件管理',
    name: '条件名称',
    aiEnabled: 'AI 启用',
    wozEnabled: 'WoZ 模式',
    students: '学生数',
    actions: '操作',
    create: '创建条件',
    delete: '删除',
    summary: '实验概览',
    conditions: '条件数',
    interventions: '总干预',
    accepted: '已接受',
    dismissed: '已忽略',
    pending: '待处理',
    events: '总事件',
    export: '数据导出',
    exportEvents: '导出事件 (CSV)',
    exportNetwork: '导出网络 (GEXF)',
    exportInterventions: '导出干预 (CSV)',
    dateFrom: '开始日期',
    dateTo: '结束日期',
    noSpace: '请先进入一个课程空间',
    assign: '分配学生',
    unassign: '移除',
    assignDone: '确认分配',
    selectStudents: '选择学生',
    assigned: '已分配',
    collapse: '收起',
  } : {
    title: 'Experiment Condition Management',
    name: 'Condition Name',
    aiEnabled: 'AI Enabled',
    wozEnabled: 'WoZ Mode',
    students: 'Students',
    actions: 'Actions',
    create: 'Create Condition',
    delete: 'Delete',
    summary: 'Experiment Summary',
    conditions: 'Conditions',
    interventions: 'Interventions',
    accepted: 'Accepted',
    dismissed: 'Dismissed',
    pending: 'Pending',
    events: 'Events',
    export: 'Data Export',
    exportEvents: 'Export Events (CSV)',
    exportNetwork: 'Export Network (GEXF)',
    exportInterventions: 'Export Interventions (CSV)',
    dateFrom: 'From',
    dateTo: 'To',
    noSpace: 'Please enter a course space first',
    assign: 'Assign Students',
    unassign: 'Remove',
    assignDone: 'Confirm Assignment',
    selectStudents: 'Select Students',
    assigned: 'Assigned',
    collapse: 'Collapse',
  };

  useEffect(() => {
    if (!spaceId) { setLoading(false); return; }
    const loads: Promise<any>[] = [
      researchApi.listConditions(spaceId).then(r => setConditions(r.conditions)),
      researchApi.summary(spaceId).then(r => setSummary(r.summary)),
    ];
    if (courseId) {
      loads.push(
        courseSettingsApi.listMembers(courseId).then(r =>
          setCourseMembers(r.members.filter(m => m.role === 'student'))
        ).catch(() => {})
      );
    }
    Promise.all(loads).catch(() => {}).finally(() => setLoading(false));
  }, [spaceId, courseId]);

  const handleCreate = async () => {
    if (!spaceId || !newName.trim()) return;
    try {
      const { condition } = await researchApi.createCondition(spaceId, {
        condition_name: newName.trim(),
        ai_enabled: newAiEnabled,
        woz_enabled: newWozEnabled,
      });
      setConditions(prev => [...prev, { ...condition, assigned_count: 0 }]);
      setNewName('');
    } catch {}
  };

  const handleDelete = async (id: string) => {
    if (!confirm(lang === 'zh' ? '确定删除此条件？' : 'Delete this condition?')) return;
    try {
      await researchApi.deleteCondition(id);
      setConditions(prev => prev.filter(c => c.id !== id));
    } catch {}
  };

  const handleExpandAssign = async (conditionId: string) => {
    if (expandedConditionId === conditionId) {
      setExpandedConditionId(null);
      return;
    }
    setExpandedConditionId(conditionId);
    setSelectedUserIds([]);
    if (spaceId && !assignmentsMap[conditionId]) {
      try {
        const { assignments } = await researchApi.listAssignments(spaceId, conditionId);
        setAssignmentsMap(prev => ({ ...prev, [conditionId]: assignments }));
      } catch {}
    }
  };

  const handleAssign = async (conditionId: string) => {
    if (selectedUserIds.length === 0) return;
    setAssigningLoading(true);
    try {
      await researchApi.assign(conditionId, selectedUserIds);
      // Refresh assignments
      if (spaceId) {
        const { assignments } = await researchApi.listAssignments(spaceId, conditionId);
        setAssignmentsMap(prev => ({ ...prev, [conditionId]: assignments }));
      }
      setConditions(prev => prev.map(c => c.id === conditionId ? { ...c, assigned_count: (c.assigned_count ?? 0) + selectedUserIds.length } : c));
      setSelectedUserIds([]);
    } catch {} finally { setAssigningLoading(false); }
  };

  const handleUnassign = async (conditionId: string, userId: string) => {
    try {
      await researchApi.unassign(conditionId, userId);
      setAssignmentsMap(prev => ({
        ...prev,
        [conditionId]: (prev[conditionId] ?? []).filter(a => a.user_id !== userId),
      }));
      setConditions(prev => prev.map(c => c.id === conditionId ? { ...c, assigned_count: Math.max(0, (c.assigned_count ?? 1) - 1) } : c));
    } catch {}
  };

  const handleExport = async (type: 'events' | 'network' | 'interventions') => {
    if (!spaceId) return;
    setExporting(true);
    try {
      if (type === 'events') {
        // Always request JSON (apiClient.request() requires JSON responses)
        const { events } = await researchApi.exportEvents(spaceId, { from: exportFrom || undefined, to: exportTo || undefined, format: 'json' }) as any;
        if (Array.isArray(events) && events.length > 0) {
          downloadCsv(events, `research_events_${spaceId}.csv`);
        }
      } else if (type === 'network') {
        const result = await researchApi.exportNetwork(spaceId, { format: 'json' });
        downloadBlob(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }), `research_network_${spaceId}.json`);
      } else {
        const { interventions } = await researchApi.exportInterventions(spaceId, { from: exportFrom || undefined, to: exportTo || undefined, format: 'json' }) as any;
        if (Array.isArray(interventions) && interventions.length > 0) {
          downloadCsv(interventions, `research_interventions_${spaceId}.csv`);
        }
      }
    } catch {} finally { setExporting(false); }
  };

  if (!spaceId) return <div className="p-10 text-center text-gray-400">{t.noSpace}</div>;
  if (loading) return <div className="p-10 text-center text-gray-400">Loading...</div>;

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      {/* Summary */}
      {summary && (
        <div>
          <h3 className="font-bold text-gray-800 mb-3 text-base">{t.summary}</h3>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
            {[
              { label: t.conditions, value: summary.condition_count, color: 'blue' },
              { label: t.events, value: summary.total_events, color: 'purple' },
              { label: t.interventions, value: summary.total_interventions, color: 'amber' },
              { label: t.accepted, value: summary.accepted_interventions, color: 'green' },
              { label: t.dismissed, value: summary.dismissed_interventions, color: 'red' },
              { label: t.pending, value: summary.pending_interventions, color: 'gray' },
            ].map(s => (
              <div key={s.label} className={`bg-${s.color}-50 rounded-lg p-3 text-center`}>
                <div className={`font-bold text-xl text-${s.color}-700`}>{s.value}</div>
                <div className="text-[0.6875rem] text-gray-500">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Conditions Table */}
      {(userRole === 'teacher' || userRole === 'admin') && (
        <div>
          <h3 className="font-bold text-gray-800 mb-3 text-base">{t.title}</h3>
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-bold text-gray-500">{t.name}</th>
                  <th className="px-4 py-2 text-center text-xs font-bold text-gray-500">{t.aiEnabled}</th>
                  <th className="px-4 py-2 text-center text-xs font-bold text-gray-500">{t.wozEnabled}</th>
                  <th className="px-4 py-2 text-center text-xs font-bold text-gray-500">{t.students}</th>
                  <th className="px-4 py-2 text-center text-xs font-bold text-gray-500">{t.actions}</th>
                </tr>
              </thead>
              <tbody>
                {conditions.map(c => (
                  <React.Fragment key={c.id}>
                    <tr className="border-b hover:bg-gray-50">
                      <td className="px-4 py-2 font-medium">{c.condition_name}</td>
                      <td className="px-4 py-2 text-center">{c.ai_enabled ? '✅' : '❌'}</td>
                      <td className="px-4 py-2 text-center">{c.woz_enabled ? '✅' : '❌'}</td>
                      <td className="px-4 py-2 text-center">
                        <button onClick={() => handleExpandAssign(c.id)} className="text-blue-600 hover:text-blue-800 text-xs font-bold underline">
                          {c.assigned_count ?? 0} {expandedConditionId === c.id ? `↑` : `↓`}
                        </button>
                      </td>
                      <td className="px-4 py-2 text-center flex gap-1 justify-center">
                        <button onClick={() => handleExpandAssign(c.id)} className="text-blue-500 hover:text-blue-700 text-xs font-bold">{expandedConditionId === c.id ? t.collapse : t.assign}</button>
                        <button onClick={() => handleDelete(c.id)} className="text-red-500 hover:text-red-700 text-xs font-bold">{t.delete}</button>
                      </td>
                    </tr>
                    {expandedConditionId === c.id && (
                      <tr>
                        <td colSpan={5} className="px-4 py-3 bg-blue-50/50 border-b">
                          <div className="space-y-2">
                            {/* Currently assigned students */}
                            {(assignmentsMap[c.id] ?? []).length > 0 && (
                              <div>
                                <div className="text-[0.6875rem] font-bold text-gray-500 mb-1">{t.assigned}:</div>
                                <div className="flex flex-wrap gap-1">
                                  {(assignmentsMap[c.id] ?? []).map(a => (
                                    <span key={a.id} className="inline-flex items-center gap-1 bg-blue-100 text-blue-700 text-[0.6875rem] px-2 py-0.5 rounded-full">
                                      {(a.users as any)?.name ?? a.user_id.slice(0, 8)}
                                      <button onClick={() => handleUnassign(c.id, a.user_id)} className="text-red-400 hover:text-red-600 font-bold">×</button>
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                            {/* Student selection */}
                            <div>
                              <div className="text-[0.6875rem] font-bold text-gray-500 mb-1">{t.selectStudents}:</div>
                              <div className="max-h-32 overflow-y-auto border border-gray-200 rounded bg-white p-1.5 space-y-0.5">
                                {courseMembers.length === 0 ? (
                                  <div className="text-[0.6875rem] text-gray-400 text-center py-2">
                                    {lang === 'zh' ? '无学生' : 'No students'}
                                  </div>
                                ) : courseMembers.map(m => {
                                  const alreadyAssigned = (assignmentsMap[c.id] ?? []).some(a => a.user_id === m.userId);
                                  return (
                                    <label key={m.userId} className={`flex items-center gap-2 text-xs py-0.5 px-1 rounded hover:bg-gray-50 ${alreadyAssigned ? 'opacity-50' : 'cursor-pointer'}`}>
                                      <input
                                        type="checkbox"
                                        disabled={alreadyAssigned}
                                        checked={selectedUserIds.includes(m.userId) || alreadyAssigned}
                                        onChange={() => {
                                          if (alreadyAssigned) return;
                                          setSelectedUserIds(prev => prev.includes(m.userId) ? prev.filter(id => id !== m.userId) : [...prev, m.userId]);
                                        }}
                                        className="rounded"
                                      />
                                      <span className="font-medium">{m.name}</span>
                                      {alreadyAssigned && <span className="text-[0.6875rem] text-gray-400 ml-auto">{t.assigned}</span>}
                                    </label>
                                  );
                                })}
                              </div>
                              {selectedUserIds.length > 0 && (
                                <button
                                  onClick={() => handleAssign(c.id)}
                                  disabled={assigningLoading}
                                  className="mt-1.5 px-3 py-1 bg-blue-600 text-white text-xs font-bold rounded hover:bg-blue-700 disabled:opacity-50"
                                >
                                  {assigningLoading ? '...' : `${t.assignDone} (${selectedUserIds.length})`}
                                </button>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
                {conditions.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400 text-xs">{lang === 'zh' ? '暂无实验条件' : 'No conditions yet'}</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Create Form */}
          <div className="mt-3 flex gap-2 items-center">
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder={t.name}
              className="flex-1 border border-gray-300 rounded px-3 py-1.5 text-sm"
            />
            <label className="flex items-center gap-1 text-xs text-gray-600">
              <input type="checkbox" checked={newAiEnabled} onChange={e => setNewAiEnabled(e.target.checked)} /> AI
            </label>
            <label className="flex items-center gap-1 text-xs text-gray-600">
              <input type="checkbox" checked={newWozEnabled} onChange={e => setNewWozEnabled(e.target.checked)} /> WoZ
            </label>
            <button onClick={handleCreate} className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm font-bold hover:bg-blue-700">{t.create}</button>
          </div>
        </div>
      )}

      {/* Export Section */}
      {(userRole === 'teacher' || userRole === 'admin') && (
        <div>
          <h3 className="font-bold text-gray-800 mb-3 text-base flex items-center gap-2">
            <Download size={16} /> {t.export}
          </h3>
          <p className="text-xs text-gray-500 mb-3">
            {lang === 'zh' ? '所有研究导出均自动匿名化（用户 ID 替换为 8 位哈希，移除姓名和邮箱）' : 'All research exports are automatically anonymized (user IDs replaced with 8-char hashes, names and emails removed)'}
          </p>
          <div className="flex gap-2 items-center mb-3">
            <label className="text-xs text-gray-500">{t.dateFrom}:</label>
            <input type="date" value={exportFrom} onChange={e => setExportFrom(e.target.value)} className="border border-gray-300 rounded px-2 py-1 text-xs" />
            <label className="text-xs text-gray-500">{t.dateTo}:</label>
            <input type="date" value={exportTo} onChange={e => setExportTo(e.target.value)} className="border border-gray-300 rounded px-2 py-1 text-xs" />
          </div>
          <div className="flex gap-2">
            <button onClick={() => handleExport('events')} disabled={exporting} className="px-3 py-2 bg-purple-600 text-white rounded text-xs font-bold hover:bg-purple-700 disabled:opacity-50">
              {t.exportEvents}
            </button>
            <button onClick={() => handleExport('network')} disabled={exporting} className="px-3 py-2 bg-blue-600 text-white rounded text-xs font-bold hover:bg-blue-700 disabled:opacity-50">
              {t.exportNetwork}
            </button>
            <button onClick={() => handleExport('interventions')} disabled={exporting} className="px-3 py-2 bg-amber-600 text-white rounded text-xs font-bold hover:bg-amber-700 disabled:opacity-50">
              {t.exportInterventions}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Scaffold Diversity Tab ─────────────────────────────────────
const ScaffoldTab: React.FC<{ courseId: string; spaceId?: string; lang: Language }> = ({ courseId, spaceId, lang }) => {
  const [scaffoldList, setScaffoldList] = useState<ApiScaffold[]>([]);
  const [noteList, setNoteList] = useState<ApiNote[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const promises: Promise<void>[] = [
      scaffoldsApi.list(courseId).then(r => setScaffoldList(r.scaffolds)).catch(() => {}),
    ];
    if (spaceId) {
      promises.push(notesApi.list(spaceId).then(r => setNoteList(r.notes)).catch(() => {}));
    }
    Promise.all(promises).finally(() => setLoading(false));
  }, [courseId, spaceId]);

  const totalUsage = scaffoldList.reduce((sum, s) => sum + s.usageCount, 0);
  const categoryMap = useMemo(() => {
    const m: Record<string, { count: number; usage: number; scaffolds: string[] }> = {};
    scaffoldList.forEach(s => {
      const cat = s.category.split('/')[0];
      if (!m[cat]) m[cat] = { count: 0, usage: 0, scaffolds: [] };
      m[cat].count++;
      m[cat].usage += s.usageCount;
      m[cat].scaffolds.push(s.title);
    });
    return m;
  }, [scaffoldList]);

  // Notes using scaffolds
  const notesWithScaffold = noteList.filter(n => n.scaffold_id);
  const scaffoldAdoption = noteList.length > 0 ? ((notesWithScaffold.length / noteList.length) * 100).toFixed(1) : '0';

  // Per-scaffold note counts
  const scaffoldNoteCount = useMemo(() => {
    const m: Record<string, number> = {};
    notesWithScaffold.forEach(n => {
      if (n.scaffold_id) m[n.scaffold_id] = (m[n.scaffold_id] ?? 0) + 1;
    });
    return m;
  }, [notesWithScaffold]);

  const sorted = [...scaffoldList].sort((a, b) => b.usageCount - a.usageCount);
  const maxUsage = Math.max(...scaffoldList.map(s => s.usageCount), 1);

  if (loading) return <div className="flex items-center justify-center h-full text-gray-400"><RefreshCw className="animate-spin mr-2" size={16}/>{lang === 'zh' ? '加载中...' : 'Loading...'}</div>;

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: lang === 'zh' ? '支架总数' : 'Total Scaffolds', value: scaffoldList.length, color: 'blue' },
          { label: lang === 'zh' ? '总使用次数' : 'Total Usage', value: totalUsage, color: 'green' },
          { label: lang === 'zh' ? '类别数' : 'Categories', value: Object.keys(categoryMap).length, color: 'purple' },
          { label: lang === 'zh' ? '采用率' : 'Adoption Rate', value: `${scaffoldAdoption}%`, color: 'orange' },
        ].map((c, i) => (
          <div key={i} className={`bg-${c.color}-50 border border-${c.color}-200 rounded-xl p-4`}>
            <div className={`text-2xl font-bold text-${c.color}-700`}>{c.value}</div>
            <div className="text-xs text-gray-500 mt-1">{c.label}</div>
          </div>
        ))}
      </div>

      {/* Category breakdown */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <h3 className="font-bold text-gray-700 mb-3">{lang === 'zh' ? '类别分布' : 'Category Distribution'}</h3>
        <div className="space-y-2">
          {Object.entries(categoryMap).sort(([,a],[,b]) => b.usage - a.usage).map(([cat, data]) => (
            <div key={cat} className="flex items-center gap-3">
              <span className="text-sm font-medium text-gray-700 w-32 truncate" title={cat}>{cat}</span>
              <div className="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden">
                <div className="bg-blue-500 h-full rounded-full transition-all" style={{ width: `${totalUsage > 0 ? (data.usage / totalUsage) * 100 : 0}%` }} />
              </div>
              <span className="text-xs text-gray-500 w-16 text-right">{data.usage} uses</span>
              <span className="text-xs text-gray-400 w-20 text-right">{data.count} scaffold(s)</span>
            </div>
          ))}
        </div>
      </div>

      {/* Per-scaffold usage table */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <h3 className="font-bold text-gray-700 mb-3">{lang === 'zh' ? '各支架使用排名' : 'Scaffold Usage Ranking'}</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-400 border-b">
              <th className="text-left py-2">#</th>
              <th className="text-left py-2">{lang === 'zh' ? '支架名称' : 'Scaffold'}</th>
              <th className="text-left py-2">{lang === 'zh' ? '类别' : 'Category'}</th>
              <th className="text-right py-2">{lang === 'zh' ? 'API 使用' : 'API Usage'}</th>
              <th className="text-right py-2">{lang === 'zh' ? '笔记引用' : 'Note Refs'}</th>
              <th className="text-left py-2 w-40">{lang === 'zh' ? '分布' : 'Distribution'}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((s, i) => (
              <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="py-2 text-gray-400">{i + 1}</td>
                <td className="py-2 font-medium text-gray-700">{s.title}</td>
                <td className="py-2 text-gray-500">{s.category.split('/')[0]}</td>
                <td className="py-2 text-right font-mono">{s.usageCount}</td>
                <td className="py-2 text-right font-mono">{scaffoldNoteCount[s.id] ?? 0}</td>
                <td className="py-2">
                  <div className="bg-gray-100 rounded-full h-3 overflow-hidden">
                    <div className="bg-green-500 h-full rounded-full" style={{ width: `${(s.usageCount / maxUsage) * 100}%` }} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {sorted.length === 0 && <div className="text-center text-gray-400 py-8">{lang === 'zh' ? '暂无支架数据' : 'No scaffold data'}</div>}
      </div>

      {/* Low adoption warning */}
      {scaffoldList.filter(s => s.usageCount === 0).length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <h3 className="font-bold text-amber-700 mb-2 flex items-center gap-2"><AlertCircle size={16}/> {lang === 'zh' ? '未使用的支架' : 'Unused Scaffolds'}</h3>
          <div className="flex flex-wrap gap-2">
            {scaffoldList.filter(s => s.usageCount === 0).map(s => (
              <span key={s.id} className="text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded">{s.title}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ── GenAI Intervention Tracking Tab ───────────────────────────
const GenAITab: React.FC<{ spaceId?: string; lang: Language }> = ({ spaceId, lang }) => {
  const [aiSummary, setAiSummary] = useState<AISummary | null>(null);
  const [interventions, setInterventions] = useState<AIIntervention[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!spaceId) return;
    setLoading(true);
    Promise.all([
      metricsApi.aiSummary(spaceId).then(r => setAiSummary(r.aiSummary)).catch(() => {}),
      triggersApi.history(spaceId).then(r => setInterventions(r.interventions)).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [spaceId]);

  const triggerTypeLabels: Record<string, { en: string; zh: string; color: string }> = {
    stagnation: { en: 'Stagnation', zh: '停滞', color: 'orange' },
  // 以下四类模型已不再产出（LLM 只输出 T1–T6），但生产库存有早期版本写下的行，
    // 标签保留，否则历史数据在图表上会显示成原始英文 id。
    evidence_gap: { en: 'Evidence Gap', zh: '证据缺失', color: 'red' },
    participation_imbalance: { en: 'Participation Imbalance', zh: '参与失衡', color: 'purple' },
    weak_synthesis: { en: 'Weak Synthesis', zh: '综合不足', color: 'blue' },
    isolation: { en: 'Isolation', zh: '孤立笔记', color: 'gray' },
  };

  const acceptedCount = interventions.filter(i => i.accepted_flag === true).length;
  const dismissedCount = interventions.filter(i => i.accepted_flag === false).length;
  const pendingCount = interventions.filter(i => i.accepted_flag == null).length;

  // Group by trigger type
  const typeGroups = useMemo(() => {
    const m: Record<string, { total: number; accepted: number; dismissed: number }> = {};
    interventions.forEach(i => {
      if (!m[i.trigger_type]) m[i.trigger_type] = { total: 0, accepted: 0, dismissed: 0 };
      m[i.trigger_type].total++;
      if (i.accepted_flag === true) m[i.trigger_type].accepted++;
      if (i.accepted_flag === false) m[i.trigger_type].dismissed++;
    });
    return m;
  }, [interventions]);

  // Group by day
  const dailyData = useMemo(() => {
    const m: Record<string, { total: number; accepted: number }> = {};
    interventions.forEach(i => {
      const day = i.created_at.slice(0, 10);
      if (!m[day]) m[day] = { total: 0, accepted: 0 };
      m[day].total++;
      if (i.accepted_flag === true) m[day].accepted++;
    });
    return Object.entries(m).sort(([a],[b]) => a.localeCompare(b));
  }, [interventions]);

  if (loading) return <div className="flex items-center justify-center h-full text-gray-400"><RefreshCw className="animate-spin mr-2" size={16}/>{lang === 'zh' ? '加载中...' : 'Loading...'}</div>;

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      {/* Summary cards */}
      <div className="grid grid-cols-5 gap-3">
        {[
          { label: lang === 'zh' ? '总干预' : 'Total', value: aiSummary?.totalInterventions ?? interventions.length, color: 'blue' },
          { label: lang === 'zh' ? '今日' : 'Today', value: aiSummary?.todayInterventions ?? 0, color: 'cyan' },
          { label: lang === 'zh' ? '已接受' : 'Accepted', value: acceptedCount, color: 'green' },
          { label: lang === 'zh' ? '已忽略' : 'Dismissed', value: dismissedCount, color: 'red' },
          { label: lang === 'zh' ? '接受率' : 'Accept Rate', value: `${aiSummary?.acceptanceRate ? (Number(aiSummary.acceptanceRate) * 100).toFixed(0) : interventions.length > 0 ? ((acceptedCount / interventions.length) * 100).toFixed(0) : 0}%`, color: 'purple' },
        ].map((c, i) => (
          <div key={i} className={`bg-${c.color}-50 border border-${c.color}-200 rounded-xl p-4`}>
            <div className={`text-2xl font-bold text-${c.color}-700`}>{c.value}</div>
            <div className="text-xs text-gray-500 mt-1">{c.label}</div>
          </div>
        ))}
      </div>

      {/* Trigger type breakdown */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <h3 className="font-bold text-gray-700 mb-3">{lang === 'zh' ? '触发类型分析' : 'Trigger Type Analysis'}</h3>
        <div className="space-y-3">
          {Object.entries(typeGroups).sort(([,a],[,b]) => b.total - a.total).map(([type, data]) => {
            const meta = triggerTypeLabels[type] ?? { en: type, zh: type, color: 'gray' };
            const maxTotal = Math.max(...Object.values(typeGroups).map(d => d.total), 1);
            return (
              <div key={type} className="flex items-center gap-3">
                <span className={`text-sm font-medium w-36 truncate text-${meta.color}-700`}>
                  {lang === 'zh' ? meta.zh : meta.en}
                </span>
                <div className="flex-1 flex h-6 bg-gray-100 rounded overflow-hidden">
                  <div className="bg-green-400 h-full" style={{ width: `${(data.accepted / maxTotal) * 100}%` }} title={`Accepted: ${data.accepted}`} />
                  <div className="bg-red-300 h-full" style={{ width: `${(data.dismissed / maxTotal) * 100}%` }} title={`Dismissed: ${data.dismissed}`} />
                  <div className="bg-gray-300 h-full" style={{ width: `${((data.total - data.accepted - data.dismissed) / maxTotal) * 100}%` }} title={`Pending: ${data.total - data.accepted - data.dismissed}`} />
                </div>
                <span className="text-xs text-gray-500 w-20 text-right">{data.total} total</span>
                <span className="text-xs text-green-600 w-16 text-right">{data.total > 0 ? ((data.accepted / data.total) * 100).toFixed(0) : 0}%</span>
              </div>
            );
          })}
          {Object.keys(typeGroups).length === 0 && (
            <div className="text-center text-gray-400 py-4">{lang === 'zh' ? '暂无 AI 干预记录' : 'No AI interventions recorded'}</div>
          )}
        </div>
        {Object.keys(typeGroups).length > 0 && (
          <div className="flex gap-4 mt-3 text-[0.6875rem] text-gray-400">
            <span className="flex items-center gap-1"><span className="w-3 h-3 bg-green-400 rounded inline-block" /> {lang === 'zh' ? '接受' : 'Accepted'}</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 bg-red-300 rounded inline-block" /> {lang === 'zh' ? '忽略' : 'Dismissed'}</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 bg-gray-300 rounded inline-block" /> {lang === 'zh' ? '待处理' : 'Pending'}</span>
          </div>
        )}
      </div>

      {/* Daily trend */}
      {dailyData.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <h3 className="font-bold text-gray-700 mb-3">{lang === 'zh' ? '每日干预趋势' : 'Daily Intervention Trend'}</h3>
          <div className="flex items-end gap-1 h-32">
            {dailyData.map(([day, data]) => {
              const maxDay = Math.max(...dailyData.map(([,d]) => d.total), 1);
              return (
                <div key={day} className="flex-1 flex flex-col items-center gap-1" title={`${day}: ${data.total} (${data.accepted} accepted)`}>
                  <div className="w-full flex flex-col justify-end" style={{ height: '100px' }}>
                    <div className="bg-blue-400 w-full rounded-t" style={{ height: `${(data.total / maxDay) * 100}px` }} />
                  </div>
                  <span className="text-[0.6875rem] text-gray-400 -rotate-45 origin-left">{day.slice(5)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent interventions list */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <h3 className="font-bold text-gray-700 mb-3">{lang === 'zh' ? '最近干预记录' : 'Recent Interventions'}</h3>
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {interventions.slice(0, 20).map(i => {
            const meta = triggerTypeLabels[i.trigger_type] ?? { en: i.trigger_type, zh: i.trigger_type, color: 'gray' };
            return (
              <div key={i.id} className="flex items-center gap-3 p-2 rounded border border-gray-100 hover:bg-gray-50 text-sm">
                <span className={`px-2 py-0.5 rounded text-xs font-medium bg-${meta.color}-100 text-${meta.color}-700`}>
                  {lang === 'zh' ? meta.zh : meta.en}
                </span>
                <span className="flex-1 text-gray-600 truncate">{i.response_text?.slice(0, 80) ?? '—'}</span>
                <span className={`text-xs px-2 py-0.5 rounded ${i.accepted_flag === true ? 'bg-green-100 text-green-700' : i.accepted_flag === false ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'}`}>
                  {i.accepted_flag === true ? (lang === 'zh' ? '已接受' : 'Accepted') : i.accepted_flag === false ? (lang === 'zh' ? '已忽略' : 'Dismissed') : (lang === 'zh' ? '待处理' : 'Pending')}
                </span>
                <span className="text-xs text-gray-400">{i.created_at.slice(0, 10)}</span>
              </div>
            );
          })}
          {interventions.length === 0 && <div className="text-center text-gray-400 py-4">{lang === 'zh' ? '暂无记录' : 'No records'}</div>}
        </div>
      </div>
    </div>
  );
};

// ── Idea Thread Mapper Tab ────────────────────────────────────
const ThreadTab: React.FC<{ spaceId?: string; lang: Language; notes: Note[]; edges: Edge[] }> = ({ spaceId, lang, notes, edges }) => {
  const [apiRelations, setApiRelations] = useState<ApiRelation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!spaceId) { setLoading(false); return; }
    relationsApi.listForSpace(spaceId)
      .then(r => setApiRelations(r.relations))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [spaceId]);

  const allRelations = apiRelations.length > 0 ? apiRelations : edges.map(e => ({
    id: e.id,
    source_note_id: e.source,
    target_note_id: e.target,
    relation_type: e.relationType ?? 'extend',
    creator_id: '',
    ai_suggested: e.aiSuggested ?? false,
    ai_accepted: e.aiAccepted,
    created_at: '',
  } as ApiRelation));

  const relationTypeColors: Record<string, { en: string; zh: string; color: string }> = {
    extend: { en: 'Extend', zh: '延伸', color: 'green' },
    clarify: { en: 'Clarify', zh: '澄清', color: 'blue' },
    question: { en: 'Question', zh: '质疑', color: 'yellow' },
    challenge: { en: 'Challenge', zh: '质疑', color: 'red' },
    evidence: { en: 'Evidence', zh: '证据', color: 'purple' },
    synthesize: { en: 'Synthesize', zh: '综合', color: 'pink' },
  };

  // Type distribution
  const typeDistribution = useMemo(() => {
    const m: Record<string, number> = {};
    allRelations.forEach(r => { m[r.relation_type] = (m[r.relation_type] ?? 0) + 1; });
    return m;
  }, [allRelations]);

  // Hub notes (highest in+out degree)
  const degreeMap = useMemo(() => {
    const m: Record<string, { inD: number; outD: number }> = {};
    allRelations.forEach(r => {
      if (!m[r.source_note_id]) m[r.source_note_id] = { inD: 0, outD: 0 };
      if (!m[r.target_note_id]) m[r.target_note_id] = { inD: 0, outD: 0 };
      m[r.source_note_id].outD++;
      m[r.target_note_id].inD++;
    });
    return m;
  }, [allRelations]);

  const hubNotes = useMemo(() => {
    return Object.entries(degreeMap)
      .map(([id, d]) => ({ id, total: d.inD + d.outD, inD: d.inD, outD: d.outD, title: notes.find(n => n.id === id)?.title ?? id.slice(0, 8) }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  }, [degreeMap, notes]);

  // Thread depth: find longest chain
  const threadStats = useMemo(() => {
    const adjList: Record<string, string[]> = {};
    allRelations.forEach(r => {
      if (!adjList[r.source_note_id]) adjList[r.source_note_id] = [];
      adjList[r.source_note_id].push(r.target_note_id);
    });
    // BFS to find max depth from any node
    let maxDepth = 0;
    const visited = new Set<string>();
    for (const start of Object.keys(adjList)) {
      if (visited.has(start)) continue;
      const queue: [string, number][] = [[start, 0]];
      while (queue.length > 0) {
        const [node, depth] = queue.shift()!;
        if (visited.has(node)) continue;
        visited.add(node);
        maxDepth = Math.max(maxDepth, depth);
        for (const next of adjList[node] ?? []) {
          if (!visited.has(next)) queue.push([next, depth + 1]);
        }
      }
    }
    // Isolated notes
    const connectedIds = new Set([...allRelations.map(r => r.source_note_id), ...allRelations.map(r => r.target_note_id)]);
    const isolatedCount = notes.filter(n => !connectedIds.has(n.id)).length;
    // AI-suggested stats
    const aiSuggested = allRelations.filter(r => r.ai_suggested).length;
    const aiAccepted = allRelations.filter(r => r.ai_suggested && r.ai_accepted === true).length;
    return { maxDepth, isolatedCount, aiSuggested, aiAccepted };
  }, [allRelations, notes]);

  const totalRelations = allRelations.length;
  const maxType = Math.max(...Object.values(typeDistribution), 1);

  if (loading) return <div className="flex items-center justify-center h-full text-gray-400"><RefreshCw className="animate-spin mr-2" size={16}/>{lang === 'zh' ? '加载中...' : 'Loading...'}</div>;

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      {/* Summary cards */}
      <div className="grid grid-cols-5 gap-3">
        {[
          { label: lang === 'zh' ? '总关系' : 'Total Relations', value: totalRelations, color: 'blue' },
          { label: lang === 'zh' ? '最长线程' : 'Max Thread Depth', value: threadStats.maxDepth, color: 'green' },
          { label: lang === 'zh' ? '孤立笔记' : 'Isolated Notes', value: threadStats.isolatedCount, color: 'red' },
          { label: lang === 'zh' ? 'AI 建议' : 'AI Suggested', value: threadStats.aiSuggested, color: 'purple' },
          { label: lang === 'zh' ? 'AI 接受率' : 'AI Accept Rate', value: threadStats.aiSuggested > 0 ? `${((threadStats.aiAccepted / threadStats.aiSuggested) * 100).toFixed(0)}%` : 'N/A', color: 'cyan' },
        ].map((c, i) => (
          <div key={i} className={`bg-${c.color}-50 border border-${c.color}-200 rounded-xl p-4`}>
            <div className={`text-2xl font-bold text-${c.color}-700`}>{c.value}</div>
            <div className="text-xs text-gray-500 mt-1">{c.label}</div>
          </div>
        ))}
      </div>

      {/* Relation type distribution */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <h3 className="font-bold text-gray-700 mb-3">{lang === 'zh' ? '关系类型分布' : 'Relation Type Distribution'}</h3>
        <div className="space-y-2">
          {Object.entries(typeDistribution).sort(([,a],[,b]) => b - a).map(([type, count]) => {
            const meta = relationTypeColors[type] ?? { en: type, zh: type, color: 'gray' };
            return (
              <div key={type} className="flex items-center gap-3">
                <span className={`text-sm font-medium w-24 text-${meta.color}-700`}>
                  {lang === 'zh' ? meta.zh : meta.en}
                </span>
                <div className="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden">
                  <div className={`bg-${meta.color}-500 h-full rounded-full`} style={{ width: `${(count / maxType) * 100}%` }} />
                </div>
                <span className="text-sm font-mono w-10 text-right">{count}</span>
                <span className="text-xs text-gray-400 w-12 text-right">{totalRelations > 0 ? ((count / totalRelations) * 100).toFixed(0) : 0}%</span>
              </div>
            );
          })}
          {Object.keys(typeDistribution).length === 0 && (
            <div className="text-center text-gray-400 py-4">{lang === 'zh' ? '暂无关系数据' : 'No relation data'}</div>
          )}
        </div>
      </div>

      {/* Hub notes */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <h3 className="font-bold text-gray-700 mb-3">{lang === 'zh' ? '核心笔记 (Hub Notes)' : 'Hub Notes (Most Connected)'}</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-400 border-b">
              <th className="text-left py-2">#</th>
              <th className="text-left py-2">{lang === 'zh' ? '笔记' : 'Note'}</th>
              <th className="text-right py-2">{lang === 'zh' ? '入度' : 'In-Degree'}</th>
              <th className="text-right py-2">{lang === 'zh' ? '出度' : 'Out-Degree'}</th>
              <th className="text-right py-2">{lang === 'zh' ? '总连接' : 'Total'}</th>
            </tr>
          </thead>
          <tbody>
            {hubNotes.map((h, i) => (
              <tr key={h.id} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="py-2 text-gray-400">{i + 1}</td>
                <td className="py-2 font-medium text-gray-700 truncate max-w-[16rem]">{h.title}</td>
                <td className="py-2 text-right font-mono text-blue-600">{h.inD}</td>
                <td className="py-2 text-right font-mono text-green-600">{h.outD}</td>
                <td className="py-2 text-right font-bold">{h.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {hubNotes.length === 0 && <div className="text-center text-gray-400 py-4">{lang === 'zh' ? '暂无数据' : 'No data'}</div>}
      </div>

      {/* Knowledge Building quality indicator */}
      {totalRelations > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <h3 className="font-bold text-gray-700 mb-3">{lang === 'zh' ? '知识建构质量指标' : 'Knowledge Building Quality Indicators'}</h3>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center p-3 bg-gray-50 rounded-lg">
              <div className="text-lg font-bold text-gray-700">
                {((typeDistribution['challenge'] ?? 0) + (typeDistribution['evidence'] ?? 0) + (typeDistribution['synthesize'] ?? 0))}
              </div>
              <div className="text-xs text-gray-500 mt-1">{lang === 'zh' ? '高阶关系' : 'Higher-order Relations'}</div>
              <div className="text-[0.6875rem] text-gray-400">(challenge + evidence + synthesize)</div>
            </div>
            <div className="text-center p-3 bg-gray-50 rounded-lg">
              <div className="text-lg font-bold text-gray-700">
                {totalRelations > 0 ? (((typeDistribution['challenge'] ?? 0) + (typeDistribution['evidence'] ?? 0) + (typeDistribution['synthesize'] ?? 0)) / totalRelations * 100).toFixed(0) : 0}%
              </div>
              <div className="text-xs text-gray-500 mt-1">{lang === 'zh' ? '高阶比例' : 'Higher-order Ratio'}</div>
            </div>
            <div className="text-center p-3 bg-gray-50 rounded-lg">
              <div className="text-lg font-bold text-gray-700">
                {notes.length > 0 ? (totalRelations / notes.length).toFixed(1) : 0}
              </div>
              <div className="text-xs text-gray-500 mt-1">{lang === 'zh' ? '平均连接度' : 'Avg Connectivity'}</div>
              <div className="text-[0.6875rem] text-gray-400">(relations / notes)</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Design Idea Tracking Tab ──────────────────────────────────
const DesignTab: React.FC<{ spaceId?: string; lang: Language; notes: Note[]; edges: Edge[] }> = ({ spaceId, lang, notes, edges }) => {
  // Identify "design" notes by type or content heuristics
  const designNotes = useMemo(() => {
    return notes.filter(n =>
      n.type === 'riseabove' ||
      n.tags?.some(t => /design|idea|prototype|solution/i.test(t)) ||
      /design|idea|prototype|solution|proposal/i.test(n.title)
    );
  }, [notes]);

  // Track evolution: notes that are built-upon (received incoming edges)
  const noteIdSet = new Set(designNotes.map(n => n.id));
  const designEdges = edges.filter(e => noteIdSet.has(e.source) || noteIdSet.has(e.target));

  // Group by author
  const authorIdeas = useMemo(() => {
    const m: Record<string, number> = {};
    designNotes.forEach(n => { m[n.author] = (m[n.author] ?? 0) + 1; });
    return Object.entries(m).sort(([,a],[,b]) => b - a);
  }, [designNotes]);

  // Timeline: ideas per week
  const weeklyData = useMemo(() => {
    const m: Record<string, number> = {};
    designNotes.forEach(n => {
      const d = new Date(n.date);
      const weekStart = new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay());
      const key = weekStart.toISOString().slice(0, 10);
      m[key] = (m[key] ?? 0) + 1;
    });
    return Object.entries(m).sort(([a],[b]) => a.localeCompare(b));
  }, [designNotes]);

  // Rise-above synthesis stats
  const riseAboves = notes.filter(n => n.type === 'riseabove');
  const avgCited = riseAboves.length > 0
    ? (riseAboves.reduce((s, n) => s + (n.citedNoteIds?.length ?? 0), 0) / riseAboves.length).toFixed(1)
    : '0';

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: lang === 'zh' ? '设计理念' : 'Design Ideas', value: designNotes.length, color: 'yellow' },
          { label: lang === 'zh' ? '综合笔记' : 'Rise-Aboves', value: riseAboves.length, color: 'purple' },
          { label: lang === 'zh' ? '关联边' : 'Design Relations', value: designEdges.length, color: 'blue' },
          { label: lang === 'zh' ? '平均引用' : 'Avg Citations', value: avgCited, color: 'green' },
        ].map((c, i) => (
          <div key={i} className={`bg-${c.color}-50 border border-${c.color}-200 rounded-xl p-4`}>
            <div className={`text-2xl font-bold text-${c.color}-700`}>{c.value}</div>
            <div className="text-xs text-gray-500 mt-1">{c.label}</div>
          </div>
        ))}
      </div>

      {/* Contributor breakdown */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <h3 className="font-bold text-gray-700 mb-3">{lang === 'zh' ? '理念贡献者排名' : 'Idea Contributors'}</h3>
        <div className="space-y-2">
          {authorIdeas.slice(0, 10).map(([author, count], i) => {
            const max = authorIdeas[0]?.[1] ?? 1;
            return (
              <div key={author} className="flex items-center gap-3">
                <span className="text-xs text-gray-400 w-5">{i + 1}</span>
                <span className="text-sm font-medium text-gray-700 w-28 truncate">{author}</span>
                <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                  <div className="bg-yellow-400 h-full rounded-full" style={{ width: `${(count / max) * 100}%` }} />
                </div>
                <span className="text-sm font-mono w-8 text-right">{count}</span>
              </div>
            );
          })}
        </div>
        {authorIdeas.length === 0 && <div className="text-center text-gray-400 py-4">{lang === 'zh' ? '暂无设计理念' : 'No design ideas detected'}</div>}
      </div>

      {/* Weekly timeline */}
      {weeklyData.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <h3 className="font-bold text-gray-700 mb-3">{lang === 'zh' ? '每周理念产出' : 'Weekly Idea Output'}</h3>
          <div className="flex items-end gap-2 h-28">
            {weeklyData.map(([week, count]) => {
              const maxW = Math.max(...weeklyData.map(([,c]) => c), 1);
              return (
                <div key={week} className="flex-1 flex flex-col items-center gap-1" title={`Week of ${week}: ${count}`}>
                  <span className="text-[0.6875rem] text-gray-500 font-mono">{count}</span>
                  <div className="w-full bg-yellow-400 rounded-t" style={{ height: `${(count / maxW) * 80}px` }} />
                  <span className="text-[0.6875rem] text-gray-400">{week.slice(5)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Design ideas list */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <h3 className="font-bold text-gray-700 mb-3">{lang === 'zh' ? '理念列表' : 'Idea List'}</h3>
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {designNotes.slice(0, 30).map(n => (
            <div key={n.id} className="flex items-center gap-3 p-2 rounded border border-gray-100 hover:bg-gray-50 text-sm">
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${n.type === 'riseabove' ? 'bg-purple-100 text-purple-700' : 'bg-yellow-100 text-yellow-700'}`}>
                {n.type === 'riseabove' ? 'Rise-Above' : 'Idea'}
              </span>
              <span className="flex-1 text-gray-700 truncate font-medium">{n.title}</span>
              <span className="text-xs text-gray-400">{n.author}</span>
              <span className="text-xs text-gray-400">{n.date?.slice(0, 10)}</span>
            </div>
          ))}
          {designNotes.length === 0 && <div className="text-center text-gray-400 py-4">{lang === 'zh' ? '暂无数据' : 'No data'}</div>}
        </div>
      </div>
    </div>
  );
};

// ── Timemachine Tab (Student Activity Timeline) ───────────────
const TimemachineTab: React.FC<{ spaceId?: string; lang: Language; notes: Note[]; edges: Edge[] }> = ({ spaceId, lang, notes, edges }) => {
  // Build timeline from notes and edges
  const timeline = useMemo(() => {
    const events: { date: string; type: string; label: string; author: string }[] = [];
    notes.forEach(n => {
      events.push({ date: n.date, type: n.type === 'riseabove' ? 'riseabove' : 'note', label: n.title, author: n.author });
    });
    edges.forEach(e => {
      const srcNote = notes.find(n => n.id === e.source);
      events.push({ date: srcNote?.date ?? '', type: `relation_${e.relationType ?? 'extend'}`, label: `${e.relationType ?? 'extend'}`, author: srcNote?.author ?? '' });
    });
    return events.filter(e => e.date).sort((a, b) => a.date.localeCompare(b.date));
  }, [notes, edges]);

  // Daily activity
  const dailyActivity = useMemo(() => {
    const m: Record<string, { notes: number; relations: number }> = {};
    timeline.forEach(e => {
      const day = e.date.slice(0, 10);
      if (!m[day]) m[day] = { notes: 0, relations: 0 };
      if (e.type === 'note' || e.type === 'riseabove') m[day].notes++;
      else m[day].relations++;
    });
    return Object.entries(m).sort(([a],[b]) => a.localeCompare(b));
  }, [timeline]);

  // Author activity distribution
  const authorActivity = useMemo(() => {
    const m: Record<string, { first: string; last: string; count: number }> = {};
    timeline.forEach(e => {
      if (!e.author) return;
      if (!m[e.author]) m[e.author] = { first: e.date, last: e.date, count: 0 };
      m[e.author].count++;
      if (e.date < m[e.author].first) m[e.author].first = e.date;
      if (e.date > m[e.author].last) m[e.author].last = e.date;
    });
    return Object.entries(m).sort(([,a],[,b]) => b.count - a.count);
  }, [timeline]);

  // Milestones
  const milestones = useMemo(() => {
    const ms: { date: string; label: string; labelZh: string }[] = [];
    if (notes.length > 0) {
      const first = [...notes].sort((a,b) => a.date.localeCompare(b.date))[0];
      ms.push({ date: first.date.slice(0, 10), label: 'First note created', labelZh: '第一个笔记' });
    }
    const firstRelation = [...edges].map(e => notes.find(n => n.id === e.source)?.date).filter(Boolean).sort()[0];
    if (firstRelation) ms.push({ date: firstRelation!.slice(0, 10), label: 'First build-on', labelZh: '第一个 Build-on' });
    const firstRiseAbove = notes.filter(n => n.type === 'riseabove').sort((a,b) => a.date.localeCompare(b.date))[0];
    if (firstRiseAbove) ms.push({ date: firstRiseAbove.date.slice(0, 10), label: 'First Rise-Above', labelZh: '第一个综合' });
    const firstChallenge = edges.find(e => e.relationType === 'challenge');
    if (firstChallenge) {
      const d = notes.find(n => n.id === firstChallenge.source)?.date;
      if (d) ms.push({ date: d.slice(0, 10), label: 'First challenge', labelZh: '第一个质疑' });
    }
    return ms.sort((a,b) => a.date.localeCompare(b.date));
  }, [notes, edges]);

  // Active period
  const allDates = dailyActivity.map(([d]) => d);
  const totalDays = allDates.length;
  const activeDays = dailyActivity.filter(([,d]) => d.notes + d.relations > 0).length;

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: lang === 'zh' ? '总事件' : 'Total Events', value: timeline.length, color: 'blue' },
          { label: lang === 'zh' ? '活跃天数' : 'Active Days', value: activeDays, color: 'green' },
          { label: lang === 'zh' ? '参与者' : 'Contributors', value: authorActivity.length, color: 'purple' },
          { label: lang === 'zh' ? '里程碑' : 'Milestones', value: milestones.length, color: 'orange' },
        ].map((c, i) => (
          <div key={i} className={`bg-${c.color}-50 border border-${c.color}-200 rounded-xl p-4`}>
            <div className={`text-2xl font-bold text-${c.color}-700`}>{c.value}</div>
            <div className="text-xs text-gray-500 mt-1">{c.label}</div>
          </div>
        ))}
      </div>

      {/* Milestones timeline */}
      {milestones.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <h3 className="font-bold text-gray-700 mb-3 flex items-center gap-2"><Award size={16}/> {lang === 'zh' ? '里程碑' : 'Milestones'}</h3>
          <div className="relative pl-6 space-y-4">
            <div className="absolute left-2 top-0 bottom-0 w-0.5 bg-blue-200" />
            {milestones.map((m, i) => (
              <div key={i} className="relative flex items-center gap-3">
                <div className="absolute -left-4 w-3 h-3 bg-blue-500 rounded-full border-2 border-white" />
                <span className="text-xs font-mono text-gray-400 w-20">{m.date}</span>
                <span className="text-sm font-medium text-gray-700">{lang === 'zh' ? m.labelZh : m.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Daily activity chart */}
      {dailyActivity.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <h3 className="font-bold text-gray-700 mb-3">{lang === 'zh' ? '每日活动量' : 'Daily Activity'}</h3>
          <div className="flex items-end gap-[2px] h-32">
            {dailyActivity.map(([day, data]) => {
              const maxDay = Math.max(...dailyActivity.map(([,d]) => d.notes + d.relations), 1);
              const total = data.notes + data.relations;
              return (
                <div key={day} className="flex-1 flex flex-col items-center" title={`${day}: ${data.notes} notes, ${data.relations} relations`}>
                  <div className="w-full flex flex-col justify-end" style={{ height: '100px' }}>
                    <div className="bg-green-400 w-full" style={{ height: `${(data.relations / maxDay) * 100}px` }} />
                    <div className="bg-blue-400 w-full rounded-t" style={{ height: `${(data.notes / maxDay) * 100}px` }} />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex gap-4 mt-2 text-[0.6875rem] text-gray-400 justify-center">
            <span className="flex items-center gap-1"><span className="w-3 h-3 bg-blue-400 rounded inline-block" /> {lang === 'zh' ? '笔记' : 'Notes'}</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 bg-green-400 rounded inline-block" /> {lang === 'zh' ? '关系' : 'Relations'}</span>
          </div>
        </div>
      )}

      {/* Author activity */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <h3 className="font-bold text-gray-700 mb-3">{lang === 'zh' ? '参与者活动概览' : 'Contributor Activity'}</h3>
        <table className="w-full text-sm">
          <thead><tr className="text-xs text-gray-400 border-b">
            <th className="text-left py-2">{lang === 'zh' ? '参与者' : 'Contributor'}</th>
            <th className="text-right py-2">{lang === 'zh' ? '活动数' : 'Events'}</th>
            <th className="text-right py-2">{lang === 'zh' ? '首次活动' : 'First Active'}</th>
            <th className="text-right py-2">{lang === 'zh' ? '最后活动' : 'Last Active'}</th>
          </tr></thead>
          <tbody>
            {authorActivity.slice(0, 15).map(([author, data]) => (
              <tr key={author} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="py-2 font-medium text-gray-700">{author}</td>
                <td className="py-2 text-right font-mono">{data.count}</td>
                <td className="py-2 text-right text-gray-400 text-xs">{data.first.slice(0, 10)}</td>
                <td className="py-2 text-right text-gray-400 text-xs">{data.last.slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ── Key Concepts Tab ──────────────────────────────────────────
const ConceptsTab: React.FC<{ spaceId?: string; lang: Language; notes: Note[] }> = ({ spaceId, lang, notes }) => {
  // Extract tags as concepts
  const tagFreq = useMemo(() => {
    const m: Record<string, { count: number; authors: Set<string>; firstSeen: string }> = {};
    notes.forEach(n => {
      (n.tags ?? []).forEach(tag => {
        const t = tag.trim().toLowerCase();
        if (!t) return;
        if (!m[t]) m[t] = { count: 0, authors: new Set(), firstSeen: n.date };
        m[t].count++;
        m[t].authors.add(n.author);
        if (n.date < m[t].firstSeen) m[t].firstSeen = n.date;
      });
    });
    return Object.entries(m).sort(([,a],[,b]) => b.count - a.count);
  }, [notes]);

  // Extract key terms from titles (simple word frequency)
  const titleTerms = useMemo(() => {
    const stopwords = new Set(['the','a','an','is','are','was','were','in','on','at','to','for','of','and','or','but','not','with','this','that','it','from','by','as','be','has','have','had','do','does','did','will','would','can','could','should','may','might','shall','about','into','through','during','before','after','above','below','between','under','over','also','just','than','then','so','if','when','where','how','what','which','who','whom','why','my','your','his','her','its','our','their','me','him','us','them','i','you','he','she','we','they']);
    const m: Record<string, number> = {};
    notes.forEach(n => {
      const words = n.title.toLowerCase().replace(/[^\w\s\u4e00-\u9fff]/g, '').split(/\s+/);
      words.forEach(w => {
        if (w.length < 2 || stopwords.has(w)) return;
        m[w] = (m[w] ?? 0) + 1;
      });
      // Chinese characters as individual concepts
      const zhChars = n.title.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
      zhChars.forEach(w => { m[w] = (m[w] ?? 0) + 1; });
    });
    return Object.entries(m).sort(([,a],[,b]) => b - a).slice(0, 30);
  }, [notes]);

  // Co-occurrence: tags that appear together
  const coOccurrence = useMemo(() => {
    const pairs: Record<string, number> = {};
    notes.forEach(n => {
      const tags = (n.tags ?? []).map(t => t.trim().toLowerCase()).filter(Boolean);
      for (let i = 0; i < tags.length; i++) {
        for (let j = i + 1; j < tags.length; j++) {
          const key = [tags[i], tags[j]].sort().join(' + ');
          pairs[key] = (pairs[key] ?? 0) + 1;
        }
      }
    });
    return Object.entries(pairs).sort(([,a],[,b]) => b - a).slice(0, 10);
  }, [notes]);

  const maxFreq = tagFreq[0]?.[1]?.count ?? 1;

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: lang === 'zh' ? '标签概念数' : 'Tag Concepts', value: tagFreq.length, color: 'blue' },
          { label: lang === 'zh' ? '标题关键词' : 'Title Keywords', value: titleTerms.length, color: 'green' },
          { label: lang === 'zh' ? '概念共现对' : 'Co-occurrences', value: coOccurrence.length, color: 'purple' },
        ].map((c, i) => (
          <div key={i} className={`bg-${c.color}-50 border border-${c.color}-200 rounded-xl p-4`}>
            <div className={`text-2xl font-bold text-${c.color}-700`}>{c.value}</div>
            <div className="text-xs text-gray-500 mt-1">{c.label}</div>
          </div>
        ))}
      </div>

      {/* Tag concepts */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <h3 className="font-bold text-gray-700 mb-3">{lang === 'zh' ? '标签概念频率' : 'Tag Concept Frequency'}</h3>
        <div className="space-y-2">
          {tagFreq.slice(0, 15).map(([tag, data]) => (
            <div key={tag} className="flex items-center gap-3">
              <span className="text-sm font-medium text-gray-700 w-32 truncate">{tag}</span>
              <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                <div className="bg-blue-500 h-full rounded-full" style={{ width: `${(data.count / maxFreq) * 100}%` }} />
              </div>
              <span className="text-xs font-mono w-8 text-right">{data.count}</span>
              <span className="text-xs text-gray-400 w-16 text-right">{data.authors.size} author(s)</span>
            </div>
          ))}
          {tagFreq.length === 0 && <div className="text-center text-gray-400 py-4">{lang === 'zh' ? '笔记未使用标签' : 'No tags found on notes'}</div>}
        </div>
      </div>

      {/* Title keywords word cloud-like display */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <h3 className="font-bold text-gray-700 mb-3">{lang === 'zh' ? '标题高频词' : 'Title Keywords'}</h3>
        <div className="flex flex-wrap gap-2">
          {titleTerms.map(([term, count]) => {
            const maxT = titleTerms[0]?.[1] ?? 1;
            const size = 12 + Math.round((count / maxT) * 14);
            const opacity = 0.4 + (count / maxT) * 0.6;
            return (
              <span key={term} className="text-blue-700 font-medium" style={{ fontSize: `${size}px`, opacity }} title={`${count} occurrences`}>
                {term}
              </span>
            );
          })}
        </div>
        {titleTerms.length === 0 && <div className="text-center text-gray-400 py-4">{lang === 'zh' ? '暂无数据' : 'No data'}</div>}
      </div>

      {/* Co-occurrence */}
      {coOccurrence.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <h3 className="font-bold text-gray-700 mb-3">{lang === 'zh' ? '概念共现' : 'Concept Co-occurrence'}</h3>
          <div className="space-y-2">
            {coOccurrence.map(([pair, count]) => (
              <div key={pair} className="flex items-center gap-3 text-sm">
                <span className="text-purple-700 font-medium">{pair}</span>
                <span className="text-gray-400">x{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ── Lexical Analysis Tab ──────────────────────────────────────
const LexicalTab: React.FC<{ spaceId?: string; lang: Language; notes: Note[] }> = ({ spaceId, lang, notes }) => {
  // Text stats per note
  const noteStats = useMemo(() => {
    return notes.map(n => {
      const text = notePreviewText(n.content);
      const zhChars = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
      const enWords = text.replace(/[\u4e00-\u9fff]/g, ' ').match(/\b\w+\b/g)?.length ?? 0;
      const wordCount = zhChars + enWords;
      const sentences = text.split(/[.!?。！？]+/).filter(s => s.trim().length > 0).length || 1;
      return { id: n.id, title: n.title, author: n.author, wordCount, sentences, avgSentenceLen: wordCount / sentences };
    });
  }, [notes]);

  const totalWords = noteStats.reduce((s, n) => s + n.wordCount, 0);
  const avgWords = noteStats.length > 0 ? (totalWords / noteStats.length).toFixed(0) : '0';
  const avgSentLen = noteStats.length > 0 ? (noteStats.reduce((s, n) => s + n.avgSentenceLen, 0) / noteStats.length).toFixed(1) : '0';

  // Author word counts
  const authorWords = useMemo(() => {
    const m: Record<string, { words: number; notes: number }> = {};
    noteStats.forEach(n => {
      if (!m[n.author]) m[n.author] = { words: 0, notes: 0 };
      m[n.author].words += n.wordCount;
      m[n.author].notes++;
    });
    return Object.entries(m).sort(([,a],[,b]) => b.words - a.words);
  }, [noteStats]);

  // Word count distribution (histogram)
  const histogram = useMemo(() => {
    const bins = [0, 50, 100, 200, 500, 1000, Infinity];
    const labels = ['0-50', '50-100', '100-200', '200-500', '500-1000', '1000+'];
    const counts = new Array(labels.length).fill(0);
    noteStats.forEach(n => {
      for (let i = 0; i < bins.length - 1; i++) {
        if (n.wordCount >= bins[i] && n.wordCount < bins[i + 1]) { counts[i]++; break; }
      }
    });
    return labels.map((l, i) => ({ label: l, count: counts[i] }));
  }, [noteStats]);

  const maxHist = Math.max(...histogram.map(h => h.count), 1);

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: lang === 'zh' ? '总字数' : 'Total Words', value: totalWords.toLocaleString(), color: 'blue' },
          { label: lang === 'zh' ? '笔记数' : 'Notes', value: noteStats.length, color: 'green' },
          { label: lang === 'zh' ? '平均字数' : 'Avg Words/Note', value: avgWords, color: 'purple' },
          { label: lang === 'zh' ? '平均句长' : 'Avg Sentence Length', value: avgSentLen, color: 'orange' },
        ].map((c, i) => (
          <div key={i} className={`bg-${c.color}-50 border border-${c.color}-200 rounded-xl p-4`}>
            <div className={`text-2xl font-bold text-${c.color}-700`}>{c.value}</div>
            <div className="text-xs text-gray-500 mt-1">{c.label}</div>
          </div>
        ))}
      </div>

      {/* Word count distribution histogram */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <h3 className="font-bold text-gray-700 mb-3">{lang === 'zh' ? '字数分布' : 'Word Count Distribution'}</h3>
        <div className="flex items-end gap-3 h-32">
          {histogram.map(h => (
            <div key={h.label} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-xs text-gray-500 font-mono">{h.count}</span>
              <div className="w-full bg-blue-400 rounded-t" style={{ height: `${(h.count / maxHist) * 100}px` }} />
              <span className="text-[0.6875rem] text-gray-400">{h.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Author word counts */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <h3 className="font-bold text-gray-700 mb-3">{lang === 'zh' ? '作者写作量' : 'Author Writing Volume'}</h3>
        <table className="w-full text-sm">
          <thead><tr className="text-xs text-gray-400 border-b">
            <th className="text-left py-2">{lang === 'zh' ? '作者' : 'Author'}</th>
            <th className="text-right py-2">{lang === 'zh' ? '总字数' : 'Total Words'}</th>
            <th className="text-right py-2">{lang === 'zh' ? '笔记数' : 'Notes'}</th>
            <th className="text-right py-2">{lang === 'zh' ? '平均字数' : 'Avg'}</th>
          </tr></thead>
          <tbody>
            {authorWords.slice(0, 15).map(([author, data]) => (
              <tr key={author} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="py-2 font-medium text-gray-700">{author}</td>
                <td className="py-2 text-right font-mono">{data.words.toLocaleString()}</td>
                <td className="py-2 text-right font-mono">{data.notes}</td>
                <td className="py-2 text-right font-mono text-gray-500">{data.notes > 0 ? Math.round(data.words / data.notes) : 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Top longest notes */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <h3 className="font-bold text-gray-700 mb-3">{lang === 'zh' ? '最长笔记' : 'Longest Notes'}</h3>
        <div className="space-y-2">
          {[...noteStats].sort((a,b) => b.wordCount - a.wordCount).slice(0, 10).map((n, i) => (
            <div key={n.id} className="flex items-center gap-3 text-sm">
              <span className="text-gray-400 w-5">{i + 1}</span>
              <span className="flex-1 font-medium text-gray-700 truncate">{n.title}</span>
              <span className="text-xs text-gray-400">{n.author}</span>
              <span className="text-xs font-mono text-blue-600">{n.wordCount.toLocaleString()} {lang === 'zh' ? '字' : 'words'}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ── Feedback / Data Download Tab ──────────────────────────────
const FeedbackTab: React.FC<{ spaceId?: string; courseId: string; lang: Language; userRole?: UserRole }> = ({ spaceId, courseId, lang, userRole }) => {
  const [exportFrom, setExportFrom] = useState('');
  const [exportTo, setExportTo] = useState('');
  const [exporting, setExporting] = useState<string | null>(null);
  const [anonymize, setAnonymize] = useState(true);

  const handleExport = async (type: 'events' | 'network' | 'interventions' | 'notes' | 'relations') => {
    if (!spaceId) return;
    setExporting(type);
    try {
      let data: any;
      let filename: string;
      if (type === 'events') {
        const res = anonymize
          ? await researchApi.exportEvents(spaceId, { from: exportFrom || undefined, to: exportTo || undefined, format: 'json' })
          : await researchApi.exportEvents(spaceId, { from: exportFrom || undefined, to: exportTo || undefined, format: 'json' });
        data = res; filename = `events_${spaceId.slice(0, 8)}.json`;
      } else if (type === 'network') {
        const res = await researchApi.exportNetwork(spaceId, { format: 'json' });
        data = res; filename = `network_${spaceId.slice(0, 8)}.json`;
      } else if (type === 'interventions') {
        const res = await researchApi.exportInterventions(spaceId, { from: exportFrom || undefined, to: exportTo || undefined, format: 'json' });
        data = res; filename = `interventions_${spaceId.slice(0, 8)}.json`;
      } else if (type === 'notes') {
        const res = await notesApi.list(spaceId);
        data = res; filename = `notes_${spaceId.slice(0, 8)}.json`;
      } else {
        const res = await relationsApi.listForSpace(spaceId);
        data = res; filename = `relations_${spaceId.slice(0, 8)}.json`;
      }
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setExporting(null);
    }
  };

  const exports = [
    { key: 'events' as const, label: lang === 'zh' ? '事件日志' : 'Event Logs', desc: lang === 'zh' ? '所有用户操作事件（匿名化）' : 'All user action events (anonymized)', icon: Activity, requiresResearch: true },
    { key: 'network' as const, label: lang === 'zh' ? '知识网络' : 'Knowledge Network', desc: lang === 'zh' ? '笔记和关系的网络图数据' : 'Notes and relations graph data', icon: Network, requiresResearch: true },
    { key: 'interventions' as const, label: lang === 'zh' ? 'AI 干预记录' : 'AI Interventions', desc: lang === 'zh' ? 'AI 触发和用户响应数据' : 'AI trigger and user response data', icon: Zap, requiresResearch: true },
    { key: 'notes' as const, label: lang === 'zh' ? '笔记数据' : 'Notes Data', desc: lang === 'zh' ? '所有笔记内容和元数据' : 'All note content and metadata', icon: FileText, requiresResearch: false },
    { key: 'relations' as const, label: lang === 'zh' ? '关系数据' : 'Relations Data', desc: lang === 'zh' ? '所有 Build-on 关系' : 'All build-on relations', icon: LinkIcon, requiresResearch: false },
  ];

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      {/* Date range */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <h3 className="font-bold text-gray-700 mb-3 flex items-center gap-2"><Download size={16}/> {lang === 'zh' ? '数据下载' : 'Data Download'}</h3>
        <div className="flex items-center gap-4 mb-4">
          <div>
            <label className="text-xs text-gray-500 block mb-1">{lang === 'zh' ? '起始日期' : 'From'}</label>
            <input type="date" value={exportFrom} onChange={e => setExportFrom(e.target.value)} className="border border-gray-300 rounded px-3 py-1.5 text-sm" />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">{lang === 'zh' ? '结束日期' : 'To'}</label>
            <input type="date" value={exportTo} onChange={e => setExportTo(e.target.value)} className="border border-gray-300 rounded px-3 py-1.5 text-sm" />
          </div>
          <div className="flex items-center gap-2 ml-4">
            <label className="text-xs text-gray-500">{lang === 'zh' ? '匿名化' : 'Anonymize'}</label>
            <button onClick={() => setAnonymize(!anonymize)} className={`w-8 h-4 rounded-full relative transition-colors ${anonymize ? 'bg-green-500' : 'bg-gray-300'}`}>
              <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${anonymize ? 'left-4.5' : 'left-0.5'}`} style={{ left: anonymize ? '17px' : '2px' }} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3">
          {exports.map(exp => (
            <div key={exp.key} className="flex items-center gap-4 p-3 border border-gray-100 rounded-lg hover:bg-gray-50">
              <exp.icon size={20} className="text-gray-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-700">{exp.label}</div>
                <div className="text-xs text-gray-400">{exp.desc}</div>
              </div>
              <button
                onClick={() => handleExport(exp.key)}
                disabled={!spaceId || exporting === exp.key}
                className="px-4 py-1.5 bg-blue-600 text-white text-xs font-bold rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1"
              >
                {exporting === exp.key ? <RefreshCw size={12} className="animate-spin" /> : <Download size={12} />}
                {lang === 'zh' ? '下载 JSON' : 'Download JSON'}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Data dictionary */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <h3 className="font-bold text-gray-700 mb-3">{lang === 'zh' ? '数据字典' : 'Data Dictionary'}</h3>
        <div className="space-y-3 text-sm">
          {[
            { table: 'events', fields: 'actor_id, event_type, object_type, object_id, space_id, created_at, metadata_json' },
            { table: 'notes', fields: 'id, title, content, type, author_id, scaffold_id, tags, epistemic_status, created_at' },
            { table: 'relations', fields: 'id, source_note_id, target_note_id, relation_type, creator_id, ai_suggested, created_at' },
            { table: 'ai_interventions', fields: 'id, trigger_type, note_id, user_id, response_text, accepted_flag, created_at' },
          ].map(t => (
            <div key={t.table} className="bg-gray-50 rounded p-3">
              <div className="font-bold text-gray-700 text-xs mb-1">{t.table}</div>
              <div className="text-xs text-gray-500 font-mono">{t.fields}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ── Student Rating Upload Tab ─────────────────────────────────
const RatingTab: React.FC<{ spaceId?: string; courseId: string; lang: Language; notes: Note[] }> = ({ spaceId, courseId, lang, notes }) => {
  const [ratings, setRatings] = useState<{ student: string; score: number; comment: string }[]>([]);
  const [csvText, setCsvText] = useState('');
  const [manualStudent, setManualStudent] = useState('');
  const [manualScore, setManualScore] = useState('');
  const [manualComment, setManualComment] = useState('');

  // Get unique authors from notes
  const authors = useMemo(() => {
    const s = new Set<string>();
    notes.forEach(n => s.add(n.author));
    return [...s].sort();
  }, [notes]);

  const handleCSVUpload = () => {
    if (!csvText.trim()) return;
    const lines = csvText.trim().split('\n');
    const newRatings: typeof ratings = [];
    lines.forEach((line, i) => {
      if (i === 0 && /student|name/i.test(line)) return; // skip header
      const parts = line.split(',').map(s => s.trim().replace(/^"|"$/g, ''));
      if (parts.length >= 2) {
        newRatings.push({
          student: parts[0],
          score: parseFloat(parts[1]) || 0,
          comment: parts[2] ?? '',
        });
      }
    });
    setRatings(prev => [...prev, ...newRatings]);
    setCsvText('');
  };

  const handleAddManual = () => {
    if (!manualStudent || !manualScore) return;
    setRatings(prev => [...prev, {
      student: manualStudent,
      score: parseFloat(manualScore) || 0,
      comment: manualComment,
    }]);
    setManualStudent('');
    setManualScore('');
    setManualComment('');
  };

  const handleRemove = (idx: number) => {
    setRatings(prev => prev.filter((_, i) => i !== idx));
  };

  const avgScore = ratings.length > 0 ? (ratings.reduce((s, r) => s + r.score, 0) / ratings.length).toFixed(1) : '—';

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: lang === 'zh' ? '已评分学生' : 'Students Rated', value: ratings.length, color: 'blue' },
          { label: lang === 'zh' ? '平均分' : 'Avg Score', value: avgScore, color: 'green' },
          { label: lang === 'zh' ? '未评分' : 'Unrated', value: Math.max(0, authors.length - ratings.length), color: 'orange' },
        ].map((c, i) => (
          <div key={i} className={`bg-${c.color}-50 border border-${c.color}-200 rounded-xl p-4`}>
            <div className={`text-2xl font-bold text-${c.color}-700`}>{c.value}</div>
            <div className="text-xs text-gray-500 mt-1">{c.label}</div>
          </div>
        ))}
      </div>

      {/* CSV Upload */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <h3 className="font-bold text-gray-700 mb-3 flex items-center gap-2"><Upload size={16}/> {lang === 'zh' ? 'CSV 批量导入' : 'CSV Batch Upload'}</h3>
        <p className="text-xs text-gray-400 mb-2">{lang === 'zh' ? '格式：学生姓名, 分数, 评语（每行一条）' : 'Format: student_name, score, comment (one per line)'}</p>
        <textarea
          value={csvText}
          onChange={e => setCsvText(e.target.value)}
          placeholder={`Alice, 85, Good progress\nBob, 72, Needs more evidence`}
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm h-24 resize-none font-mono"
        />
        <button onClick={handleCSVUpload} disabled={!csvText.trim()} className="mt-2 px-4 py-1.5 bg-blue-600 text-white text-xs font-bold rounded hover:bg-blue-700 disabled:opacity-50">
          {lang === 'zh' ? '导入' : 'Import'}
        </button>
      </div>

      {/* Manual entry */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <h3 className="font-bold text-gray-700 mb-3">{lang === 'zh' ? '手动评分' : 'Manual Rating'}</h3>
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="text-xs text-gray-500 block mb-1">{lang === 'zh' ? '学生' : 'Student'}</label>
            <select value={manualStudent} onChange={e => setManualStudent(e.target.value)} className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm">
              <option value="">—</option>
              {authors.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div className="w-24">
            <label className="text-xs text-gray-500 block mb-1">{lang === 'zh' ? '分数' : 'Score'}</label>
            <input type="number" value={manualScore} onChange={e => setManualScore(e.target.value)} className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm" min="0" max="100" />
          </div>
          <div className="flex-1">
            <label className="text-xs text-gray-500 block mb-1">{lang === 'zh' ? '评语' : 'Comment'}</label>
            <input value={manualComment} onChange={e => setManualComment(e.target.value)} className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm" />
          </div>
          <button onClick={handleAddManual} disabled={!manualStudent || !manualScore} className="px-4 py-1.5 bg-green-600 text-white text-xs font-bold rounded hover:bg-green-700 disabled:opacity-50 flex-shrink-0">
            {lang === 'zh' ? '添加' : 'Add'}
          </button>
        </div>
      </div>

      {/* Ratings table */}
      {ratings.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <h3 className="font-bold text-gray-700 mb-3">{lang === 'zh' ? '评分列表' : 'Ratings'}</h3>
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-gray-400 border-b">
              <th className="text-left py-2">{lang === 'zh' ? '学生' : 'Student'}</th>
              <th className="text-right py-2">{lang === 'zh' ? '分数' : 'Score'}</th>
              <th className="text-left py-2">{lang === 'zh' ? '评语' : 'Comment'}</th>
              <th className="text-right py-2"></th>
            </tr></thead>
            <tbody>
              {ratings.map((r, i) => (
                <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-2 font-medium text-gray-700">{r.student}</td>
                  <td className="py-2 text-right font-mono">
                    <span className={`px-2 py-0.5 rounded ${r.score >= 80 ? 'bg-green-100 text-green-700' : r.score >= 60 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>{r.score}</span>
                  </td>
                  <td className="py-2 text-gray-500">{r.comment}</td>
                  <td className="py-2 text-right">
                    <button onClick={() => handleRemove(i)} className="text-red-400 hover:text-red-600 text-xs">x</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 flex justify-end">
            <button
              onClick={() => {
                const csv = 'student,score,comment\n' + ratings.map(r => `"${r.student}",${r.score},"${r.comment}"`).join('\n');
                const blob = new Blob([csv], { type: 'text/csv' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a'); a.href = url; a.download = 'ratings.csv'; a.click();
                URL.revokeObjectURL(url);
              }}
              className="px-4 py-1.5 bg-blue-600 text-white text-xs font-bold rounded hover:bg-blue-700 flex items-center gap-1"
            >
              <Download size={12}/> {lang === 'zh' ? '导出 CSV' : 'Export CSV'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const AnalyticsModal: React.FC<AnalyticsModalProps> = ({
  isOpen, onClose, courseId, spaceId, lang, currentViewId, currentViewName,
  userRole, userId, notes = [], edges = []
}) => {
  const [activeModule, setActiveModule] = useState('citation');
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAnonymous, setIsAnonymous] = useState(false);

  // Real metrics state
  const [spaceSummary, setSpaceSummary] = useState<any>(null);
  const [hotNotes, setHotNotes] = useState<any[]>([]);
  const [participation, setParticipation] = useState<any[]>([]);
  const [evidenceGaps, setEvidenceGaps] = useState<any[]>([]);
  const [aiAnalysis, setAiAnalysis] = useState<string>('');
  const [isAiAnalyzing, setIsAiAnalyzing] = useState(false);

  // Computed word cloud from real notes
  const wordCloudData = useMemo(() => {
    const freq: Record<string, number> = {};
    const stopwords = new Set(['的','了','是','在','有','和','与','或','也','都','不','这','那','个','一','我','你','他','她','it','is','the','a','an','of','to','in','and','or','for','that','this','with','as','be','was','are','on','at','by','from']);
    notes.forEach(note => {
      const text = ((note.title || '') + ' ' + notePreviewText(note.content)).toLowerCase();
      const words = text.match(/[\u4e00-\u9fa5]{2,}|\b[a-z]{4,}\b/g) ?? [];
      words.forEach(w => {
        if (!stopwords.has(w)) freq[w] = (freq[w] ?? 0) + 1;
      });
    });
    return Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50)
      .map(([text, value]) => ({ text, value: value * 10 }));
  }, [notes]);

  // Computed activity heatmap from note dates (last 30 days)
  const activityHeatmap = useMemo(() => {
    const now = Date.now();
    const days = Array.from({ length: 30 }, (_, i) => {
      const d = new Date(now - (29 - i) * 86400000);
      return { date: d.toLocaleDateString('en', { month: 'short', day: 'numeric' }), value: 0 };
    });
    notes.forEach(note => {
      if (!note.date) return;
      const noteTime = new Date(note.date).getTime();
      const daysAgo = Math.floor((now - noteTime) / 86400000);
      if (daysAgo >= 0 && daysAgo < 30) days[29 - daysAgo].value += 10;
    });
    return days;
  }, [notes]);

  useEffect(() => {
    if (!isOpen || !spaceId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    Promise.all([
      metricsApi.summary(spaceId).catch(() => null),
      metricsApi.hotNotes(spaceId, 10).catch(() => ({ hotNotes: [] })),
      metricsApi.participation(spaceId).catch(() => ({ participation: [] })),
      metricsApi.evidenceGaps(spaceId).catch(() => ({ evidenceGaps: [] })),
    ]).then(([summary, hot, part, gaps]) => {
      setSpaceSummary(summary);
      setHotNotes((hot as any)?.hotNotes ?? []);
      setParticipation((part as any)?.participation ?? []);
      setEvidenceGaps((gaps as any)?.evidenceGaps ?? []);
      setData({} as any); // Mark as loaded
      setIsLoading(false);
    });
  }, [isOpen, spaceId]);

  const handleAiAnalysis = async () => {
    if (!courseId || !spaceId || isAiAnalyzing) return;
    setIsAiAnalyzing(true);
    try {
      const { configs } = await aiApi.listConfigs(courseId);
      const chatCfg = configs.find(c => c.providerId !== 'tavily' && (c.isVerified || (c.enabledModels?.length ?? 0) > 0));
      if (!chatCfg) { setAiAnalysis(lang === 'zh' ? '未配置 AI provider' : 'No AI provider configured'); return; }
      const model = chatCfg.enabledModels[0] ?? '';
      const ctx = JSON.stringify({ notes: notes.length, edges: edges.length, hotNotes: hotNotes.slice(0, 5), participation: participation.slice(0, 10) });
      const { reply } = await aiApi.chat({
        course_id: courseId, provider_id: chatCfg.providerId, model,
        messages: [{ role: 'user', content: `Analyze this Knowledge Building space data and provide a 3-bullet summary in ${lang === 'zh' ? 'Chinese' : 'English'}. Data: ${ctx}` }],
      });
      setAiAnalysis(reply);
    } catch (e: any) {
      setAiAnalysis(e?.message ?? 'Analysis failed');
    } finally {
      setIsAiAnalyzing(false);
    }
  };

  const getLabel = (m: any) => lang === 'zh' ? m.labelZh : m.labelEn;

  // Helper to trigger view creation

  const renderWordCloud = () => {
     if (wordCloudData.length === 0) {
       return (
         <div className="flex flex-col items-center justify-center h-full text-gray-400">
           <Tag size={48} className="mb-4 opacity-20"/>
           <p className="text-sm">{lang === 'zh' ? '暂无笔记内容' : 'No notes to analyze'}</p>
         </div>
       );
     }
     return (
        <div className="flex flex-wrap items-center justify-center gap-4 p-10 h-full overflow-auto relative">
           {wordCloudData.map((w, i) => (
              <span
                 key={i}
                 style={{
                    fontSize: `${Math.max(12, w.value / 2)}px`,
                    opacity: 0.6 + (w.value / 200),
                    color: ['#2563eb', '#7c3aed', '#db2777', '#059669'][i % 4]
                 }}
                 className="font-bold"
              >
                 {w.text}
              </span>
           ))}
        </div>
     );
  };

  const renderActivityHeatmap = () => {
     return (
        <div className="p-4">
           <h3 className="font-bold text-gray-700 mb-4">
             {lang === 'zh' ? '活动强度（近 30 天）' : 'Activity Intensity (Last 30 Days)'}
           </h3>
           <div className="grid grid-cols-7 gap-2">
              {activityHeatmap.map((d, i) => (
                 <div key={i} className="aspect-square rounded relative group" style={{ backgroundColor: `rgba(37, 99, 235, ${Math.min(d.value / 100, 1)})`, minHeight: '24px' }}>
                    <div className="absolute inset-0 border border-black/5 rounded"></div>
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 bg-gray-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-10">
                       {d.date}: {d.value} actions
                    </div>
                 </div>
              ))}
           </div>
        </div>
     );
  };

  const renderNetworkGraph = (type: string) => {
     // Placeholder for S2Viz (Social Network)
     return (
        <div className="flex flex-col items-center justify-center h-full text-gray-400 bg-gray-50/50 m-6 border border-dashed border-gray-300 rounded-lg">
           <BrainCircuit size={48} className="mb-4 opacity-20"/>
           <h3 className="font-bold text-lg text-gray-600 mb-2">Social Network Analysis (S2Viz)</h3>
           <p className="max-w-md text-center text-sm">
             Visualizing {type === 'social' ? 'social interactions' : type} between students.
             This module typically displays centrality metrics, cliques, and interaction density.
           </p>
        </div>
     );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-[100] p-0 font-sans animate-in fade-in duration-300">
      <div className="bg-white w-full h-full flex overflow-hidden">
        
        {/* Sidebar */}
        <div className="w-64 bg-slate-900 text-slate-300 flex flex-col border-r border-slate-800 flex-shrink-0">
           <div className="p-5 border-b border-slate-800 bg-slate-950">
             <h2 className="font-bold text-white flex items-center gap-2 tracking-tight">
               <BarChart3 className="text-blue-500" size={20} /> Analytics Studio
             </h2>
             <p className="text-[0.6875rem] text-slate-500 mt-1 uppercase tracking-wider font-bold">Research & Assessment</p>
           </div>
           
           <div className="flex-1 overflow-y-auto custom-scrollbar py-2">
              {MODULES.map(m => (
                 <button
                    key={m.id}
                    onClick={() => setActiveModule(m.id)}
                    className={`w-full text-left px-4 py-3 text-xs font-medium flex items-center gap-3 transition-all border-l-4 hover:bg-slate-800 ${activeModule === m.id ? 'border-blue-500 bg-slate-800 text-white' : 'border-transparent text-slate-400'}`}
                 >
                    <m.icon size={16} className={activeModule === m.id ? 'text-blue-400' : 'text-slate-500'} />
                    {getLabel(m)}
                 </button>
              ))}
           </div>

           <div className="p-4 border-t border-slate-800 bg-slate-950 space-y-2">
              <button onClick={() => setIsAnonymous(!isAnonymous)} className="w-full flex items-center justify-between text-xs px-3 py-2 bg-slate-800 rounded hover:bg-slate-700 transition-colors">
                 <span className="flex items-center gap-2"><EyeOff size={12}/> Privacy Mode</span>
                 <div className={`w-6 h-3 rounded-full relative transition-colors ${isAnonymous ? 'bg-green-500' : 'bg-slate-600'}`}>
                    <div className={`absolute top-0.5 w-2 h-2 bg-white rounded-full transition-all ${isAnonymous ? 'left-3.5' : 'left-0.5'}`}></div>
                 </div>
              </button>
              <button className="w-full flex items-center justify-center gap-2 text-xs px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 font-bold">
                 <Download size={12}/> Export Report
              </button>
           </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col bg-gray-50 overflow-hidden relative">
           {/* Header */}
           <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-6 shadow-sm z-10 flex-shrink-0">
              <h1 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                 {MODULES.find(m => m.id === activeModule)?.icon && React.createElement(MODULES.find(m => m.id === activeModule)!.icon, { size: 20, className: 'text-gray-400' })}
                 {getLabel(MODULES.find(m => m.id === activeModule))}
                 {currentViewName && (
                     <span className="text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded border border-blue-100 ml-2">
                         Filtered by View: {currentViewName}
                     </span>
                 )}
              </h1>
              <div className="flex items-center gap-3">
                 <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
                    <input type="text" placeholder="Filter data..." className="pl-9 pr-3 py-1.5 text-sm border border-gray-300 rounded-full bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none w-48 transition-all"/>
                 </div>
                 <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full text-gray-500 transition-colors"><X size={20}/></button>
              </div>
           </header>

           {/* Workspace */}
           <main className="flex-1 overflow-hidden relative">
              {isLoading ? (
                 <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400">
                    <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-2"></div>
                    <span className="text-sm">Analyzing Course Data...</span>
                 </div>
              ) : (
                 <div className="h-full overflow-auto animate-in zoom-in-95 duration-300">

                    {/* ── Hot Notes / Ideas Building (real data) ── */}
                    {(activeModule === 'building' || activeModule === 'citation') && (
                      <div className="p-6">
                        <h3 className="font-bold text-gray-800 mb-4 text-base">
                          {lang === 'zh' ? '热门笔记' : 'Hot Notes'}
                        </h3>
                        {hotNotes.length === 0 ? (
                          <div className="text-gray-400 text-sm text-center py-10">{lang === 'zh' ? '暂无数据' : 'No data yet'}</div>
                        ) : (
                          <div className="space-y-3">
                            {hotNotes.map((n: any, i: number) => {
                              const nm = n.note_metrics_realtime ?? n;
                              const note = n.notes ?? {};
                              return (
                                <div key={i} className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="flex-1 min-w-0">
                                      <div className="font-semibold text-gray-800 text-sm truncate">{note.title ?? `Note ${i + 1}`}</div>
                                      <div className="flex gap-3 mt-1 flex-wrap">
                                        <span className="text-xs text-gray-500 flex items-center gap-1"><Hammer size={10}/> {nm.build_on_count ?? 0} build-ons</span>
                                        <span className="text-xs text-orange-500 flex items-center gap-1"><AlertCircle size={10}/> {nm.challenge_count ?? 0} challenges</span>
                                        <span className="text-xs text-green-600 flex items-center gap-1"><CheckCircleIcon size={10}/> {nm.evidence_count ?? 0} evidence</span>
                                      </div>
                                    </div>
                                    <div className="text-right flex-shrink-0">
                                      <div className="text-lg font-bold text-orange-500">{((nm.heat_score ?? 0)).toFixed(0)}</div>
                                      <div className="text-[0.6875rem] text-gray-400">{lang === 'zh' ? '热度' : 'heat'}</div>
                                    </div>
                                  </div>
                                  {/* Bar showing relative heat */}
                                  <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                    <div className="h-full bg-gradient-to-r from-orange-400 to-red-500 rounded-full" style={{ width: `${Math.min((nm.heat_score ?? 0) / 100 * 100, 100)}%` }}/>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Evidence gaps */}
                        {evidenceGaps.length > 0 && (
                          <div className="mt-6">
                            <h4 className="font-bold text-red-700 text-sm mb-3 flex items-center gap-1">
                              <AlertCircle size={14}/> {lang === 'zh' ? '证据缺口（有质疑无证据）' : 'Evidence Gaps (challenged but unevidenced)'}
                            </h4>
                            <div className="space-y-2">
                              {evidenceGaps.slice(0, 5).map((n: any, i: number) => (
                                <div key={i} className="bg-red-50 border border-red-100 rounded-lg p-3 text-xs text-red-800">
                                  {(n.notes as any)?.title ?? `Note ${i + 1}`} — {n.challenge_count ?? 0} challenges
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* ── Word Cloud (real data) ── */}
                    {activeModule === 'wordcloud' && renderWordCloud()}

                    {/* ── Idea Thread Mapper ── */}
                    {activeModule === 'thread' && <ThreadTab spaceId={spaceId ?? undefined} lang={lang} notes={notes} edges={edges} />}

                    {/* ── Design Idea Tracking ── */}
                    {activeModule === 'design' && <DesignTab spaceId={spaceId ?? undefined} lang={lang} notes={notes} edges={edges} />}

                    {/* ── Key Concepts ── */}
                    {activeModule === 'concepts' && <ConceptsTab spaceId={spaceId ?? undefined} lang={lang} notes={notes} />}

                 </div>
              )}
           </main>
        </div>
      </div>
    </div>
  );
};

export default AnalyticsModal;
