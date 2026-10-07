import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  LogIn, UserPlus, AlertCircle, CheckCircle, ExternalLink,
  BookOpen, Users, Shield, GraduationCap, ChevronDown, ChevronUp,
} from 'lucide-react';
import { auth } from '../../services/apiClient';
import ThemeToggle from '../ThemeToggle';
import { LangSwitcher3, Lang3 } from '../LangSwitcher';
import { readPublicLanguage, saveLanguagePreference } from '../../utils/languagePreference';

type Lang = Lang3;
type Tab  = 'login' | 'register';

// ── Quotes ────────────────────────────────────────────────────────────
const KB_QUOTES = [
  {
    en: 'All ideas are treated as improvable.',
    'zh-CN': '所有观念都应被视为可以改进的。',
    'zh-TW': '所有觀念都應被視為可以改進的。',
    author: 'Marlene Scardamalia',
    source: 'Collective Cognitive Responsibility for the Advancement of Knowledge, 2002',
    principle: { 'zh-CN': '原则二：可改进的观念', en: 'Principle 2: Improvable Ideas', 'zh-TW': '原則二：可改進的觀念' },
  },
  {
    en: 'Idea diversity is essential to the development of knowledge advancement, just as biodiversity is essential to the success of an ecosystem.',
    'zh-CN': '观念多样性对知识推进至关重要，正如生物多样性对生态系统成功至关重要一样。',
    'zh-TW': '觀念多樣性對知識推進至關重要，正如生物多樣性對生態系統成功至關重要一樣。',
    author: 'Marlene Scardamalia',
    source: 'Collective Cognitive Responsibility for the Advancement of Knowledge, 2002',
    principle: { 'zh-CN': '原则三：观念多元化', en: 'Principle 3: Idea Diversity', 'zh-TW': '原則三：觀念多元化' },
  },
  {
    en: 'Participants set forth their ideas and negotiate a fit between personal ideas and ideas of others, using contrasts to spark and sustain knowledge advancement.',
    'zh-CN': '参与者主动提出自己的观念，并在个人观念与他人观念之间协商形成契合，利用差异激发并维持知识推进。',
    'zh-TW': '參與者主動提出自己的觀念，並在個人觀念與他人觀念之間協商形成契合，利用差異激發並維持知識推進。',
    author: 'Marlene Scardamalia',
    source: 'Collective Cognitive Responsibility for the Advancement of Knowledge, 2002',
    principle: { 'zh-CN': '原则五：认知自主能动性', en: 'Principle 5: Epistemic Agency', 'zh-TW': '原則五：認知自主能動性' },
  },
  {
    en: 'Contributions to shared, top-level goals of the organization are prized and rewarded as much as individual achievements.',
    'zh-CN': '对组织共同高层次目标所作的贡献，应与个人成就同样受到重视与奖励。',
    'zh-TW': '對組織共同高層次目標所作的貢獻，應與個人成就同樣受到重視與獎勵。',
    author: 'Marlene Scardamalia',
    source: 'Collective Cognitive Responsibility for the Advancement of Knowledge, 2002',
    principle: { 'zh-CN': '原则六：社区知识与集体责任', en: 'Principle 6: Community Knowledge', 'zh-TW': '原則六：社區知識與集體責任' },
  },
  {
    en: 'The discourse of knowledge building communities results in more than the sharing of knowledge; the knowledge itself is refined and transformed through the discursive practices of the community.',
    'zh-CN': '知识建构共同体中的话语活动所带来的，不仅是知识的分享；知识本身会在共同体的话语实践中被精炼并转化。',
    'zh-TW': '知識建構共同體中的話語活動所帶來的，不僅是知識的分享；知識本身會在共同體的話語實踐中被精煉並轉化。',
    author: 'Marlene Scardamalia',
    source: 'IKIT — Collective Cognitive Responsibility, 2002',
    principle: { 'zh-CN': '原则十一：知识建构话语', en: 'Principle 11: Knowledge Building Discourse', 'zh-TW': '原則十一：知識建構話語' },
  },
  {
    en: 'Knowledge building, as an educational approach, focuses on the advancement of community knowledge, with individual learning as a by-product.',
    'zh-CN': '作为一种教育路径，知识建构关注的是共同体知识的推进，而个体学习是其副产品。',
    'zh-TW': '作為一種教育路徑，知識建構關注的是共同體知識的推進，而個體學習是其副產品。',
    author: 'Carl Bereiter & Marlene Scardamalia',
    source: 'Knowledge Building and Knowledge Creation, 2014',
    principle: { 'zh-CN': '知识建构的核心区分', en: 'Core Distinction of Knowledge Building', 'zh-TW': '知識建構的核心區分' },
  },
  {
    en: 'To give knowledge is to get knowledge.',
    'zh-CN': '给予知识，就是获得知识。',
    'zh-TW': '給予知識，就是獲得知識。',
    author: 'Marlene Scardamalia',
    source: 'Collective Cognitive Responsibility, 2002',
    principle: { 'zh-CN': '原则八：对称的知识进步', en: 'Principle 8: Symmetric Knowledge Advancement', 'zh-TW': '原則八：對稱的知識進步' },
  },
  {
    en: 'Knowledge building is not confined to particular occasions or subjects but pervades mental life — in and out of school.',
    'zh-CN': '知识建构并不局限于某些特定时刻或学科，而是渗透于心智生活之中——无论在校内还是校外。',
    'zh-TW': '知識建構並不局限於某些特定時刻或學科，而是滲透於心智生活之中——無論在校內還是校外。',
    author: 'Marlene Scardamalia',
    source: 'Collective Cognitive Responsibility, 2002',
    principle: { 'zh-CN': '原则九：无处不在的知识建构', en: 'Principle 9: Pervasive Knowledge Building', 'zh-TW': '原則九：無處不在的知識建構' },
  },
  {
    en: 'Knowledge building as an educational approach is fundamentally an idea improvement challenge.',
    'zh-CN': '知识建构作为一种教育路径，其根本上是一项观念改进的挑战。',
    'zh-TW': '知識建構作為一種教育路徑，其根本上是一項觀念改進的挑戰。',
    author: 'Carl Bereiter & Marlene Scardamalia',
    source: 'Knowledge Building and Knowledge Creation, 2014',
    principle: { 'zh-CN': '知识建构的根本特征', en: 'Fundamental Nature of Knowledge Building', 'zh-TW': '知識建構的根本特徵' },
  },
  {
    en: "Students' work is primarily valued for what it contributes to the community and secondarily for what it reveals about individual students' knowledge.",
    'zh-CN': '学生的工作首先因其对共同体所作的贡献而被评价，其次才因其揭示了个体学生的知识而被评价。',
    'zh-TW': '學生的工作首先因其對共同體所作的貢獻而被評價，其次才因其揭示了個體學生的知識而被評價。',
    author: 'Marlene Scardamalia & Carl Bereiter',
    source: 'Knowledge Building and Knowledge Creation, 2014',
    principle: { 'zh-CN': '原则六：社区知识与集体责任', en: 'Principle 6: Community Knowledge', 'zh-TW': '原則六：社區知識與集體責任' },
  },
];

// ── Translations (auth page only) ─────────────────────────────────────
const T = {
  'zh-CN': {
    brand: 'HAKCC',
    brandSub: '人智知识协作空间',
    tagline: 'Scardamalia & Bereiter, 2002',
    readMore: '拓展阅读',
    wikiKB: 'Knowledge Building — Wikipedia',
    wikiKF: 'Knowledge Forum — Wikipedia',
    auth: {
      loginTitle: '欢迎回来',
      loginSub: '登录以继续您的知识建构之旅',
      registerTitle: '加入社区',
      registerSub: '创建账户，开始协作学习',
      tabs: { login: '登录', register: '注册' },
      fields: {
        email: '邮箱', password: '密码',
        firstName: '名字', lastName: '姓氏',
        username: '用户名', role: '身份',
        student: '学生', teacher: '教师',
      },
      placeholders: {
        firstName: '名字', lastName: '姓氏',
        username: '字母、数字、下划线',
        email: 'your@email.com',
        password: '至少 6 位字符',
      },
      teacherWarn: '教师账户需管理员审批后方可登录',
      forgotPassword: '忘记密码？',
      forgotPasswordSent: '重置链接已发送至您的邮箱',
      loginBtn: ['登录中…', '登录'],
      registerBtn: ['注册中…', '创建账户'],
      privacy: {
        accept: '我已阅读并同意',
        link: '《隐私政策》',
        required: '请先同意隐私政策',
        modalTitle: 'HAKCC 隐私政策',
      },
    },
    footer: '© 2026 HAKCC',
  },
  en: {
    brand: 'HAKCC',
    brandSub: 'Human-AI Knowledge Collaboration Commons',
    tagline: 'Scardamalia & Bereiter, 2002',
    readMore: 'Further Reading',
    wikiKB: 'Knowledge Building — Wikipedia',
    wikiKF: 'Knowledge Forum — Wikipedia',
    auth: {
      loginTitle: 'Welcome back',
      loginSub: 'Sign in to continue your knowledge-building journey',
      registerTitle: 'Join the community',
      registerSub: 'Create an account to start collaborative learning',
      tabs: { login: 'Sign In', register: 'Register' },
      fields: {
        email: 'Email', password: 'Password',
        firstName: 'First name', lastName: 'Last name',
        username: 'Username', role: 'Role',
        student: 'Student', teacher: 'Teacher',
      },
      placeholders: {
        firstName: 'First name', lastName: 'Last name',
        username: 'Letters, numbers, underscores',
        email: 'your@email.com',
        password: 'At least 6 characters',
      },
      teacherWarn: 'Teacher accounts require administrator approval',
      forgotPassword: 'Forgot password?',
      forgotPasswordSent: 'Reset link sent to your email',
      loginBtn: ['Signing in…', 'Sign In'],
      registerBtn: ['Creating account…', 'Create Account'],
      privacy: {
        accept: 'I have read and agree to the',
        link: 'Privacy Policy',
        required: 'Please accept the Privacy Policy',
        modalTitle: 'HAKCC Privacy Policy',
      },
    },
    footer: '© 2026 HAKCC',
  },
  'zh-TW': {
    brand: 'HAKCC',
    brandSub: '人智知識協作空間',
    tagline: 'Scardamalia & Bereiter, 2002',
    readMore: '延伸閱讀',
    wikiKB: 'Knowledge Building — Wikipedia',
    wikiKF: 'Knowledge Forum — Wikipedia',
    auth: {
      loginTitle: '歡迎回來',
      loginSub: '登入以繼續您的知識建構之旅',
      registerTitle: '加入社區',
      registerSub: '創建帳號，開始協作學習',
      tabs: { login: '登入', register: '註冊' },
      fields: {
        email: '電子郵件', password: '密碼',
        firstName: '名字', lastName: '姓氏',
        username: '用戶名', role: '身份',
        student: '學生', teacher: '教師',
      },
      placeholders: {
        firstName: '名字', lastName: '姓氏',
        username: '字母、數字、底線',
        email: 'your@email.com',
        password: '至少 6 位字元',
      },
      teacherWarn: '教師帳號需管理員審核後方可登入',
      forgotPassword: '忘記密碼？',
      forgotPasswordSent: '重置連結已發送至您的郵箱',
      loginBtn: ['登入中…', '登入'],
      registerBtn: ['註冊中…', '創建帳號'],
      privacy: {
        accept: '我已閱讀並同意',
        link: '《隱私政策》',
        required: '請先同意隱私政策',
        modalTitle: 'HAKCC 隱私政策',
      },
    },
    footer: '© 2026 HAKCC',
  },
} as const;

// ── Privacy Policy Sections ───────────────────────────────────────────
const PRIVACY_SECTIONS: { title: { en: string; zh: string }; content: { en: string; zh: string } }[] = [
  {
    title: { en: 'About HAKCC and Who Uses It', zh: '关于 HAKCC 及用户群体' },
    content: {
      en: `HAKCC (Human-AI Knowledge Collaboration Commons) is a collaborative educational workspace built on Knowledge Building theory, developed by the HAKHub team. Our platform serves students, teachers, researchers, and educational institutions worldwide.`,
      zh: `HAKCC（人智知识协作空间）是一个基于知识建构理论（Scardamalia & Bereiter）的协作学习平台，由 HAKHub 团队开发与维护，面向全球学生、教师、研究人员及教育机构。`,
    },
  },
  {
    title: { en: 'What Information Does HAKCC Collect?', zh: 'HAKCC 收集哪些信息？' },
    content: {
      en: `Personal Information: When you create an account, we collect your first name, last name, email address, username, and role.\n\nUsage Data: We automatically collect technical interaction data including IP address, browser type, session identifiers, pages visited, and timestamps. Contributions you make — notes, annotations, build-on connections — are also stored as part of the service.`,
      zh: `个人信息：注册时，我们收集您的名字、姓氏、电子邮件、用户名及角色。\n\n使用数据：我们自动收集技术交互信息，包括 IP 地址、浏览器类型、会话标识符、访问页面及时间戳。您的贡献内容（笔记、批注、Build-on 关联）也作为服务的一部分被保存。`,
    },
  },
  {
    title: { en: 'How We Use the Information', zh: '我们如何使用收集的信息？' },
    content: {
      en: `We use collected information to: provide and maintain the platform; enable participation in knowledge-building communities; personalise your experience; analyse and improve platform performance; conduct educational research (subject to separate agreements); send service-related communications; detect and resolve technical issues; and comply with legal obligations.`,
      zh: `我们将收集的信息用于：提供和维护平台；支持参与知识建构社区；个性化体验；分析和改进平台性能；开展教育研究（须签订单独协议）；发送服务通知；检测和解决技术问题；以及遵守法律义务。`,
    },
  },
  {
    title: { en: 'Cookies & Log Files', zh: 'Cookie 与日志文件' },
    content: {
      en: `We use session cookies (to maintain your authenticated session), preference cookies (for language and display settings), and security cookies (to validate requests). Every request is logged. We do not share linkable personal data with third parties except as required by law.`,
      zh: `我们使用会话 Cookie（维持登录状态）、偏好 Cookie（语言和显示设置）及安全 Cookie（验证请求）。每次请求均会被记录。除法律要求外，我们不向第三方共享可关联的个人数据。`,
    },
  },
  {
    title: { en: 'Data Sharing', zh: '信息共享' },
    content: {
      en: `We do not sell, rent, or share your personal information for commercial purposes. Information may be shared only with service providers assisting platform operations (under confidentiality), when required by law, or to protect rights, property, or safety.\n\nTo decide whether a note should get automatic AI feedback, and of what kind, HAKCC sends the note's title and text (up to 2,000 characters, without your name) to Jev, a service of the overseas provider TypeSafe. When the AI assistant estimates how long an answer should be, it sends the question itself to the same service.\n\nSo that the AI can look up course materials, HAKCC splits course materials and attachments uploaded to workspaces into passages and sends them to OpenRouter, an overseas provider (the embeddings are computed by VoyageAI); when the AI looks up course materials, the question is sent there too (for a follow-up question, together with the previous two questions and the note title), and the same provider scores how relevant each candidate passage is to it. No uploader or asker names are attached, and only providers that declare they do not collect this data are used.`,
      zh: `我们不会出售、出租或以商业目的共享您的个人信息。仅在以下情况下共享：协助平台运营的服务提供商（须保密）、法律要求，或保护权利、财产或安全。\n\nAI 自动反馈判断一条笔记要不要反馈、属于哪一类时，会把笔记的标题和正文（最多 2000 字，不带姓名）发给境外服务商 TypeSafe 的 Jev 服务；AI 助手估计一个问题要答多长时，会把问题本身发给同一服务。\n\n为了让 AI 能检索课程资料，HAKCC 会把课程资料和知识空间里上传的附件切成段落，发给境外服务商 OpenRouter（由 VoyageAI 计算）生成向量；AI 检索课程资料时，提问内容也会发过去（追问时连同前两句提问和笔记标题），并由同一服务商判断候选段落和提问的相关度。发送时不附上传者或提问者的姓名，且只使用声明不收集这些数据的服务商。`,
    },
  },
  {
    title: { en: 'Your Rights & Data Deletion', zh: '您的权利与数据删除' },
    content: {
      en: `You may access, correct, or request deletion of your personal data at any time. We will process deletion requests within 10 business days. For EEA residents, GDPR rights apply including data portability, restriction of processing, and the right to lodge a complaint with a supervisory authority.`,
      zh: `您可随时查阅、更正或申请删除个人数据，我们将在 10 个工作日内处理。EEA 居民还享有 GDPR 赋予的额外权利，包括数据可携权、限制处理权及向监管机构投诉的权利。`,
    },
  },
  {
    title: { en: 'Sign-in Records', zh: '登录记录' },
    content: {
      en: `Each time you sign in, HAKCC records the time and the sign-in method (password, or a linked account such as Google). We do not record your IP address, device or location.\n\nThese records exist for account security and teaching management only: you can review your own sign-ins in Profile settings; the creator and course managers of a course you belong to can see when its members last signed in; platform administrators can see the same across the platform. They are never used for grading, and every time an administrator or course manager views them, that view is itself logged.\n\nSign-in records are deleted automatically after 180 days. Any use of them for research requires separate informed consent and ethics approval, like all other research data on the platform.`,
      zh: `每次登录时，HAKCC 会记录登录时间和登录方式（密码，或 Google 等关联账号）。我们不记录你的 IP 地址、设备或位置。\n\n这些记录仅用于账号安全与教学管理：你可以在「个人资料」中查看自己的登录记录；你所在课程的创建者和课程管理员可以看到本课成员的最近登录情况；平台管理员可以看到全站的相同信息。这些记录不会用于评分，且管理员或课程管理员的每一次查看本身都会留痕。\n\n登录记录在 180 天后自动删除。若需将其用于研究，须与平台上其他研究数据一样另行取得知情同意并通过伦理审查。`,
    },
  },
  {
    title: { en: 'Children\'s Privacy', zh: '未成年人隐私保护' },
    content: {
      en: `HAKCC does not knowingly collect personal information from children under 13 outside of institutional frameworks. Access for students under 18 is managed through agreements with educational institutions, which are responsible for obtaining appropriate parental consent.`,
      zh: `在机构协议框架之外，HAKCC 不会主动收集 13 岁以下儿童的个人信息。未满 18 岁学生的访问权限通过与教育机构签订的协议进行管理，机构负责取得家长同意。`,
    },
  },
  {
    title: { en: 'Contact', zh: '联系我们' },
    content: {
      en: `Team: HAKHub\nProject: HAKCC — Human-AI Knowledge Collaboration Commons\nBuilt upon: Knowledge Forum (Knowledge Building Theory, Scardamalia & Bereiter)\n\nWe will endeavour to respond to all enquiries within a reasonable timeframe.`,
      zh: `团队：HAKHub\n项目：HAKCC — 人智知识协作空间\n基于：Knowledge Forum（知识建构理论，Scardamalia & Bereiter）\n\n我们将在合理时间内回复所有咨询。`,
    },
  },
];

// ── Privacy Modal ────────────────────────────────────────────────────
function PrivacyModal({ onClose, title, lang }: { onClose: () => void; title: string; lang: Lang }) {
  const [openSection, setOpenSection] = useState<number | null>(0);
  const isZh = lang !== 'en';

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-xl max-h-[82vh] flex flex-col bg-white dark:bg-[#111318] rounded-2xl shadow-2xl border border-gray-200 dark:border-white/8">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-white/8 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <Shield size={15} className="text-blue-600 dark:text-blue-400" />
            <h2 className="font-semibold text-gray-900 dark:text-white text-sm tracking-tight">{title}</h2>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/8 transition-colors cursor-pointer">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
          </button>
        </div>
        <div className="text-xs text-gray-400 dark:text-slate-500 px-6 py-2 border-b border-gray-100 dark:border-white/5 flex-shrink-0">
          {isZh ? '生效日期：2026 年 9 月' : 'Effective Date: September 2026'}
        </div>
        <div className="overflow-y-auto flex-1 px-4 py-3 space-y-2">
          {PRIVACY_SECTIONS.map((section, i) => {
            const sTitle = isZh ? section.title.zh : section.title.en;
            const sContent = isZh ? section.content.zh : section.content.en;
            return (
              <div key={i} className="border border-gray-200 dark:border-white/8 rounded-xl overflow-hidden">
                <button
                  onClick={() => setOpenSection(openSection === i ? null : i)}
                  className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-white/4 transition-colors cursor-pointer"
                >
                  <span className="text-sm font-medium text-gray-800 dark:text-slate-200 pr-4">{sTitle}</span>
                  {openSection === i
                    ? <ChevronUp size={13} className="text-blue-500 flex-shrink-0" />
                    : <ChevronDown size={13} className="text-gray-400 flex-shrink-0" />}
                </button>
                {openSection === i && (
                  <div className="px-4 pb-4 pt-1">
                    <p className="text-xs text-gray-600 dark:text-slate-400 leading-relaxed whitespace-pre-line">{sContent}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="px-6 py-4 border-t border-gray-200 dark:border-white/8 flex-shrink-0">
          <button onClick={onClose} className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors text-sm cursor-pointer">
            {isZh ? '关闭' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────
export default function LoginPage() {
  const { login, register, error, clearError, loading } = useAuth();
  const [lang, setLangState] = useState<Lang>(() => readPublicLanguage('en'));
  const [tab, setTab]   = useState<Tab>('login');
  const [submitting, setSubmitting]   = useState(false);
  const [successMsg, setSuccessMsg]   = useState<string | null>(null);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);

  // Login fields
  const [loginEmail,    setLoginEmail]    = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);

  // Register fields
  const [regFirstName,     setRegFirstName]     = useState('');
  const [regLastName,      setRegLastName]       = useState('');
  const [regUsername,      setRegUsername]       = useState('');
  const [regEmail,         setRegEmail]          = useState('');
  const [regPassword,      setRegPassword]       = useState('');
  const [regRole,          setRegRole]           = useState<'student' | 'teacher'>('student');
  const [regAcceptPrivacy, setRegAcceptPrivacy]  = useState(false);

  const t = T[lang];

  const setLang = (nextLang: Lang) => {
    saveLanguagePreference(nextLang);
    setLangState(nextLang);
  };

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault(); clearError(); setSubmitting(true);
    try { await login(loginEmail, loginPassword); }
    finally { setSubmitting(false); }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regAcceptPrivacy) return;
    clearError(); setSuccessMsg(null); setSubmitting(true);
    try {
      const fullName = [regFirstName.trim(), regLastName.trim()].filter(Boolean).join(' ');
      const result = await register({ email: regEmail, password: regPassword, name: fullName, role: regRole });
      setSuccessMsg(result.message);
      if (regRole === 'student') {
        setTimeout(() => { setTab('login'); setLoginEmail(regEmail); }, 1500);
      }
    } finally { setSubmitting(false); }
  };

  const handleForgotPassword = async () => {
    if (!loginEmail) return;
    setForgotLoading(true);
    try {
      await auth.forgotPassword(loginEmail);
      setForgotSent(true);
    } catch { /* silent */ }
    finally { setForgotLoading(false); }
  };

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-white dark:bg-slate-950">
        <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const inputCls = 'w-full px-3 py-2.5 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-lg text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-white/25 focus:outline-none focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/15 transition-all text-sm';

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400&family=DM+Sans:wght@300;400;500;600&display=swap');

        .font-garamond { font-family: 'EB Garamond', Georgia, serif; }
        .font-dm       { font-family: 'DM Sans', system-ui, sans-serif; }

        @keyframes scrollUp {
          0%   { transform: translateY(0); }
          100% { transform: translateY(-50%); }
        }
        .quotes-scroll {
          animation: scrollUp 130s linear infinite;
        }
        .quotes-scroll:hover {
          animation-play-state: paused;
        }
        .quotes-fade {
          mask-image: linear-gradient(to bottom, transparent 0%, black 5%, black 95%, transparent 100%);
          -webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 5%, black 95%, transparent 100%);
        }
      `}</style>

      {showPrivacyModal && (
        <PrivacyModal onClose={() => setShowPrivacyModal(false)} title={t.auth.privacy.modalTitle} lang={lang} />
      )}

      <div className="h-screen w-screen flex overflow-hidden font-dm">

        {/* ── LEFT PANEL (always dark) ─────────────────────────── */}
        <div className="hidden lg:flex lg:w-[44%] xl:w-[42%] flex-col bg-[#0c1017] relative select-none flex-shrink-0">

          {/* Background figure — subtle texture from platform infographic */}
          <div className="absolute inset-0 overflow-hidden">
            <img
              src="/Image/home2.webp"
              alt=""
              aria-hidden="true"
              className="absolute inset-0 w-full h-full object-cover object-top opacity-[0.06] scale-125 blur-[2px]"
              loading="lazy"
              decoding="async"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-[#0c1017]/70 via-[#0c1017]/85 to-[#0c1017]/95" />
          </div>

          {/* Brand */}
          <div className="relative z-10 px-10 pt-10 pb-6 flex-shrink-0 border-b border-white/6">
            <Link to="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity cursor-pointer">
              <div className="w-8 h-8 rounded-lg bg-blue-500/15 border border-blue-400/20 flex items-center justify-center">
                <BookOpen size={15} className="text-blue-400" />
              </div>
              <div>
                <div className="text-white font-semibold text-sm tracking-wide">{t.brand}</div>
                <div className="text-white/60 text-[0.75rem] mt-0.5 leading-none">
                  {lang === 'zh-CN' ? '人智知识协作空间' : lang === 'zh-TW' ? '人智知識協作空間' : 'Human-AI Knowledge Collaboration Commons'}
                </div>
              </div>
            </Link>
          </div>

          {/* Scrolling quotes */}
          <div className="relative flex-1 overflow-hidden quotes-fade">
            <div className="quotes-scroll">
              {[...KB_QUOTES, ...KB_QUOTES].map((q, i) => {
                const text = (q as Record<string, unknown>)[lang] as string ?? q.en;
                const principle = (q.principle as Record<string, string>)[lang] ?? q.principle.en;
                return (
                  <div key={i} className="px-10 py-7 border-b border-white/5">
                    <div className="text-blue-400/35 font-garamond text-6xl leading-none mb-3 -ml-1">"</div>
                    <blockquote className="font-garamond text-[1.1875rem] text-white/[0.94] leading-[1.75] mb-4">
                      {text}
                    </blockquote>
                    {lang !== 'en' && (
                      <p className="font-garamond italic text-white/60 text-[0.875rem] leading-relaxed mb-4">
                        {q.en}
                      </p>
                    )}
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="text-blue-400 text-[0.8125rem] font-medium tracking-wide">{q.author}</div>
                        <div className="text-white/55 text-[0.75rem] mt-0.5 leading-snug">{q.source}</div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <span className="text-white/55 text-[0.75rem] border border-white/20 rounded px-2 py-0.5 whitespace-nowrap">
                          {principle}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Further Reading */}
          <div className="relative z-10 px-10 py-8 flex-shrink-0 border-t border-white/6 space-y-3">
            <div className="text-white/55 text-[0.6875rem] uppercase tracking-[0.18em] mb-4">{t.readMore}</div>

            <a
              href="https://en.wikipedia.org/wiki/Knowledge_building"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 group cursor-pointer"
            >
              <div className="w-[3px] h-8 rounded-full bg-blue-500/30 group-hover:bg-blue-400/70 transition-colors flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-white/80 group-hover:text-white text-[0.8438rem] transition-colors leading-snug">
                  {t.wikiKB}
                </div>
                <div className="text-white/45 text-[0.7188rem] mt-0.5">en.wikipedia.org</div>
              </div>
              <ExternalLink size={11} className="text-white/20 group-hover:text-blue-400/60 transition-colors flex-shrink-0" />
            </a>

            <a
              href="https://en.wikipedia.org/wiki/Knowledge_Forum"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 group cursor-pointer"
            >
              <div className="w-[3px] h-8 rounded-full bg-violet-500/30 group-hover:bg-violet-400/70 transition-colors flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-white/80 group-hover:text-white text-[0.8438rem] transition-colors leading-snug">
                  {t.wikiKF}
                </div>
                <div className="text-white/45 text-[0.7188rem] mt-0.5">en.wikipedia.org</div>
              </div>
              <ExternalLink size={11} className="text-white/20 group-hover:text-violet-400/60 transition-colors flex-shrink-0" />
            </a>

            <div className="pt-2 text-white/40 text-[0.7188rem]">{t.footer} · {t.brandSub}</div>
          </div>
        </div>

        {/* ── RIGHT PANEL ──────────────────────────────────────── */}
        <div className="flex-1 flex flex-col bg-white dark:bg-[#111318] overflow-y-auto">

          {/* Top bar */}
          <div className="flex items-center justify-end gap-2 px-6 sm:px-8 pt-5 pb-3 flex-shrink-0">
            <LangSwitcher3 value={lang} onChange={setLang} />
            <ThemeToggle />
          </div>

          {/* Form area */}
          <div className="flex-1 flex items-center justify-center px-6 sm:px-10 py-6">
            <div className="w-full max-w-[360px]">

              {/* Mobile brand */}
              <Link to="/" className="lg:hidden mb-7 flex items-center gap-2.5 hover:opacity-80 transition-opacity cursor-pointer">
                <div className="w-7 h-7 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                  <BookOpen size={13} className="text-blue-600 dark:text-blue-400" />
                </div>
                <span className="text-gray-900 dark:text-white font-semibold text-sm tracking-wide">{t.brand}</span>
                <span className="text-[0.6875rem] text-gray-500 dark:text-white/40 ml-1">
                  {lang === 'zh-CN' ? '人智知识协作空间' : lang === 'zh-TW' ? '人智知識協作空間' : 'Human-AI Knowledge Collaboration Commons'}
                </span>
              </Link>

              {/* Heading */}
              <div className="mb-7">
                <h1 className="text-[1.375rem] font-semibold text-gray-900 dark:text-white tracking-tight leading-tight">
                  {tab === 'login' ? t.auth.loginTitle : t.auth.registerTitle}
                </h1>
                <p className="text-gray-500 dark:text-white/35 text-[0.8125rem] mt-1.5">
                  {tab === 'login' ? t.auth.loginSub : t.auth.registerSub}
                </p>
              </div>

              {/* Tab switcher */}
              <div className="flex mb-6 bg-gray-100 dark:bg-white/5 rounded-lg p-[3px]">
                {(['login', 'register'] as Tab[]).map(tb => (
                  <button
                    key={tb}
                    onClick={() => { setTab(tb); clearError(); setSuccessMsg(null); }}
                    className={`flex-1 py-2 text-[0.8125rem] font-medium rounded-md transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                      tab === tb
                        ? 'bg-white dark:bg-[#1e2330] text-gray-900 dark:text-white shadow-sm'
                        : 'text-gray-400 dark:text-white/30 hover:text-gray-700 dark:hover:text-white/60'
                    }`}
                  >
                    {tb === 'login'
                      ? <><LogIn size={13} />{t.auth.tabs.login}</>
                      : <><UserPlus size={13} />{t.auth.tabs.register}</>
                    }
                  </button>
                ))}
              </div>

              {/* Alerts */}
              {error && (
                <div className="mb-5 flex items-start gap-2 px-3 py-2.5 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg text-red-700 dark:text-red-300 text-[0.75rem] leading-relaxed">
                  <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}
              {successMsg && (
                <div className="mb-5 flex items-start gap-2 px-3 py-2.5 bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20 rounded-lg text-green-700 dark:text-green-300 text-[0.75rem] leading-relaxed">
                  <CheckCircle size={13} className="flex-shrink-0 mt-0.5" />
                  <span>{successMsg}</span>
                </div>
              )}

              {/* ── Login Form ── */}
              {tab === 'login' && (
                <form onSubmit={handleLogin} className="space-y-4">
                  <div>
                    <label htmlFor="login-email" className="block text-[0.75rem] font-medium text-gray-600 dark:text-white/45 mb-1.5 tracking-wide">
                      {t.auth.fields.email}
                    </label>
                    <input
                      id="login-email" type="email" required autoComplete="email"
                      value={loginEmail} onChange={e => setLoginEmail(e.target.value)}
                      placeholder={t.auth.placeholders.email}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label htmlFor="login-password" className="block text-[0.75rem] font-medium text-gray-600 dark:text-white/45 tracking-wide">
                        {t.auth.fields.password}
                      </label>
                      <button
                        type="button"
                        onClick={handleForgotPassword}
                        disabled={!loginEmail || forgotLoading}
                        className="text-[0.6875rem] text-blue-600 dark:text-blue-400 hover:underline underline-offset-2 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                      >
                        {forgotLoading ? '...' : t.auth.forgotPassword}
                      </button>
                    </div>
                    <input
                      id="login-password" type="password" required autoComplete="current-password"
                      value={loginPassword} onChange={e => setLoginPassword(e.target.value)}
                      placeholder="••••••••"
                      className={inputCls}
                    />
                    {forgotSent && (
                      <p className="mt-1.5 text-[0.6875rem] text-green-600 dark:text-green-400 flex items-center gap-1">
                        <CheckCircle size={11} />{t.auth.forgotPasswordSent}
                      </p>
                    )}
                  </div>
                  <button
                    type="submit" disabled={submitting}
                    className="w-full py-2.5 mt-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2 text-[0.8125rem] cursor-pointer"
                  >
                    {submitting
                      ? <><div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />{t.auth.loginBtn[0]}</>
                      : <><LogIn size={14} />{t.auth.loginBtn[1]}</>
                    }
                  </button>

                </form>
              )}

              {/* ── Register Form ── */}
              {tab === 'register' && (
                <form onSubmit={handleRegister} className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="reg-fn" className="block text-[0.75rem] font-medium text-gray-600 dark:text-white/45 mb-1.5 tracking-wide">
                        {t.auth.fields.firstName} <span className="text-red-400">*</span>
                      </label>
                      <input id="reg-fn" type="text" required value={regFirstName}
                        onChange={e => setRegFirstName(e.target.value)}
                        placeholder={t.auth.placeholders.firstName} className={inputCls} />
                    </div>
                    <div>
                      <label htmlFor="reg-ln" className="block text-[0.75rem] font-medium text-gray-600 dark:text-white/45 mb-1.5 tracking-wide">
                        {t.auth.fields.lastName} <span className="text-red-400">*</span>
                      </label>
                      <input id="reg-ln" type="text" required value={regLastName}
                        onChange={e => setRegLastName(e.target.value)}
                        placeholder={t.auth.placeholders.lastName} className={inputCls} />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="reg-email" className="block text-[0.75rem] font-medium text-gray-600 dark:text-white/45 mb-1.5 tracking-wide">
                      {t.auth.fields.email} <span className="text-red-400">*</span>
                    </label>
                    <input id="reg-email" type="email" required autoComplete="email"
                      value={regEmail} onChange={e => setRegEmail(e.target.value)}
                      placeholder={t.auth.placeholders.email} className={inputCls} />
                  </div>

                  <div>
                    <label htmlFor="reg-username" className="block text-[0.75rem] font-medium text-gray-600 dark:text-white/45 mb-1.5 tracking-wide">
                      {t.auth.fields.username} <span className="text-red-400">*</span>
                    </label>
                    <input id="reg-username" type="text" required minLength={3} maxLength={30}
                      value={regUsername}
                      onChange={e => setRegUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                      placeholder={t.auth.placeholders.username} className={inputCls} />
                  </div>

                  <div>
                    <label htmlFor="reg-password" className="block text-[0.75rem] font-medium text-gray-600 dark:text-white/45 mb-1.5 tracking-wide">
                      {t.auth.fields.password} <span className="text-red-400">*</span>
                    </label>
                    <input id="reg-password" type="password" required minLength={6}
                      value={regPassword} onChange={e => setRegPassword(e.target.value)}
                      placeholder={t.auth.placeholders.password} className={inputCls} />
                    {regPassword && (() => {
                      let s = 0;
                      if (regPassword.length >= 6) s++;
                      if (regPassword.length >= 10) s++;
                      if (/[A-Z]/.test(regPassword)) s++;
                      if (/[0-9]/.test(regPassword)) s++;
                      if (/[^a-zA-Z0-9]/.test(regPassword)) s++;
                      const color = s <= 1 ? 'bg-red-500' : s <= 2 ? 'bg-amber-500' : s <= 3 ? 'bg-blue-500' : 'bg-green-500';
                      return (
                        <div className="mt-1.5 flex gap-1">
                          {[1, 2, 3, 4].map(i => (
                            <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i <= Math.min(s, 4) ? color : 'bg-gray-200 dark:bg-white/10'}`} />
                          ))}
                        </div>
                      );
                    })()}
                  </div>

                  {/* Role */}
                  <div>
                    <label className="block text-[0.75rem] font-medium text-gray-600 dark:text-white/45 mb-1.5 tracking-wide">
                      {t.auth.fields.role} <span className="text-red-400">*</span>
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {(['student', 'teacher'] as const).map(r => (
                        <button key={r} type="button" onClick={() => setRegRole(r)}
                          className={`py-2 rounded-lg border text-[0.75rem] font-medium transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                            regRole === r
                              ? 'bg-blue-600 border-blue-500 text-white'
                              : 'bg-gray-50 dark:bg-white/4 border-gray-200 dark:border-white/10 text-gray-500 dark:text-white/35 hover:border-blue-400 dark:hover:border-blue-500/40 hover:text-blue-600 dark:hover:text-blue-400'
                          }`}
                        >
                          {r === 'student'
                            ? <><GraduationCap size={13} />{t.auth.fields.student}</>
                            : <><Users size={13} />{t.auth.fields.teacher}</>
                          }
                        </button>
                      ))}
                    </div>
                    {regRole === 'teacher' && (
                      <p className="mt-2 text-[0.6875rem] text-amber-700 dark:text-amber-400/80 flex items-center gap-1.5 bg-amber-50 dark:bg-amber-400/8 border border-amber-200 dark:border-amber-400/15 rounded-lg px-3 py-2">
                        <AlertCircle size={11} className="flex-shrink-0" />{t.auth.teacherWarn}
                      </p>
                    )}
                  </div>

                  {/* Privacy checkbox */}
                  <div className="flex items-start gap-2.5">
                    <button
                      type="button"
                      onClick={() => setRegAcceptPrivacy(v => !v)}
                      className={`mt-0.5 w-4 h-4 rounded flex-shrink-0 border-[1.5px] flex items-center justify-center transition-all cursor-pointer ${
                        regAcceptPrivacy
                          ? 'bg-blue-600 border-blue-600'
                          : 'bg-white dark:bg-white/5 border-gray-300 dark:border-white/20 hover:border-blue-500'
                      }`}
                      role="checkbox"
                      aria-checked={regAcceptPrivacy}
                    >
                      {regAcceptPrivacy && (
                        <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                          <path d="M1 3.5L3.2 5.5L8 1" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </button>
                    <span className="text-[0.75rem] text-gray-500 dark:text-white/35 leading-relaxed">
                      {t.auth.privacy.accept}{' '}
                      <button
                        type="button"
                        onClick={() => setShowPrivacyModal(true)}
                        className="text-blue-600 dark:text-blue-400 hover:underline underline-offset-2 font-medium cursor-pointer"
                      >
                        {t.auth.privacy.link}
                      </button>
                    </span>
                  </div>

                  <button
                    type="submit" disabled={submitting || !regAcceptPrivacy}
                    className="w-full py-2.5 mt-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 dark:disabled:bg-white/8 disabled:cursor-not-allowed disabled:text-gray-400 dark:disabled:text-white/20 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2 text-[0.8125rem] cursor-pointer"
                  >
                    {submitting
                      ? <><div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />{t.auth.registerBtn[0]}</>
                      : <><UserPlus size={14} />{t.auth.registerBtn[1]}</>
                    }
                  </button>
                </form>
              )}

              {/* Mobile: Wikipedia links */}
              <div className="lg:hidden mt-8 pt-6 border-t border-gray-100 dark:border-white/8 space-y-2">
                <div className="text-gray-400 dark:text-white/20 text-[0.6875rem] uppercase tracking-[0.18em] mb-3">{t.readMore}</div>
                {[
                  { href: 'https://en.wikipedia.org/wiki/Knowledge_building', label: t.wikiKB },
                  { href: 'https://en.wikipedia.org/wiki/Knowledge_Forum',    label: t.wikiKF },
                ].map(({ href, label }) => (
                  <a key={href} href={href} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 text-[0.75rem] text-gray-400 dark:text-white/30 hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer">
                    <ExternalLink size={11} />
                    {label}
                  </a>
                ))}
              </div>

            </div>
          </div>

          {/* Footer */}
          <div className="px-6 sm:px-8 py-5 flex-shrink-0 flex items-center justify-between">
            <span className="text-[0.6875rem] text-gray-300 dark:text-white/18">{t.footer}</span>
            <button
              onClick={() => setShowPrivacyModal(true)}
              className="text-[0.6875rem] text-gray-400 dark:text-white/25 hover:text-blue-600 dark:hover:text-blue-400 transition-colors flex items-center gap-1 cursor-pointer"
            >
              <Shield size={10} />
              {lang === 'en' ? 'Privacy Policy' : lang === 'zh-CN' ? '隐私政策' : '隱私政策'}
            </button>
          </div>
        </div>

      </div>
    </>
  );
}
