import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { save, open, ask } from "@tauri-apps/plugin-dialog";
import { useProxyStore } from "./store/proxyStore";
import { ProxySettings } from "./components/ProxySettings";
import { Download, Trash2, RefreshCw, AudioLines, FileText, Settings2, Sparkles, Send, FolderOpen, Languages, User, Gauge, Volume2, Zap } from "lucide-react";
import "./App.css";

interface Voice {
  Name: string;
  ShortName: string;
  Gender: string;
  Locale: string;
  FriendlyName: string;
}

interface BatchItem {
  text: string;
  filename: string;
}

interface HistoryItem {
  id: string;
  name: string;
  path: string;
  size: number;
  time: number;
}

function App() {
  const [voices, setVoices] = useState<Voice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState("zh-CN-XiaoxiaoNeural");
  const [rate, setRate] = useState(0);
  const [volume, setVolume] = useState(0);
  const [pitch, setPitch] = useState(0);
  const [text, setText] = useState("");
  const [batchText, setBatchText] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [activeTab, setActiveTab] = useState<"single" | "batch" | "proxy">("single");
  const [locale, setLocale] = useState("zh-CN");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });
  const { proxy, loadFromStorage } = useProxyStore();

  useEffect(() => {
    loadFromStorage();
    loadVoices();
    // 加载历史记录
    const savedHistory = localStorage.getItem("text2mp3_history");
    if (savedHistory) {
      try {
        setHistory(JSON.parse(savedHistory));
      } catch (e) {
        console.error("加载历史记录失败", e);
      }
    }
  }, []);

  useEffect(() => {
    const unlisten = listen<{ current: number; total: number }>("batch-progress", (event) => {
      setBatchProgress(event.payload);
    });

    return () => {
      unlisten.then(f => f());
    };
  }, []);

  useEffect(() => {
    localStorage.setItem("text2mp3_history", JSON.stringify(history));
  }, [history]);

  async function loadVoices() {
    try {
      setIsRefreshing(true);
      const voiceList = await invoke<Voice[]>("fetch_voices", {
        proxy: proxy.enabled ? proxy : null
      });
      setVoices(voiceList);
    } catch (error) {
      setMessage(`加载音色失败: ${error}`);
    } finally {
      setIsRefreshing(false);
    }
  }

  async function addHistoryItem(path: string) {
    try {
      const size = await invoke<number>("get_file_size", { path });
      const name = path.split(/[/\\]/).pop() || "unknown.mp3";
      const newItem: HistoryItem = {
        id: crypto.randomUUID(),
        name,
        path,
        size,
        time: Date.now(),
      };
      setHistory(prev => [newItem, ...prev]);
    } catch (error) {
      console.error("获取文件大小失败", error);
    }
  }

  async function handleGenerate() {
    if (!text.trim()) {
      setMessage("请输入要转换的文本");
      return;
    }

    try {
      setLoading(true);
      setMessage("正在生成...");

      const tempDir = await invoke<string>("get_audio_temp_dir");
      const timestamp = Date.now();
      const filename = `audio_${timestamp}.mp3`;
      const filePath = `${tempDir}/${filename}`;

      await invoke("generate_speech", {
        text,
        voice: selectedVoice,
        rate: `${rate >= 0 ? "+" : ""}${rate}%`,
        volume: `${volume >= 0 ? "+" : ""}${volume}%`,
        pitch: `${pitch >= 0 ? "+" : ""}${pitch}Hz`,
        outputPath: filePath,
        proxy: proxy.enabled ? proxy : null,
      });

      await addHistoryItem(filePath);
      setMessage(`生成成功`);
    } catch (error) {
      setMessage(`生成失败: ${error}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleBatchGenerate() {
    if (!batchText.trim()) {
      setMessage("请输入批量文本");
      return;
    }

    try {
      setLoading(true);
      setMessage("正在批量生成...");
      setBatchProgress({ current: 0, total: 0 });

      const tempDir = await invoke<string>("get_audio_temp_dir");
      const subDir = `batch_${Date.now()}`;
      const outputDir = `${tempDir}/${subDir}`;

      const lines = batchText.split("\n").filter((line) => line.trim());
      const items: BatchItem[] = lines.map((line, index) => ({
        text: line.trim(),
        filename: `audio_${index + 1}.mp3`,
      }));

      setBatchProgress({ current: 0, total: items.length });

      const results = await invoke<string[]>("batch_generate_speech", {
        items,
        voice: selectedVoice,
        rate: `${rate >= 0 ? "+" : ""}${rate}%`,
        volume: `${volume >= 0 ? "+" : ""}${volume}%`,
        pitch: `${pitch >= 0 ? "+" : ""}${pitch}Hz`,
        outputDir,
        proxy: proxy.enabled ? proxy : null,
      });

      for (const res of results) {
        await addHistoryItem(res);
      }

      setMessage(`批量生成成功，共 ${results.length} 个文件`);
    } catch (error) {
      setMessage(`批量生成失败: ${error}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleExportSingle(item: HistoryItem) {
    try {
      const filePath = await save({
        defaultPath: item.name,
        filters: [{ name: "MP3", extensions: ["mp3"] }],
      });

      if (!filePath) return;

      await invoke("copy_file", { source: item.path, dest: filePath });
      setMessage("导出成功");
    } catch (error) {
      setMessage(`导出失败: ${error}`);
    }
  }

  async function handlePhysicalDelete(id: string, path: string) {
    const confirmed = await ask("确定要删除磁盘上的文件吗？", {
      title: "删除确认",
      kind: "warning",
    });
    if (!confirmed) return;
    try {
      await invoke("delete_file", { path });
      setHistory((prev) => prev.filter((item) => item.id !== id));
      setMessage("文件已删除");
    } catch (error) {
      setMessage(`删除失败: ${error}`);
    }
  }

  async function handleOpenPath(path: string) {
    try {
      await invoke("open_path", { path });
    } catch (error) {
      setMessage(`打开失败: ${error}`);
    }
  }

  async function handleExportAll() {
    if (history.length === 0) {
      setMessage("没有可导出的记录");
      return;
    }

    const directory = await open({
      directory: true,
      multiple: false,
    });

    if (!directory) return;

    try {
      setLoading(true);
      setMessage("正在导出...");
      for (const item of history) {
        const dest = `${directory}/${item.name}`;
        await invoke("copy_file", { source: item.path, dest });
      }
      setMessage(`导出完成，共 ${history.length} 个文件`);
    } catch (error) {
      setMessage(`导出失败: ${error}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleClearHistory() {
    const confirmed = await ask("是否确认删除所有历史生成记录和物理文件？此操作不可恢复。", {
      title: "清空确认",
      kind: "warning",
    });
    if (confirmed) {
      try {
        setLoading(true);
        setMessage("正在清理文件...");
        for (const item of history) {
          try {
            await invoke("delete_file", { path: item.path });
          } catch (e) {
            console.error(`删除文件失败: ${item.path}`, e);
          }
        }
        setHistory([]);
        setMessage("所有历史记录及文件已清除");
      } catch (error) {
        setMessage(`清空过程出现错误: ${error}`);
      } finally {
        setLoading(false);
      }
    }
  }

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const filteredVoices = voices.filter((v) => v.Locale.startsWith(locale));

  return (
    <div className="min-h-screen bg-base-200" data-theme="light">
      {/* 顶部导航栏 */}
      <nav className="navbar bg-base-100 shadow-md px-4 sticky top-0 z-50">
        <div className="flex-1">
          <a className="text-xl font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
            Text2MP3
          </a>
        </div>
        <div className="flex gap-3">
          <button
            className={`px-3 py-1.5 bg-blue-500 text-white text-xs font-medium rounded-lg hover:bg-blue-600 transition-colors flex items-center gap-1.5 shadow-sm ${isRefreshing ? 'opacity-70 cursor-not-allowed' : ''}`}
            onClick={loadVoices}
            disabled={isRefreshing}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            {isRefreshing ? '正在刷新' : '刷新音色'}
          </button>
          <button 
            className="px-3 py-1.5 bg-indigo-500 text-white text-xs font-medium rounded-lg hover:bg-indigo-600 transition-colors flex items-center gap-1.5 shadow-sm" 
            onClick={handleExportAll}
          >
            <Download className="w-3.5 h-3.5" />
            一键导出
          </button>
          <button 
            className="px-3 py-1.5 bg-rose-500 text-white text-xs font-medium rounded-lg hover:bg-rose-600 transition-colors flex items-center gap-1.5 shadow-sm" 
            onClick={handleClearHistory}
          >
            <Trash2 className="w-3.5 h-3.5" />
            一键清空
          </button>
        </div>
      </nav>

      <div className="max-w-[1600px] mx-auto p-4 lg:p-6 space-y-6">
        {/* 第一行：通用配置 (全宽) */}
        <div className="card bg-base-100 shadow-xl border border-base-200/50">
          <div className="card-body p-6">
            <h2 className="card-title text-xl mb-6 font-bold flex items-center gap-2">
              <Settings2 className="w-5 h-5 text-primary" />
              通用配置
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-6 bg-base-200/30 p-6 rounded-2xl border border-base-200">
                <div className="space-y-6">
                  {/* 语言选择 */}
                  <div className="form-control">
                    <label className="label">
                      <span className="label-text font-bold flex items-center gap-2">
                        <Languages className="w-4 h-4 text-primary/70" />
                        选择语言
                      </span>
                    </label>
                    <select
                      className="select select-bordered w-full bg-base-100"
                      value={locale}
                      onChange={(e) => {
                        setLocale(e.target.value);
                        const firstVoice = voices.find((v) =>
                          v.Locale.startsWith(e.target.value)
                        );
                        if (firstVoice) setSelectedVoice(firstVoice.ShortName);
                      }}
                    >
                      <option value="zh-CN">中文 (简体)</option>
                      <option value="zh-TW">中文 (繁体)</option>
                      <option value="en-US">英语 (美国)</option>
                      <option value="en-GB">英语 (英国)</option>
                      <option value="ja-JP">日语</option>
                      <option value="ko-KR">韩语</option>
                    </select>
                  </div>

                  {/* 音色选择 */}
                  <div className="form-control">
                    <label className="label">
                      <span className="label-text font-bold flex items-center gap-2">
                        <User className="w-4 h-4 text-primary/70" />
                        选择音色
                      </span>
                    </label>
                    <select
                      className="select select-bordered w-full bg-base-100"
                      value={selectedVoice}
                      onChange={(e) => setSelectedVoice(e.target.value)}
                    >
                      {filteredVoices.map((voice) => (
                        <option key={voice.ShortName} value={voice.ShortName}>
                          {voice.FriendlyName} ({voice.Gender === "Male" ? "男" : "女"})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="space-y-6 bg-base-200/30 p-6 rounded-2xl border border-base-200">
                <div className="form-control">
                  <label className="label">
                    <span className="label-text flex items-center gap-2 font-medium">
                      <Gauge className="w-4 h-4" />
                      语速: <span className="text-primary font-bold">{rate >= 0 ? `+${rate}` : rate}%</span>
                    </span>
                  </label>
                  <input
                    type="range"
                    min="-50"
                    max="100"
                    value={rate}
                    className="range range-primary range-sm"
                    onChange={(e) => setRate(Number(e.target.value))}
                  />
                </div>

                <div className="form-control">
                  <label className="label">
                    <span className="label-text flex items-center gap-2 font-medium">
                      <Volume2 className="w-4 h-4" />
                      音量: <span className="text-secondary font-bold">{volume >= 0 ? `+${volume}` : volume}%</span>
                    </span>
                  </label>
                  <input
                    type="range"
                    min="-50"
                    max="50"
                    value={volume}
                    className="range range-secondary range-sm"
                    onChange={(e) => setVolume(Number(e.target.value))}
                  />
                </div>

                <div className="form-control">
                  <label className="label">
                    <span className="label-text flex items-center gap-2 font-medium">
                      <Zap className="w-4 h-4" />
                      音调: <span className="text-accent font-bold">{pitch >= 0 ? `+${pitch}` : pitch}Hz</span>
                    </span>
                  </label>
                  <input
                    type="range"
                    min="-20"
                    max="20"
                    value={pitch}
                    className="range range-accent range-sm"
                    onChange={(e) => setPitch(Number(e.target.value))}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 第二行：并列展示区 */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
          {/* 左侧：生成工作区 */}
          <div className="space-y-4">
            <div className="flex items-center gap-1 bg-base-300/30 rounded-xl p-1 w-fit shadow-inner">
              <button
                className={`px-6 py-2 rounded-lg text-sm font-bold transition-all duration-300 flex items-center gap-2 ${
                  activeTab === "single"
                    ? "bg-primary text-primary-content shadow-md"
                    : "text-base-content/60 hover:text-base-content hover:bg-base-200"
                }`}
                onClick={() => setActiveTab("single")}
              >
                <FileText className="w-4 h-4" />
                单次
              </button>
              <button
                className={`px-6 py-2 rounded-lg text-sm font-bold transition-all duration-300 flex items-center gap-2 ${
                  activeTab === "batch"
                    ? "bg-primary text-primary-content shadow-md"
                    : "text-base-content/60 hover:text-base-content hover:bg-base-200"
                }`}
                onClick={() => setActiveTab("batch")}
              >
                <AudioLines className="w-4 h-4" />
                批量
              </button>
              <button
                className={`px-6 py-2 rounded-lg text-sm font-bold transition-all duration-300 flex items-center gap-2 ${
                  activeTab === "proxy"
                    ? "bg-primary text-primary-content shadow-md"
                    : "text-base-content/60 hover:text-base-content hover:bg-base-200"
                }`}
                onClick={() => setActiveTab("proxy")}
              >
                <Settings2 className="w-4 h-4" />
                代理
              </button>
            </div>

            <div className="card bg-base-100 shadow-xl border border-base-200/50">
              <div className="card-body p-6">
                {activeTab === "single" && (
                  <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <div className="form-control w-full">
                      <textarea
                        className="textarea textarea-bordered w-full h-48 text-lg focus:textarea-primary transition-all bg-base-200/20 resize-none border-2"
                        placeholder="在这里输入文字，点击生成按钮转换为 MP3..."
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                      />
                    </div>
                    <div className="flex flex-col md:flex-row justify-between items-center gap-4 pt-2">
                      <div className="flex items-center gap-2 text-sm text-base-content/50 bg-base-200 px-3 py-1.5 rounded-full">
                        <span className="w-2 h-2 bg-primary rounded-full animate-pulse"></span>
                        已输入 {text.length} 个字符
                      </div>
                      <button
                        className={`btn btn-primary btn-lg px-10 shadow-xl hover:shadow-primary/30 flex items-center gap-3 rounded-2xl group transition-all duration-300 min-w-[200px] hover:scale-[1.02] active:scale-[0.98] ${loading ? "opacity-90" : ""}`}
                        onClick={handleGenerate}
                        disabled={loading}
                      >
                        {loading ? (
                          <RefreshCw className="w-5 h-5 animate-spin" />
                        ) : (
                          <Send className="w-5 h-5 group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
                        )}
                        <span>{loading ? "正在努力生成..." : "立即生成 MP3"}</span>
                      </button>
                    </div>
                  </div>
                )}

                {activeTab === "batch" && (
                  <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <div className="flex items-center gap-2 text-xs text-info/80 bg-info/5 px-3 py-2 rounded-lg border border-info/10">
                      <Send className="w-3.5 h-3.5" />
                      <span>每行代表一个独立的文件，生成后将提示选择保存目录。</span>
                    </div>

                    {loading && batchProgress.total > 0 && (
                      <div className="bg-base-200/50 p-4 rounded-xl border border-base-200 animate-in fade-in slide-in-from-top-2">
                        <div className="flex justify-between items-end mb-2">
                          <div className="space-y-1">
                            <span className="text-xs font-bold text-base-content/50 block">当前进度</span>
                            <span className="text-lg font-mono font-bold text-primary">
                              {Math.round((batchProgress.current / batchProgress.total) * 100)}%
                            </span>
                          </div>
                          <div className="text-right">
                            <span className="text-xs font-bold text-base-content/40 block">已完成 / 总计</span>
                            <span className="text-sm font-mono font-medium">
                              {batchProgress.current} <span className="text-base-content/20">/</span> {batchProgress.total}
                            </span>
                          </div>
                        </div>
                        <progress 
                          className="progress progress-primary w-full h-3 shadow-inner rounded-full" 
                          value={batchProgress.current} 
                          max={batchProgress.total}
                        ></progress>
                      </div>
                    )}

                    <div className="form-control w-full">
                      <textarea
                        className="textarea textarea-bordered w-full h-56 focus:textarea-primary transition-all font-mono bg-base-200/20 border-2 resize-none"
                        placeholder="第一行内容&#10;第二行内容&#10;第三行内容..."
                        value={batchText}
                        onChange={(e) => setBatchText(e.target.value)}
                      />
                    </div>
                    <div className="flex justify-end pt-2">
                      <button
                        className={`btn btn-primary btn-lg px-10 shadow-xl hover:shadow-primary/30 flex items-center gap-3 rounded-2xl group transition-all duration-300 min-w-[200px] hover:scale-[1.02] active:scale-[0.98] ${loading ? "opacity-90" : ""}`}
                        onClick={handleBatchGenerate}
                        disabled={loading}
                      >
                        {loading ? (
                          <RefreshCw className="w-5 h-5 animate-spin" />
                        ) : (
                          <Sparkles className="w-5 h-5 group-hover:rotate-12 transition-transform" />
                        )}
                        <span>{loading ? "正在批量处理..." : "开始批量生成"}</span>
                      </button>
                    </div>
                  </div>
                )}

                {activeTab === "proxy" && (
                  <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <ProxySettings />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 右侧：生成历史记录 */}
          <div className="card bg-base-100 shadow-xl overflow-hidden border border-base-200/50 h-full min-h-[500px] max-h-[700px]">
            <div className="card-body p-0 flex flex-col">
              <div className="p-4 lg:p-6 border-b border-base-200 flex justify-between items-center bg-base-50/30">
                <h2 className="card-title text-lg font-bold flex items-center gap-2">
                  <AudioLines className="w-5 h-5 text-primary" />
                  生成历史记录
                </h2>
                {proxy.enabled && activeTab !== "proxy" && (
                  <div 
                    className="badge badge-success badge-sm gap-1 cursor-pointer hover:opacity-80"
                    onClick={() => setActiveTab("proxy")}
                  >
                    代理已就绪
                  </div>
                )}
              </div>
              <div className="overflow-y-auto flex-1">
                <table className="table table-zebra w-full text-sm">
                  <thead className="bg-base-200/50 text-base-content/60 sticky top-0 z-10">
                    <tr className="backdrop-blur-md bg-base-200/80">
                      <th className="font-bold">文件名</th>
                      <th className="font-bold">大小</th>
                      <th className="text-right font-bold">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="text-center py-20 text-base-content/30 italic">
                          暂无生成记录
                        </td>
                      </tr>
                    ) : (
                      history.map((item) => (
                        <tr key={item.id} className="hover:bg-base-200/40 transition-colors border-b border-base-100 last:border-0">
                          <td className="max-w-[120px] lg:max-w-[180px] truncate font-medium py-3" title={item.path}>
                            {item.name}
                          </td>
                          <td className="whitespace-nowrap opacity-60 font-mono text-xs">{formatFileSize(item.size)}</td>
                          <td className="text-right flex justify-end gap-0.5">
                            <button
                              className="p-2 hover:bg-primary/10 text-primary rounded-lg transition-colors"
                              onClick={() => handleExportSingle(item)}
                              title="导出"
                            >
                              <Download className="w-4 h-4" />
                            </button>
                            <button
                              className="p-2 hover:bg-info/10 text-info rounded-lg transition-colors"
                              onClick={() => handleOpenPath(item.path)}
                              title="定位"
                            >
                              <FolderOpen className="w-4 h-4" />
                            </button>
                            <button
                              className="p-2 hover:bg-error/10 text-error rounded-lg transition-colors"
                              onClick={() => handlePhysicalDelete(item.id, item.path)}
                              title="删除"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 消息提示 (Toast) */}
      {message && (
        <div className="toast toast-end toast-bottom z-[60] p-4">
          <div className="alert alert-info shadow-2xl border-l-4 border-info bg-base-100 flex items-center gap-3">
            <div className="bg-info/10 p-2 rounded-lg text-info">
              <Zap className="w-5 h-5" />
            </div>
            <span className="font-medium text-sm">{message}</span>
            <button
              className="btn btn-ghost btn-xs btn-circle opacity-50 hover:opacity-100"
              onClick={() => setMessage("")}
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
