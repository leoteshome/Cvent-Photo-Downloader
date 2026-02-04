
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
  ArrowRight,
  Loader2,
  Calendar,
  Filter,
  CheckSquare,
  Square,
  Moon,
  Sun,
  Layers,
  X,
  RotateCcw
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { ImageTask, ProcessingStats, ExcelRow } from './types';
import { normalizeName } from './utils';

const MAX_CONCURRENT_DOWNLOADS = 10;
const COLORS = ['#10b981', '#ef4444', '#f59e0b', '#64748b'];

const App: React.FC = () => {
  // --- State Management ---
  const [tasks, setTasks] = useState<ImageTask[]>([]);
  const [availableSheets, setAvailableSheets] = useState<string[]>([]);
  const [selectedSheets, setSelectedSheets] = useState<Set<string>>(new Set());
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [isGeneratingZip, setIsGeneratingZip] = useState(false);
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(false);
  
  // Filters
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  const [activeTab, setActiveTab] = useState<'upload' | 'process' | 'results'>('upload');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Effects ---

  // Handle Dark Mode
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  // Apply Filters automatically when inputs change
  useEffect(() => {
    if (tasks.length === 0) return;

    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;
    if (end) end.setHours(23, 59, 59, 999); // End of day

    setTasks(prev => prev.map(task => {
      let isMatch = true;

      // 1. Sheet Filter
      if (!selectedSheets.has(task.sheet)) {
        isMatch = false;
      }

      // 2. Date Filter
      if (isMatch && task.registrationDate) {
         if (start && task.registrationDate < start) isMatch = false;
         if (end && task.registrationDate > end) isMatch = false;
      } else if (isMatch && !task.registrationDate) {
         // If task has no date, it is excluded ONLY if a filter is active
         if (start || end) isMatch = false; 
      }

      // Don't modify completed/failed tasks selection state to preserve history, 
      // unless we want to filter visual lists. For now, we only select pending items for processing.
      // But user might want to re-download. Let's just toggle isSelected.
      return { ...task, isSelected: isMatch };
    }));

  }, [startDate, endDate, selectedSheets]); // Removed tasks dependency to avoid loops, logic handled inside setter if needed, but here we just update 'isSelected'

  // --- Helpers ---

  const parseExcelDate = (val: any): Date | null => {
    if (!val) return null;
    if (typeof val === 'number') {
      return XLSX.SSF.parse_date_code(val) ? new Date(Math.round((val - 25569) * 86400 * 1000)) : null;
    }
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
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

  // --- Handlers ---

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
        const sheets: string[] = [];

        workbook.SheetNames.forEach(sheetName => {
          sheets.push(sheetName);
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

        setAvailableSheets(sheets);
        setSelectedSheets(new Set(sheets));
        setTasks(allTasks);
        setActiveTab('process');
      } catch (err) {
        console.error("Excel parse error", err);
        alert("Failed to parse Excel file.");
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const toggleSheet = (sheet: string) => {
    const next = new Set(selectedSheets);
    if (next.has(sheet)) next.delete(sheet);
    else next.add(sheet);
    setSelectedSheets(next);
  };

  const toggleAllSheets = (select: boolean) => {
    if (select) setSelectedSheets(new Set(availableSheets));
    else setSelectedSheets(new Set());
  };

  const clearFilters = () => {
    setStartDate('');
    setEndDate('');
    setSelectedSheets(new Set(availableSheets));
  };

  const toggleTaskSelection = (id: string) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, isSelected: !t.isSelected } : t));
  };

  const toggleAllTasks = (select: boolean) => {
    setTasks(prev => prev.map(t => ({ ...t, isSelected: select })));
  };

  const startProcessing = async () => {
    if (stats.selected === 0) {
      alert("Please select at least one person to download.");
      return;
    }

    setIsProcessing(true);
    
    // Process queue
    const queue = tasks.filter(t => t.status === 'pending' && t.isSelected);
    const activeDownloads = new Set();

    const processQueue = async () => {
      const remaining = [...queue];
      
      const downloadNext = async (): Promise<void> => {
        if (remaining.length === 0) return;
        const task = remaining.shift();
        if (!task) return;

        activeDownloads.add(task.id);
        
        try {
          // Optimization: Update state locally then flush? 
          // For React simpler to just update individual item in list
          const result = await downloadImage(task);
          setTasks(prev => prev.map(t => t.id === task.id ? result : t));
        } finally {
          activeDownloads.delete(task.id);
          await downloadNext();
        }
      };

      const initialBatch = Array.from({ length: Math.min(MAX_CONCURRENT_DOWNLOADS, remaining.length) })
        .map(() => downloadNext());
        
      await Promise.all(initialBatch);
    };

    await processQueue();
    
    // Drain
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
      if (!blob.type.startsWith('image/') && blob.size < 100) throw new Error('Invalid image');
      return { ...task, status: 'completed', blob };
    } catch (error: any) {
      return { ...task, status: 'failed', error: error.message.includes('Failed to fetch') ? 'CORS/Network Error' : error.message };
    }
  };

  const generateZip = async () => {
    setIsGeneratingZip(true);
    try {
      const zip = new JSZip();
      const completedTasks = tasks.filter(t => t.status === 'completed' && t.blob);
      
      if (completedTasks.length === 0) {
        alert("No images available to zip.");
        setIsGeneratingZip(false);
        return;
      }

      completedTasks.forEach(task => {
        // Always group by Sheet Name as per standard Cvent requirement
        const folder = zip.folder(task.sheet);
        if (folder && task.blob) {
          folder.file(task.filename, task.blob);
        }
      });

      const failedTasks = tasks.filter(t => t.status === 'failed' && t.isSelected);
      if (failedTasks.length > 0) {
        let csvContent = "Sheet,Full Name,Filename,URL,Error,RegistrationDate\n";
        failedTasks.forEach(t => {
          const dateStr = t.registrationDate ? t.registrationDate.toISOString().split('T')[0] : '';
          csvContent += `"${t.sheet}","${t.fullName}","${t.filename}","${t.url}","${t.error}","${dateStr}"\n`;
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
      console.error(error);
      alert("Error generating ZIP.");
    } finally {
      setIsGeneratingZip(false);
    }
  };

  const reset = () => {
    if (isProcessing) return;
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

  // --- Render Components ---

  return (
    <div className="min-h-screen transition-colors duration-300">
      <div className="max-w-7xl mx-auto p-4 md:p-8">
        
        {/* Header */}
        <header className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="bg-gradient-to-br from-blue-600 to-indigo-600 p-3 rounded-2xl shadow-lg shadow-blue-500/20">
              <ImageIcon className="text-white w-8 h-8" />
            </div>
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-slate-900 to-slate-600 dark:from-white dark:to-slate-400">
                Cvent Batcher
              </h1>
              <p className="text-slate-500 dark:text-slate-400 text-sm font-medium">Automated Image Processing</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setIsDarkMode(!isDarkMode)}
              className="p-3 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-all shadow-sm"
            >
              {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
            {excelFile && (
              <button 
                onClick={reset}
                disabled={isProcessing}
                className="px-5 py-2.5 text-sm font-semibold text-slate-600 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors flex items-center gap-2 shadow-sm"
              >
                <RefreshCw className="w-4 h-4" /> Reset
              </button>
            )}
          </div>
        </header>

        {/* Navigation Stepper */}
        <nav className="flex mb-8 bg-white/50 dark:bg-slate-900/50 backdrop-blur-xl p-1.5 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800">
          {[
            { id: 'upload', icon: Upload, label: 'Upload' },
            { id: 'process', icon: Settings2, label: 'Filter & Process', disabled: tasks.length === 0 },
            { id: 'results', icon: Download, label: 'Download', disabled: stats.completed === 0 && stats.failed === 0 }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => !tab.disabled && setActiveTab(tab.id as any)}
              disabled={tab.disabled}
              className={`flex-1 py-3 px-4 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2
                ${activeTab === tab.id 
                  ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-md ring-1 ring-slate-200 dark:ring-slate-700' 
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                } ${tab.disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <tab.icon className="w-4 h-4" /> 
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
        </nav>

        {/* Content Area */}
        <main className="bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl rounded-3xl shadow-2xl shadow-slate-200/50 dark:shadow-black/50 border border-white/20 dark:border-slate-800 overflow-hidden min-h-[600px] relative">
          
          {/* 1. Upload View */}
          {activeTab === 'upload' && (
            <div className="p-12 flex flex-col items-center justify-center h-[600px] text-center animate-in fade-in zoom-in-95 duration-300">
              <div className="w-24 h-24 bg-blue-50 dark:bg-blue-900/20 rounded-3xl flex items-center justify-center mb-8 rotate-3 transform transition-transform hover:rotate-0">
                <FileSpreadsheet className="w-12 h-12 text-blue-600 dark:text-blue-400" />
              </div>
              <h2 className="text-3xl font-bold text-slate-800 dark:text-white mb-3">Import Data</h2>
              <p className="text-slate-500 dark:text-slate-400 max-w-md mb-10 text-lg">
                Drag and drop your Excel file here, or click to browse.
                <br/><span className="text-sm opacity-75">Required columns: Full Name, Image URL</span>
              </p>
              
              <label className="group relative cursor-pointer">
                <input type="file" ref={fileInputRef} className="hidden" accept=".xlsx, .xls" onChange={handleFileUpload} />
                <div className="absolute -inset-1 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl blur opacity-30 group-hover:opacity-60 transition duration-200"></div>
                <div className="relative px-10 py-5 bg-white dark:bg-slate-800 ring-1 ring-slate-200 dark:ring-slate-700 rounded-xl flex items-center gap-3">
                  <span className="font-bold text-slate-700 dark:text-slate-200 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">Select Excel File</span>
                  <Upload className="w-5 h-5 text-slate-400 group-hover:text-blue-600 transition-colors" />
                </div>
              </label>
            </div>
          )}

          {/* 2. Process View */}
          {activeTab === 'process' && (
            <div className="p-6 md:p-8 grid grid-cols-1 lg:grid-cols-12 gap-8 h-full animate-in slide-in-from-right-4 duration-300">
              
              {/* Left Sidebar: Controls */}
              <div className="lg:col-span-4 space-y-6 flex flex-col h-full">
                
                {/* Filters Card */}
                <div className="bg-slate-50/50 dark:bg-slate-800/50 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-6">
                  <div className="flex justify-between items-center text-slate-800 dark:text-white font-bold">
                    <div className="flex items-center gap-2">
                      <Filter className="w-5 h-5 text-blue-500" />
                      <h3>Filtering Options</h3>
                    </div>
                    <button 
                      onClick={clearFilters}
                      className="text-xs flex items-center gap-1 text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                    >
                      <RotateCcw className="w-3 h-3" /> Clear All
                    </button>
                  </div>

                  {/* Date Filter */}
                  <div className="space-y-3">
                    <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Registration Date Range</label>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <input 
                          type="date" 
                          value={startDate}
                          onChange={(e) => setStartDate(e.target.value)}
                          className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none dark:text-white"
                        />
                      </div>
                      <div>
                        <input 
                          type="date" 
                          value={endDate}
                          onChange={(e) => setEndDate(e.target.value)}
                          className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none dark:text-white"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Sheet Filter */}
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Excel Sheets</label>
                      <div className="flex gap-2">
                         <button onClick={() => toggleAllSheets(true)} className="text-[10px] text-blue-600 dark:text-blue-400 font-bold hover:underline">All</button>
                         <button onClick={() => toggleAllSheets(false)} className="text-[10px] text-slate-500 dark:text-slate-400 font-bold hover:underline">None</button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 max-h-[150px] overflow-y-auto custom-scrollbar">
                      {availableSheets.map(sheet => (
                        <button
                          key={sheet}
                          onClick={() => toggleSheet(sheet)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                            selectedSheets.has(sheet)
                              ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800'
                              : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:border-slate-300'
                          }`}
                        >
                          {sheet}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Queue Stats Card */}
                <div className="flex-1 bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 flex flex-col">
                  <h3 className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase mb-4">Batch Overview</h3>
                  
                  <div className="flex-1 min-h-[120px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={chartData} innerRadius={40} outerRadius={60} paddingAngle={5} dataKey="value" stroke="none">
                          {chartData.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                        </Pie>
                        <Tooltip 
                          contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)' }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="grid grid-cols-2 gap-4 mt-4">
                    <div className="text-center p-3 bg-slate-50 dark:bg-slate-900 rounded-xl">
                      <div className="text-2xl font-bold text-slate-800 dark:text-white">{stats.selected}</div>
                      <div className="text-xs text-slate-500 font-medium uppercase">Queued</div>
                    </div>
                    <div className="text-center p-3 bg-slate-50 dark:bg-slate-900 rounded-xl">
                      <div className="text-2xl font-bold text-emerald-500">{stats.completed}</div>
                      <div className="text-xs text-slate-500 font-medium uppercase">Success</div>
                    </div>
                  </div>
                </div>

                {/* Action Button */}
                {!isProcessing ? (
                  <button 
                    onClick={startProcessing}
                    disabled={stats.selected === 0}
                    className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-2xl shadow-lg shadow-blue-500/25 transition-all flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
                  >
                    Start Batch <ArrowRight className="w-5 h-5" />
                  </button>
                ) : (
                  <div className="w-full py-4 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-bold rounded-2xl flex items-center justify-center gap-3 border border-slate-200 dark:border-slate-700">
                    <RefreshCw className="w-5 h-5 animate-spin" /> Processing...
                  </div>
                )}

              </div>

              {/* Right Sidebar: Table */}
              <div className="lg:col-span-8 flex flex-col h-full overflow-hidden bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700">
                <div className="p-4 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50/50 dark:bg-slate-900/50 backdrop-blur">
                  <h3 className="font-bold text-slate-700 dark:text-slate-200">Attendee List</h3>
                  <div className="flex gap-2">
                    <button onClick={() => toggleAllTasks(true)} className="text-xs font-semibold text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 px-2 py-1 rounded">Select All</button>
                    <button onClick={() => toggleAllTasks(false)} className="text-xs font-semibold text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700 px-2 py-1 rounded">Clear</button>
                  </div>
                </div>
                
                <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
                  <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 bg-white dark:bg-slate-800 z-10 shadow-sm">
                      <tr>
                        <th className="p-3 w-10"></th>
                        <th className="p-3 text-xs font-bold text-slate-400 uppercase">Details</th>
                        <th className="p-3 text-xs font-bold text-slate-400 uppercase text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                      {tasks.map((task) => (
                        <tr key={task.id} className={`group hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors ${!task.isSelected ? 'opacity-50 grayscale' : ''}`}>
                          <td className="p-3">
                            <button onClick={() => toggleTaskSelection(task.id)} className="text-blue-600 dark:text-blue-500">
                              {task.isSelected ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5 text-slate-300 dark:text-slate-600" />}
                            </button>
                          </td>
                          <td className="p-3">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-xs font-bold text-slate-500">
                                {task.fullName.charAt(0)}
                              </div>
                              <div>
                                <p className="text-sm font-bold text-slate-800 dark:text-slate-200">{task.fullName}</p>
                                <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5">
                                  <span className="bg-slate-100 dark:bg-slate-900 px-1.5 py-0.5 rounded text-slate-500 dark:text-slate-400">{task.sheet}</span>
                                  <span>{task.registrationDate ? task.registrationDate.toLocaleDateString() : 'No Date'}</span>
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="p-3 text-right">
                             <StatusBadge status={task.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* 3. Results View */}
          {activeTab === 'results' && (
            <div className="p-12 flex flex-col items-center justify-center h-[600px] text-center animate-in zoom-in-95 duration-300">
              <div className="w-20 h-20 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center mb-6">
                <CheckCircle2 className="w-10 h-10 text-emerald-600 dark:text-emerald-400" />
              </div>
              <h2 className="text-4xl font-extrabold text-slate-900 dark:text-white mb-2">Success!</h2>
              <p className="text-slate-500 dark:text-slate-400 mb-12 text-lg">
                <span className="font-bold text-slate-900 dark:text-white">{stats.completed}</span> images processed successfully.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-2xl">
                {/* Download Card */}
                <button 
                  onClick={!isGeneratingZip ? generateZip : undefined}
                  disabled={isGeneratingZip}
                  className="group relative overflow-hidden bg-white dark:bg-slate-800 p-8 rounded-3xl border border-slate-200 dark:border-slate-700 hover:border-blue-500 dark:hover:border-blue-500 transition-all text-left shadow-lg hover:shadow-xl disabled:opacity-70"
                >
                  <div className="absolute top-0 right-0 w-32 h-32 bg-blue-50 dark:bg-blue-900/20 rounded-full -mr-16 -mt-16 transition-transform group-hover:scale-110"></div>
                  <div className="relative z-10">
                    <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center mb-4 shadow-lg shadow-blue-500/30">
                       {isGeneratingZip ? <Loader2 className="text-white w-6 h-6 animate-spin" /> : <Download className="text-white w-6 h-6" />}
                    </div>
                    <h3 className="text-xl font-bold text-slate-800 dark:text-white">Download ZIP</h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">Organized by Excel sheet name.</p>
                  </div>
                </button>

                {/* Report Card */}
                <div className="relative overflow-hidden bg-white dark:bg-slate-800 p-8 rounded-3xl border border-slate-200 dark:border-slate-700 text-left shadow-lg">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-slate-50 dark:bg-slate-900 rounded-full -mr-16 -mt-16"></div>
                  <div className="relative z-10">
                    <div className="w-12 h-12 bg-slate-200 dark:bg-slate-700 rounded-xl flex items-center justify-center mb-4">
                       <AlertCircle className={`w-6 h-6 ${stats.failed > 0 ? 'text-rose-500' : 'text-slate-400'}`} />
                    </div>
                    <h3 className="text-xl font-bold text-slate-800 dark:text-white">{stats.failed} Failed</h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
                      {stats.failed > 0 ? "Download the ZIP to view the 'failures_report.csv'." : "Perfect run! No errors detected."}
                    </p>
                  </div>
                </div>
              </div>

              <button onClick={reset} className="mt-12 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 font-medium transition-colors">
                Start a New Batch
              </button>
            </div>
          )}

        </main>
      </div>
    </div>
  );
};

const StatusBadge: React.FC<{ status: ImageTask['status'] }> = ({ status }) => {
  const styles = {
    completed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400",
    failed: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-400",
    downloading: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400",
    pending: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
    skipped: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400"
  };

  const labels = {
    completed: "Done",
    failed: "Error",
    downloading: "Busy",
    pending: "Queue",
    skipped: "Skip"
  };

  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider ${styles[status] || styles.pending}`}>
      {labels[status]}
    </span>
  );
};

export default App;
