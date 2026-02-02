
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { 
  Upload, 
  FileSpreadsheet, 
  Download, 
  RefreshCw, 
  CheckCircle2, 
  AlertCircle, 
  Settings2,
  Image as ImageIcon,
  FolderOpen,
  ArrowRight,
  ShieldAlert,
  Loader2,
  Calendar,
  Filter,
  CheckSquare,
  Square
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { ImageTask, ProcessingStats, ExcelRow } from './types';
import { normalizeName, formatBytes } from './utils';

const MAX_CONCURRENT_DOWNLOADS = 10;
const COLORS = ['#10b981', '#ef4444', '#f59e0b', '#64748b'];

const App: React.FC = () => {
  const [tasks, setTasks] = useState<ImageTask[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isGeneratingZip, setIsGeneratingZip] = useState(false);
  const [excelFile, setExcelFile] = useState<File | null>(null);
  
  // Filter States
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  const [activeTab, setActiveTab] = useState<'upload' | 'process' | 'results'>('upload');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Helper to parse Excel dates correctly
  const parseExcelDate = (val: any): Date | null => {
    if (!val) return null;
    if (typeof val === 'number') {
      // Excel numeric date format
      return XLSX.SSF.parse_date_code(val) ? new Date(Math.round((val - 25569) * 86400 * 1000)) : null;
    }
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  };

  // Parse Excel File
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setExcelFile(file);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
        
        const allTasks: ImageTask[] = [];

        workbook.SheetNames.forEach(sheetName => {
          const worksheet = workbook.Sheets[sheetName];
          const jsonData = XLSX.utils.sheet_to_json<ExcelRow>(worksheet);

          jsonData.forEach((row, index) => {
            const fullName = row['Full Name'];
            const url = row['Image URL'];
            const regDateRaw = row['Registration Date'];
            const regDate = parseExcelDate(regDateRaw);

            if (fullName && url) {
              const normalized = normalizeName(fullName.toString());
              allTasks.push({
                id: `${sheetName}-${index}-${Date.now()}`,
                sheet: sheetName,
                fullName: fullName.toString().trim(),
                url: url.toString().trim(),
                filename: `${normalized}.jpg`,
                registrationDate: regDate,
                isSelected: true,
                status: 'pending'
              });
            }
          });
        });

        if (allTasks.length === 0) {
          alert("No valid rows found. Ensure columns 'Full Name' and 'Image URL' exist.");
          return;
        }

        setTasks(allTasks);
        setActiveTab('process');
      } catch (err) {
        console.error("Excel parse error", err);
        alert("Failed to parse Excel file.");
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const stats = useMemo<ProcessingStats>(() => {
    return {
      total: tasks.length,
      completed: tasks.filter(t => t.status === 'completed').length,
      failed: tasks.filter(t => t.status === 'failed').length,
      skipped: tasks.filter(t => t.status === 'skipped').length,
      pending: tasks.filter(t => t.status === 'pending' && t.isSelected).length,
      selected: tasks.filter(t => t.isSelected).length
    };
  }, [tasks]);

  const applyDateFilter = () => {
    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;
    
    setTasks(prev => prev.map(task => {
      if (!task.registrationDate) return { ...task, isSelected: !start && !end };
      
      let isMatch = true;
      if (start && task.registrationDate < start) isMatch = false;
      if (end && task.registrationDate > end) isMatch = false;
      
      return { ...task, isSelected: isMatch };
    }));
  };

  const toggleSelection = (id: string) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, isSelected: !t.isSelected } : t));
  };

  const toggleAll = (select: boolean) => {
    setTasks(prev => prev.map(t => ({ ...t, isSelected: select })));
  };

  // Main Download Logic
  const startProcessing = async () => {
    if (stats.selected === 0) {
      alert("Please select at least one person to download.");
      return;
    }

    setIsProcessing(true);
    
    // Create a working copy
    const currentTasks = [...tasks];
    const queue = currentTasks.filter(t => t.status === 'pending' && t.isSelected);
    const activeDownloads = new Set();

    const processQueue = async () => {
      const remaining = [...queue];
      
      const downloadNext = async (): Promise<void> => {
        if (remaining.length === 0) return;
        
        const task = remaining.shift();
        if (!task) return;

        activeDownloads.add(task.id);
        
        try {
          const result = await downloadImage(task);
          setTasks(prev => prev.map(t => t.id === task.id ? result : t));
        } finally {
          activeDownloads.delete(task.id);
          await downloadNext();
        }
      };

      // Start initial batch
      const initialBatch = Array.from({ length: Math.min(MAX_CONCURRENT_DOWNLOADS, remaining.length) })
        .map(() => downloadNext());
        
      await Promise.all(initialBatch);
    };

    await processQueue();
    
    // Final safety check for any remaining active downloads
    while (activeDownloads.size > 0) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    setIsProcessing(false);
    setActiveTab('results');
  };

  const downloadImage = async (task: ImageTask): Promise<ImageTask> => {
    try {
      const response = await fetch(task.url, { mode: 'cors' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      
      const blob = await response.blob();
      if (!blob.type.startsWith('image/') && blob.size < 100) {
         throw new Error('Invalid image file or access denied');
      }

      return { ...task, status: 'completed', blob };
    } catch (error: any) {
      const errorMessage = error.message.includes('Failed to fetch') 
        ? 'CORS/Network Error' 
        : error.message;
      return { ...task, status: 'failed', error: errorMessage };
    }
  };

  const generateZip = async () => {
    setIsGeneratingZip(true);
    try {
      const zip = new JSZip();
      const completedTasks = tasks.filter(t => t.status === 'completed' && t.blob);
      
      if (completedTasks.length === 0) {
        alert("No images were successfully downloaded.");
        setIsGeneratingZip(false);
        return;
      }

      completedTasks.forEach(task => {
        const folder = zip.folder(task.sheet);
        if (folder && task.blob) {
          folder.file(task.filename, task.blob);
        }
      });

      const failedTasks = tasks.filter(t => t.status === 'failed' && t.isSelected);
      if (failedTasks.length > 0) {
        let csvContent = "Sheet,Full Name,Filename,URL,Error\n";
        failedTasks.forEach(t => {
          csvContent += `"${t.sheet}","${t.fullName}","${t.filename}","${t.url}","${t.error}"\n`;
        });
        zip.file("failures_report.csv", csvContent);
      }

      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Cvent_Batch_${new Date().toISOString().split('T')[0]}.zip`;
      document.body.appendChild(link);
      link.click();
      
      setTimeout(() => {
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }, 100);

    } catch (error) {
      console.error("ZIP Generation error", error);
      alert("Error generating ZIP.");
    } finally {
      setIsGeneratingZip(false);
    }
  };

  const reset = () => {
    if (isProcessing && !confirm("Processing is active. Reset anyway?")) return;
    setTasks([]);
    setExcelFile(null);
    setStartDate('');
    setEndDate('');
    setActiveTab('upload');
  };

  const chartData = [
    { name: 'Completed', value: stats.completed },
    { name: 'Failed', value: stats.failed },
    { name: 'Skipped', value: stats.skipped },
    { name: 'Pending', value: stats.pending },
  ].filter(d => d.value > 0);

  const processedCount = stats.completed + stats.failed + stats.skipped;
  const progressPercentage = stats.selected > 0 ? (processedCount / stats.selected) * 100 : 0;

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-8">
      {/* Header */}
      <header className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
            <div className="bg-blue-600 p-2 rounded-lg">
              <ImageIcon className="text-white w-6 h-6" />
            </div>
            Cvent Image Batcher
          </h1>
          <p className="text-slate-500 mt-1">Bulk process attendee images with date filtering</p>
        </div>
        
        <div className="flex items-center gap-2">
          {excelFile && (
            <button 
              onClick={reset}
              className="px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors flex items-center gap-2 shadow-sm"
            >
              <RefreshCw className="w-4 h-4" /> Reset
            </button>
          )}
        </div>
      </header>

      {/* Tabs */}
      <nav className="flex mb-8 bg-white p-1 rounded-xl shadow-sm border border-slate-200">
        <button onClick={() => excelFile && setActiveTab('upload')} className={`flex-1 py-3 px-4 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2 ${activeTab === 'upload' ? 'bg-blue-50 text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
          <Upload className="w-4 h-4" /> 1. Upload
        </button>
        <button onClick={() => tasks.length > 0 && setActiveTab('process')} className={`flex-1 py-3 px-4 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2 ${activeTab === 'process' ? 'bg-blue-50 text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`} disabled={tasks.length === 0}>
          <Settings2 className="w-4 h-4" /> 2. Filter & Process
        </button>
        <button onClick={() => (stats.completed > 0 || stats.failed > 0) && setActiveTab('results')} className={`flex-1 py-3 px-4 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2 ${activeTab === 'results' ? 'bg-blue-50 text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`} disabled={stats.completed === 0 && stats.failed === 0}>
          <Download className="w-4 h-4" /> 3. Export
        </button>
      </nav>

      {/* Main Content Area */}
      <main className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden min-h-[500px]">
        
        {activeTab === 'upload' && (
          <div className="p-12 flex flex-col items-center justify-center h-full text-center">
            <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mb-6">
              <FileSpreadsheet className="w-10 h-10 text-blue-600" />
            </div>
            <h2 className="text-2xl font-bold text-slate-800 mb-2">Excel Data Import</h2>
            <p className="text-slate-500 max-w-md mb-8">
              Supports columns: <b>Full Name</b>, <b>Image URL</b>, and <b>Registration Date</b>.
            </p>
            <label className="cursor-pointer">
              <input type="file" className="hidden" accept=".xlsx, .xls" onChange={handleFileUpload} />
              <div className="px-8 py-4 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-all shadow-lg flex items-center gap-3">
                <Upload className="w-5 h-5" /> Select File
              </div>
            </label>
          </div>
        )}

        {activeTab === 'process' && (
          <div className="p-8">
            {/* Filter Panel */}
            <div className="mb-8 grid grid-cols-1 md:grid-cols-4 gap-6 bg-slate-50 p-6 rounded-2xl border border-slate-200">
              <div className="md:col-span-1">
                <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Date Filter</label>
                <div className="flex flex-col gap-3">
                  <div className="relative">
                    <Calendar className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                    <input 
                      type="date" 
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-sm"
                      placeholder="Start"
                    />
                  </div>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                    <input 
                      type="date" 
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-sm"
                      placeholder="End"
                    />
                  </div>
                  <button 
                    onClick={applyDateFilter}
                    className="w-full py-2 bg-slate-800 text-white text-sm font-bold rounded-lg hover:bg-black transition-colors flex items-center justify-center gap-2"
                  >
                    <Filter className="w-4 h-4" /> Apply Date Filter
                  </button>
                </div>
              </div>

              <div className="md:col-span-3">
                <div className="flex justify-between items-center mb-4">
                   <label className="block text-xs font-bold text-slate-500 uppercase">Selection Progress</label>
                   <span className="text-xs font-bold text-blue-600">{stats.selected} of {stats.total} selected</span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-3 mb-6">
                  <div className="bg-blue-600 h-3 rounded-full transition-all" style={{ width: `${(stats.selected / stats.total) * 100}%` }}></div>
                </div>
                
                <div className="flex gap-4">
                  <button onClick={() => toggleAll(true)} className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium hover:bg-slate-50">Select All</button>
                  <button onClick={() => toggleAll(false)} className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium hover:bg-slate-50">Deselect All</button>
                </div>
              </div>
            </div>

            {/* Task Area */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-1 space-y-6">
                <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200">
                   <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                    <CheckCircle2 className="text-blue-600 w-5 h-5" /> Download Queue
                  </h3>
                  <div className="h-40 w-full mb-4">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={chartData} innerRadius={50} outerRadius={65} paddingAngle={5} dataKey="value">
                          {chartData.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 bg-white rounded-lg border border-slate-100 text-center">
                      <p className="text-[10px] text-slate-400 uppercase font-bold">Selected</p>
                      <p className="text-lg font-bold">{stats.selected}</p>
                    </div>
                    <div className="p-3 bg-white rounded-lg border border-slate-100 text-center">
                      <p className="text-[10px] text-emerald-500 uppercase font-bold">Success</p>
                      <p className="text-lg font-bold">{stats.completed}</p>
                    </div>
                  </div>
                </div>

                {!isProcessing ? (
                  <button onClick={startProcessing} className="w-full py-4 bg-blue-600 text-white font-bold rounded-xl shadow-lg hover:bg-blue-700 transition-all flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed" disabled={stats.selected === 0}>
                    Start Downloading <ArrowRight className="w-5 h-5" />
                  </button>
                ) : (
                  <div className="w-full py-4 bg-slate-100 text-slate-500 font-bold rounded-xl flex items-center justify-center gap-3">
                    <RefreshCw className="w-5 h-5 animate-spin" /> {Math.round(progressPercentage)}% Complete
                  </div>
                )}
              </div>

              <div className="lg:col-span-2">
                <div className="border border-slate-200 rounded-xl overflow-hidden overflow-y-auto max-h-[600px]">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
                      <tr>
                        <th className="p-4 w-10"></th>
                        <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase">Attendee</th>
                        <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase">Reg Date</th>
                        <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {tasks.map((task) => (
                        <tr key={task.id} className={`${task.isSelected ? 'bg-white' : 'bg-slate-50 opacity-60'} transition-all`}>
                          <td className="p-4">
                            <button onClick={() => toggleSelection(task.id)} className="text-blue-600">
                              {task.isSelected ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5 text-slate-300" />}
                            </button>
                          </td>
                          <td className="px-4 py-3">
                            <p className="text-sm font-bold text-slate-800">{task.fullName}</p>
                            <p className="text-[10px] text-slate-400 font-mono truncate max-w-[150px]">{task.sheet}</p>
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-600">
                            {task.registrationDate?.toLocaleDateString() || '--'}
                          </td>
                          <td className="px-4 py-3"><StatusBadge status={task.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'results' && (
          <div className="p-12 text-center flex flex-col items-center">
            <div className="w-20 h-20 bg-emerald-50 rounded-full flex items-center justify-center mb-6">
              <CheckCircle2 className="w-10 h-10 text-emerald-600" />
            </div>
            <h2 className="text-3xl font-bold text-slate-800 mb-2">All Set!</h2>
            <p className="text-slate-500 mb-10 max-w-md">Processed {stats.selected} selected items.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-2xl">
              <button 
                className={`p-8 bg-white border-2 rounded-2xl flex flex-col items-center text-center transition-all ${isGeneratingZip ? 'border-slate-200 opacity-50 cursor-not-allowed' : 'border-blue-100 hover:border-blue-500 hover:bg-blue-50/30 shadow-sm group'}`} 
                onClick={!isGeneratingZip ? generateZip : undefined}
                disabled={isGeneratingZip}
              >
                <div className={`w-16 h-16 rounded-xl flex items-center justify-center mb-4 transition-transform ${isGeneratingZip ? 'bg-slate-100' : 'bg-blue-600 group-hover:scale-110 shadow-lg'}`}>
                  {isGeneratingZip ? <Loader2 className="text-slate-400 w-8 h-8 animate-spin" /> : <Download className="text-white w-8 h-8" />}
                </div>
                <h4 className="font-bold text-xl text-slate-800">Download ZIP</h4>
                <p className="text-sm text-slate-500 mt-2">Packaged folders for Cvent upload</p>
              </button>
              <div className="p-8 bg-white border-2 border-slate-100 rounded-2xl flex flex-col items-center text-center">
                <div className="w-16 h-16 bg-slate-50 rounded-xl flex items-center justify-center mb-4">
                  <AlertCircle className={`w-8 h-8 ${stats.failed > 0 ? 'text-rose-500' : 'text-slate-300'}`} />
                </div>
                <h4 className="font-bold text-xl text-slate-800">Failed: {stats.failed}</h4>
                {stats.failed > 0 && <p className="text-xs text-rose-600 mt-2">Check failure_report.csv in the ZIP.</p>}
              </div>
            </div>
            <button onClick={reset} className="mt-12 text-slate-400 font-medium hover:text-blue-600">Start New Batch</button>
          </div>
        )}
      </main>
    </div>
  );
};

const StatusBadge: React.FC<{ status: ImageTask['status'] }> = ({ status }) => {
  switch (status) {
    case 'completed': return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800">DONE</span>;
    case 'failed': return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black bg-rose-100 text-rose-800">ERROR</span>;
    case 'downloading': return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black bg-blue-100 text-blue-800 animate-pulse">BUSY</span>;
    default: return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black bg-slate-100 text-slate-400">WAIT</span>;
  }
};

export default App;
