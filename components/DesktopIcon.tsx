
import React from 'react';

interface DesktopIconProps {
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
}

export const DesktopIcon: React.FC<DesktopIconProps> = ({ label, icon, onClick }) => {
    return (
        <button 
            onClick={onClick}
            className="flex flex-col items-center gap-3 w-24 p-2 rounded-xl hover:bg-white/5 focus:bg-white/10 transition-all group outline-none"
        >
            <div className="w-16 h-16 bg-gradient-to-br from-slate-800 to-slate-950 rounded-2xl flex items-center justify-center border border-white/10 shadow-lg group-hover:scale-105 group-hover:border-cyan-500/50 group-hover:shadow-[0_0_25px_rgba(34,211,238,0.2)] transition-all duration-300 relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                <div className="text-cyan-500 group-hover:text-cyan-400 transition-colors duration-300 z-10">
                    {icon}
                </div>
            </div>
            <span className="text-[10px] font-bold text-slate-300 bg-black/60 px-2.5 py-1 rounded-md shadow-sm group-hover:text-white group-hover:bg-cyan-950/80 transition-all backdrop-blur-md truncate max-w-full border border-transparent group-hover:border-cyan-500/30 tracking-tight shadow-black">
                {label}
            </span>
        </button>
    );
};
