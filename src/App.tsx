import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save, open } from "@tauri-apps/plugin-dialog";
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
  const [activeTab, setActiveTab] = useState<"single" | "batch">("single");
  const [locale, setLocale] = useState("zh-CN");

  useEffect(() => {
    loadVoices();
  }, []);

  async function loadVoices() {
    try {
      const voiceList = await invoke<Voice[]>("fetch_voices");
      setVoices(voiceList);
    } catch (error) {
      setMessage(`加载音色失败: ${error}`);
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

      const filePath = await save({
        defaultPath: "output.mp3",
        filters: [{ name: "MP3", extensions: ["mp3"] }],
      });

      if (!filePath) {
        setMessage("已取消");
        setLoading(false);
        return;
      }

      await invoke("generate_speech", {
        text,
        voice: selectedVoice,
        rate: `${rate >= 0 ? "+" : ""}${rate}%`,
        volume: `${volume >= 0 ? "+" : ""}${volume}%`,
        pitch: `${pitch >= 0 ? "+" : ""}${pitch}Hz`,
        outputPath: filePath,
      });

      setMessage(`生成成功: ${filePath}`);
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

      const lines = batchText.split("\n").filter((line) => line.trim());
      const items: BatchItem[] = lines.map((line, index) => ({
        text: line.trim(),
        filename: `audio_${index + 1}.mp3`,
      }));

      const directory = await open({
        directory: true,
        multiple: false,
      });

      if (!directory) {
        setMessage("已取消");
        setLoading(false);
        return;
      }

      const results = await invoke<string[]>("batch_generate_speech", {
        items,
        voice: selectedVoice,
        rate: `${rate >= 0 ? "+" : ""}${rate}%`,
        volume: `${volume >= 0 ? "+" : ""}${volume}%`,
        pitch: `${pitch >= 0 ? "+" : ""}${pitch}Hz`,
        outputDir: directory,
      });

      setMessage(`批量生成成功，共 ${results.length} 个文件`);
    } catch (error) {
      setMessage(`批量生成失败: ${error}`);
    } finally {
      setLoading(false);
    }
  }

  const filteredVoices = voices.filter((v) => v.Locale.startsWith(locale));

  return (
    <div className="min-h-screen bg-base-200 p-4">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold text-center mb-8">文本转 MP3 工具</h1>

        {/* 标签页切换 */}
        <div className="tabs tabs-boxed mb-4">
          <a
            className={`tab ${activeTab === "single" ? "tab-active" : ""}`}
            onClick={() => setActiveTab("single")}
          >
            单次生成
          </a>
          <a
            className={`tab ${activeTab === "batch" ? "tab-active" : ""}`}
            onClick={() => setActiveTab("batch")}
          >
            批量生成
          </a>
        </div>

        {/* 配置区域 */}
        <div className="card bg-base-100 shadow-xl mb-4">
          <div className="card-body">
            <h2 className="card-title">配置选项</h2>

            {/* 语言和音色选择 */}
            <div className="form-control">
              <label className="label">
                <span className="label-text">语言</span>
              </label>
              <select
                className="select select-bordered"
                value={locale}
                onChange={(e) => {
                  setLocale(e.target.value);
                  const firstVoice = voices.find((v) =>
                    v.Locale.startsWith(e.target.value)
                  );
                  if (firstVoice) setSelectedVoice(firstVoice.ShortName);
                }}
              >
                <option value="zh-CN">中文（简体）</option>
                <option value="zh-TW">中文（繁体）</option>
                <option value="en-US">英语（美国）</option>
                <option value="en-GB">英语（英国）</option>
                <option value="ja-JP">日语</option>
                <option value="ko-KR">韩语</option>
              </select>
            </div>

            <div className="form-control">
              <label className="label">
                <span className="label-text">音色</span>
              </label>
              <select
                className="select select-bordered"
                value={selectedVoice}
                onChange={(e) => setSelectedVoice(e.target.value)}
              >
                {filteredVoices.map((voice) => (
                  <option key={voice.ShortName} value={voice.ShortName}>
                    {voice.FriendlyName} ({voice.Gender})
                  </option>
                ))}
              </select>
            </div>

            {/* 速率调整 */}
            <div className="form-control">
              <label className="label">
                <span className="label-text">语速: {rate}%</span>
              </label>
              <input
                type="range"
                min="-50"
                max="100"
                value={rate}
                className="range range-primary"
                onChange={(e) => setRate(Number(e.target.value))}
              />
              <div className="w-full flex justify-between text-xs px-2">
                <span>-50%</span>
                <span>0%</span>
                <span>+100%</span>
              </div>
            </div>

            {/* 音量调整 */}
            <div className="form-control">
              <label className="label">
                <span className="label-text">音量: {volume}%</span>
              </label>
              <input
                type="range"
                min="-50"
                max="50"
                value={volume}
                className="range range-secondary"
                onChange={(e) => setVolume(Number(e.target.value))}
              />
              <div className="w-full flex justify-between text-xs px-2">
                <span>-50%</span>
                <span>0%</span>
                <span>+50%</span>
              </div>
            </div>

            {/* 音调调整 */}
            <div className="form-control">
              <label className="label">
                <span className="label-text">音调: {pitch}Hz</span>
              </label>
              <input
                type="range"
                min="-20"
                max="20"
                value={pitch}
                className="range range-accent"
                onChange={(e) => setPitch(Number(e.target.value))}
              />
              <div className="w-full flex justify-between text-xs px-2">
                <span>-20Hz</span>
                <span>0Hz</span>
                <span>+20Hz</span>
              </div>
            </div>
          </div>
        </div>

        {/* 单次生成 */}
        {activeTab === "single" && (
          <div className="card bg-base-100 shadow-xl">
            <div className="card-body">
              <h2 className="card-title">单次文本转语音</h2>
              <div className="form-control">
                <label className="label">
                  <span className="label-text">输入文本</span>
                </label>
                <textarea
                  className="textarea textarea-bordered h-32"
                  placeholder="请输入要转换的文本..."
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              </div>
              <div className="card-actions justify-end mt-4">
                <button
                  className={`btn btn-primary ${loading ? "loading" : ""}`}
                  onClick={handleGenerate}
                  disabled={loading}
                >
                  {loading ? "生成中..." : "生成 MP3"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 批量生成 */}
        {activeTab === "batch" && (
          <div className="card bg-base-100 shadow-xl">
            <div className="card-body">
              <h2 className="card-title">批量文本转语音</h2>
              <div className="alert alert-info mb-4">
                <span>每行一条文本，将生成对应数量的 MP3 文件</span>
              </div>
              <div className="form-control">
                <label className="label">
                  <span className="label-text">输入文本（每行一条）</span>
                </label>
                <textarea
                  className="textarea textarea-bordered h-48"
                  placeholder="第一条文本&#10;第二条文本&#10;第三条文本..."
                  value={batchText}
                  onChange={(e) => setBatchText(e.target.value)}
                />
              </div>
              <div className="card-actions justify-end mt-4">
                <button
                  className={`btn btn-primary ${loading ? "loading" : ""}`}
                  onClick={handleBatchGenerate}
                  disabled={loading}
                >
                  {loading ? "生成中..." : "批量生成 MP3"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 消息提示 */}
        {message && (
          <div className="alert shadow-lg mt-4">
            <div>
              <span>{message}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
