
import React, { useState, useRef, useEffect, memo } from 'react';
import { X, Minus, Square, Maximize2, Copy } from 'lucide-react';
import { SystemLogger } from '../services/Logger';

interface VWindowProps {
    id: string;
    title: string;
    icon?: React.ReactNode;
    children: React.ReactNode;
    initialX?: number;
    initialY?: number;
    initialW?: number;
    initialH?: number;
    zIndex: number;
    isFocused?: boolean;
    isMaximized?: boolean;
    onClose: (id: string) => void;
    onMinimize: (id: string) => void;
    onFocus: (id: string) => void;
    onMaximize: (id: string) => void;
}

const VWindow: React.FC<VWindowProps> = memo(({ 
    id, title, icon, children, 
    initialX = 100, initialY = 100, initialW = 800, initialH = 600, 
    zIndex, isFocused = false, isMaximized, onClose, onMinimize, onFocus, onMaximize
}) => {
    const [pos, setPos] = useState({ x: initialX, y: initialY });
    const [size, setSize] = useState({ w: initialW, h: initialH });
    const [isDragging, setIsDragging] = useState(false);
    const [isResizing, setIsResizing] = useState(false);
    const windowRef = useRef<HTMLDivElement>(null);
    const dragStart = useRef({ x: 0, y: 0 });

    useEffect(() => {
        const handleMove = (e: MouseEvent) => {
            if (isMaximized) return;
            if (isDragging) {
                setPos({
                    x: Math.max(0, Math.min(window.innerWidth - 200, e.clientX - dragStart.current.x)),
                    y: Math.max(0, Math.min(window.innerHeight - 72, e.clientY - dragStart.current.y))
                });
            }
            if (isResizing) {
                setSize({
                    w: Math.max(200, Math.min(window.innerWidth - pos.x - 16, e.clientX - pos.x)),
                    h: Math.max(150, Math.min(window.innerHeight - pos.y - 72, e.clientY - pos.y))
                });
            }
        };
        const handleUp = () => {
            setIsDragging(false);
            setIsResizing(false);
            document.body.style.cursor = 'default';
        };
        if (isDragging || isResizing) {
            window.addEventListener('mousemove', handleMove, { passive: true });
            window.addEventListener('mouseup', handleUp);
        }
        return () => {
            window.removeEventListener('mousemove', handleMove);
            window.removeEventListener('mouseup', handleUp);
        };
    }, [isDragging, isResizing, pos, isMaximized]);

    const hasFocus = isFocused || Boolean(isMaximized);

    const toggleBrowserFullscreen = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!windowRef.current) return;
        if (!document.fullscreenElement) {
            windowRef.current.requestFullscreen().catch(err => {
                SystemLogger.log('Window', 'Browser fullscreen request was rejected.', 'warn', err);
            });
        } else {
            document.exitFullscreen();
        }
    };

    return (
        <div 
            ref={windowRef}
            onMouseDown={() => onFocus(id)}
            className={`absolute flex flex-col glass silicon-border rounded-xl shadow-[0_12px_40px_rgba(0,0,0,0.8)] overflow-hidden transition-all duration-200 gpu-sync
                ${isDragging ? 'opacity-80 scale-[1.001]' : 'opacity-100'} 
                ${isMaximized ? 'inset-0 !w-full !h-full !translate-x-0 !translate-y-0 rounded-none z-[1000]' : ''}
                ${hasFocus ? 'window-focus border-cyan-500/40 ring-1 ring-cyan-500/10' : 'border-slate-800/40 opacity-95 grayscale-[0.1]'}
            `}
            style={{ 
                transform: isMaximized ? 'none' : `translate3d(${pos.x}px, ${pos.y}px, 0)`,
                width: isMaximized ? '100%' : size.w, 
                height: isMaximized ? '100%' : size.h, 
                maxWidth: isMaximized ? '100%' : 'calc(100vw - 48px)',
                maxHeight: isMaximized ? '100%' : 'calc(100vh - 112px)',
                zIndex: isMaximized ? 1000 : zIndex,
                willChange: (isDragging || isResizing) ? 'transform, width, height' : 'auto'
            }}
        >
            <div 
                onMouseDown={(e) => {
                    if (isMaximized) return;
                    setIsDragging(true);
                    dragStart.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
                    onFocus(id);
                }}
                onDoubleClick={() => onMaximize(id)}
                className={`h-8 flex items-center px-3 cursor-move select-none shrink-0 group transition-colors border-b border-white/5
                    ${hasFocus ? 'bg-slate-800/60' : 'bg-slate-950/40'}
                `}
            >
                <div className="flex items-center gap-2.5 flex-1">
                    <div className={`${hasFocus ? 'text-cyan-400 animate-pulse' : 'text-slate-600'} transition-colors`}>{icon}</div>
                    <span className={`text-[9px] font-black tracking-[0.4em] uppercase truncate transition-colors ${hasFocus ? 'text-white' : 'text-slate-600'}`}>
                        {title}
                    </span>
                </div>
                <div className="flex items-center gap-1.5" onMouseDown={e => e.stopPropagation()}>
                    <button aria-label="Enter browser fullscreen" title="Browser fullscreen" onClick={toggleBrowserFullscreen} className="p-1.5 hover:bg-cyan-500/20 rounded-lg text-slate-500 hover:text-cyan-400 transition-all">
                        <Maximize2 className="w-3 h-3"/>
                    </button>
                    <button aria-label="Minimize window" title="Minimize" onClick={() => onMinimize(id)} className="p-1.5 hover:bg-white/10 rounded-lg text-slate-500 hover:text-slate-300 transition-all">
                        <Minus className="w-3 h-3"/>
                    </button>
                    <button aria-label={isMaximized ? 'Restore window' : 'Maximize window'} title={isMaximized ? 'Restore' : 'Maximize'} onClick={() => onMaximize(id)} className="p-1.5 hover:bg-white/10 rounded-lg text-slate-500 hover:text-slate-300 transition-all">
                        {isMaximized ? <Copy className="w-3 h-3 rotate-180"/> : <Square className="w-3 h-3"/>}
                    </button>
                    <button aria-label="Close window" title="Close" onClick={() => onClose(id)} className="p-1.5 hover:bg-red-500/30 rounded-lg text-slate-500 hover:text-red-400 transition-all ml-1">
                        <X className="w-3 h-3"/>
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-auto relative bg-[#05070c]/95">
                {children}
            </div>

            {!isMaximized && (
                <div 
                    onMouseDown={(e) => {
                        e.stopPropagation();
                        setIsResizing(true);
                        document.body.style.cursor = 'nwse-resize';
                        onFocus(id);
                    }}
                    className="absolute bottom-0 right-0 w-6 h-6 cursor-nwse-resize z-[600] flex items-center justify-center group"
                >
                    <div className="absolute bottom-1.5 right-1.5 w-2 h-2 border-r-2 border-b-2 border-slate-700 transition-all group-hover:border-cyan-500 group-hover:scale-125"></div>
                </div>
            )}
        </div>
    );
});

export default VWindow;
