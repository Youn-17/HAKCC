import React, { useState, useRef } from 'react';
import { 
  X, Square, Circle, Diamond, Type, Move, Save, 
  MousePointer2, Trash2, Minus 
} from 'lucide-react';
import { Language } from '../types';

interface DrawingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (title: string, elements: DrawingElement[]) => void;
  initialData?: { title: string; elements: DrawingElement[] };
  lang?: Language;
}

export interface DrawingElement {
  id: string;
  type: 'rect' | 'circle' | 'diamond' | 'text' | 'line';
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  fill: string;
  stroke: string;
}

const DrawingModal: React.FC<DrawingModalProps> = ({ isOpen, onClose, onSave, initialData, lang = 'en' }) => {
  const [elements, setElements] = useState<DrawingElement[]>(initialData?.elements || []);
  const [title, setTitle] = useState(initialData?.title || (lang === 'zh' ? '我的绘图' : 'My Drawing'));
  const [selectedTool, setSelectedTool] = useState('select');
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  
  // Drawing State
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [currentShapeId, setCurrentShapeId] = useState<string | null>(null);

  // Properties
  const [fillColor, setFillColor] = useState('#e0e7ff');
  const [strokeColor, setStrokeColor] = useState('#3730a3');

  const svgRef = useRef<SVGSVGElement>(null);

  const t = {
    cancel: lang === 'zh' ? '取消' : 'Cancel',
    save: lang === 'zh' ? '保存绘图' : 'Save Drawing',
    tools: {
      select: lang === 'zh' ? '选择' : 'Select',
      rect: lang === 'zh' ? '矩形' : 'Rectangle',
      circle: lang === 'zh' ? '圆形' : 'Circle',
      diamond: lang === 'zh' ? '菱形' : 'Decision',
      line: lang === 'zh' ? '直线' : 'Line',
      text: lang === 'zh' ? '文本' : 'Text',
    },
    labels: {
        fill: lang === 'zh' ? '填充' : 'Fill',
        stroke: lang === 'zh' ? '描边' : 'Stroke',
        textPlaceholder: lang === 'zh' ? '标签...' : 'Label...',
    }
  };

  const TOOLS = [
    { id: 'select', icon: MousePointer2, label: t.tools.select },
    { id: 'rect', icon: Square, label: t.tools.rect },
    { id: 'circle', icon: Circle, label: t.tools.circle },
    { id: 'diamond', icon: Diamond, label: t.tools.diamond },
    { id: 'line', icon: Minus, label: t.tools.line },
    { id: 'text', icon: Type, label: t.tools.text },
  ];

  if (!isOpen) return null;

  const getMousePos = (e: React.MouseEvent) => {
    if (!svgRef.current) return { x: 0, y: 0 };
    const rect = svgRef.current.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const pos = getMousePos(e);

    if (selectedTool === 'select') {
      // Selection logic is handled by onClick on elements
      // But clicking background deselects
      if (e.target === svgRef.current) {
        setSelectedElementId(null);
      }
      return;
    }

    setIsDrawing(true);
    setStartPos(pos);
    const newId = Date.now().toString();
    setCurrentShapeId(newId);

    const newElement: DrawingElement = {
      id: newId,
      type: selectedTool as any,
      x: pos.x,
      y: pos.y,
      width: 0,
      height: 0,
      text: selectedTool === 'text' ? 'Text' : '',
      fill: selectedTool === 'line' ? 'none' : fillColor,
      stroke: strokeColor,
    };

    setElements(prev => [...prev, newElement]);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDrawing || !currentShapeId) {
        // If in select mode and dragging an element
        if (selectedTool === 'select' && selectedElementId && (e.buttons === 1)) {
             const pos = getMousePos(e);
             // Simple drag implementation (centering on mouse for simplicity in this version)
             // A robust version would calculate offsets.
             setElements(prev => prev.map(el => {
                 if (el.id === selectedElementId) {
                     return { ...el, x: pos.x - el.width/2, y: pos.y - el.height/2 };
                 }
                 return el;
             }));
        }
        return;
    }

    const pos = getMousePos(e);
    const width = pos.x - startPos.x;
    const height = pos.y - startPos.y;

    setElements(prev => prev.map(el => {
      if (el.id === currentShapeId) {
        return {
          ...el,
          width: Math.abs(width),
          height: Math.abs(height),
          x: width < 0 ? pos.x : startPos.x,
          y: height < 0 ? pos.y : startPos.y,
          // For lines, we might store x2/y2 in w/h or separate fields, keeping it simple with rect bounds for now or standard shape logic
        };
      }
      return el;
    }));
  };

  const handleMouseUp = () => {
    setIsDrawing(false);
    if (currentShapeId) {
        setSelectedElementId(currentShapeId);
        setCurrentShapeId(null);
        setSelectedTool('select'); // Switch back to select after drawing
    }
  };

  const handleElementClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (selectedTool === 'select') {
      setSelectedElementId(id);
    }
  };

  const handleDelete = () => {
    if (selectedElementId) {
      setElements(prev => prev.filter(el => el.id !== selectedElementId));
      setSelectedElementId(null);
    }
  };

  const handleTextChange = (text: string) => {
    if (selectedElementId) {
      setElements(prev => prev.map(el => el.id === selectedElementId ? { ...el, text } : el));
    }
  };

  const handleColorChange = (type: 'fill' | 'stroke', color: string) => {
    if (type === 'fill') setFillColor(color);
    else setStrokeColor(color);

    if (selectedElementId) {
      setElements(prev => prev.map(el => el.id === selectedElementId ? { ...el, [type]: color } : el));
    }
  };

  // --- Render Helper ---
  const renderElement = (el: DrawingElement) => {
    const isSelected = el.id === selectedElementId;
    const style = { cursor: selectedTool === 'select' ? 'move' : 'default' };
    const commonProps = {
        stroke: el.stroke,
        strokeWidth: 2,
        fill: el.fill,
        onMouseDown: (e: React.MouseEvent) => handleElementClick(e, el.id),
        style
    };

    const selectionRing = isSelected ? (
        <rect x={el.x - 2} y={el.y - 2} width={el.width + 4} height={el.height + 4} fill="none" stroke="#3b82f6" strokeWidth="1" strokeDasharray="4 2" pointerEvents="none"/>
    ) : null;

    let shape;
    const centerX = el.x + el.width / 2;
    const centerY = el.y + el.height / 2;

    switch (el.type) {
        case 'rect':
            shape = <rect x={el.x} y={el.y} width={el.width} height={el.height} {...commonProps} />;
            break;
        case 'circle':
            shape = <ellipse cx={centerX} cy={centerY} rx={el.width / 2} ry={el.height / 2} {...commonProps} />;
            break;
        case 'diamond':
            const points = `${centerX},${el.y} ${el.x + el.width},${centerY} ${centerX},${el.y + el.height} ${el.x},${centerY}`;
            shape = <polygon points={points} {...commonProps} />;
            break;
        case 'line':
            shape = <line x1={el.x} y1={el.y} x2={el.x + el.width} y2={el.y + el.height} {...commonProps} />;
            break;
        case 'text':
            shape = null; // Text rendered below
            break;
        default: return null;
    }

    return (
        <g key={el.id}>
            {shape}
            {el.text && (
                <text 
                    x={centerX} 
                    y={centerY} 
                    dy=".3em" 
                    textAnchor="middle" 
                    fill={el.stroke} 
                    fontSize="14" 
                    fontFamily="sans-serif"
                    pointerEvents="none"
                    style={{ userSelect: 'none' }}
                >
                    {el.text}
                </text>
            )}
            {selectionRing}
        </g>
    );
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
      <div className="bg-white w-full max-w-6xl h-[90vh] rounded-xl shadow-2xl flex flex-col overflow-hidden border border-gray-300">
        
        {/* Header / Toolbar */}
        <div className="bg-gray-50 border-b border-gray-200 p-2 flex items-center justify-between">
            <div className="flex items-center gap-4">
                <input 
                    value={title} 
                    onChange={(e) => setTitle(e.target.value)}
                    className="font-bold text-lg bg-transparent border-b border-transparent hover:border-gray-300 focus:border-blue-500 outline-none px-1"
                />
                <div className="h-6 w-[1px] bg-gray-300 mx-2"></div>
                
                {/* Shape Tools */}
                <div className="flex bg-white border border-gray-200 rounded-lg p-1 shadow-sm">
                    {TOOLS.map(tool => (
                        <button
                            key={tool.id}
                            onClick={() => setSelectedTool(tool.id)}
                            className={`p-2 rounded transition-colors ${selectedTool === tool.id ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100 text-gray-600'}`}
                            title={tool.label}
                        >
                            <tool.icon size={18} />
                        </button>
                    ))}
                </div>

                {/* Properties */}
                <div className="flex items-center gap-2 ml-4">
                    <div className="flex flex-col">
                        <label className="text-[0.6875rem] text-gray-500 uppercase">{t.labels.fill}</label>
                        <input type="color" value={fillColor} onChange={(e) => handleColorChange('fill', e.target.value)} className="w-8 h-6 p-0 border border-gray-300 rounded cursor-pointer"/>
                    </div>
                    <div className="flex flex-col">
                        <label className="text-[0.6875rem] text-gray-500 uppercase">{t.labels.stroke}</label>
                        <input type="color" value={strokeColor} onChange={(e) => handleColorChange('stroke', e.target.value)} className="w-8 h-6 p-0 border border-gray-300 rounded cursor-pointer"/>
                    </div>
                    {selectedElementId && (
                        <>
                            <input 
                                type="text" 
                                placeholder={t.labels.textPlaceholder}
                                className="border border-gray-300 rounded px-2 py-1 text-sm ml-2"
                                value={elements.find(e => e.id === selectedElementId)?.text || ''}
                                onChange={(e) => handleTextChange(e.target.value)}
                            />
                            <button onClick={handleDelete} className="p-2 text-red-500 hover:bg-red-50 rounded ml-2"><Trash2 size={18}/></button>
                        </>
                    )}
                </div>
            </div>

            <div className="flex items-center gap-2">
                <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded font-medium">{t.cancel}</button>
                <button 
                    onClick={() => onSave(title, elements)}
                    className="px-4 py-2 bg-blue-600 text-white rounded font-medium hover:bg-blue-700 flex items-center gap-2 shadow-sm"
                >
                    <Save size={16} /> {t.save}
                </button>
            </div>
        </div>

        {/* Canvas Area */}
        <div className="flex-1 bg-[#f8fafc] overflow-auto relative cursor-crosshair">
            <svg 
                ref={svgRef}
                className="w-full h-full min-w-[2000px] min-h-[2000px]"
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
            >
                <defs>
                    <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                        <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#e2e8f0" strokeWidth="0.5"/>
                    </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#grid)" />
                
                {elements.map(renderElement)}
            </svg>
        </div>
      </div>
    </div>
  );
};

export default DrawingModal;
