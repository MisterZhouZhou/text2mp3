import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useProxyStore } from "../store/proxyStore";
import { ProxyType } from "../types/proxy";

export function ProxySettings() {
  const { proxy, setProxy, toggleEnabled } = useProxyStore();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string>("");
  const [showPassword, setShowPassword] = useState(false);

  const handleTest = async () => {
    if (!proxy.enabled || !proxy.host || !proxy.port) {
      setTestResult("请先完整填写代理配置");
      return;
    }

    try {
      setTesting(true);
      setTestResult("");

      const result = await invoke<string>("test_proxy", { proxy });
      setTestResult(`✓ ${result}`);
    } catch (error) {
      setTestResult(`✗ 测试失败: ${error}`);
    } finally {
      setTesting(false);
    }
  };

  const handleChange = (field: keyof typeof proxy, value: any) => {
    setProxy({ ...proxy, [field]: value });
  };

  return (
    <div className="card bg-base-100 shadow-xl">
      <div className="card-body">
        <div className="flex items-center justify-between mb-4">
          <h2 className="card-title">代理设置</h2>
          <input
            type="checkbox"
            className="toggle toggle-primary"
            checked={proxy.enabled}
            onChange={toggleEnabled}
          />
        </div>

        <div className={proxy.enabled ? "" : "opacity-50 pointer-events-none"}>
          {/* 代理类型选择 */}
          <div className="form-control mb-4">
            <label className="label">
              <span className="label-text">代理类型</span>
            </label>
            <select
              className="select select-bordered"
              value={proxy.proxy_type}
              onChange={(e) => handleChange("proxy_type", e.target.value as ProxyType)}
            >
              <option value="Socks5">SOCKS5（推荐）</option>
              <option value="Http">HTTP</option>
              <option value="Https">HTTPS</option>
            </select>
            <label className="label">
              <span className="label-text-alt text-warning">
                注意：WebSocket 连接仅支持 SOCKS5 代理
              </span>
            </label>
          </div>

          {/* 主机和端口 */}
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="form-control">
              <label className="label">
                <span className="label-text">主机地址</span>
              </label>
              <input
                type="text"
                placeholder="127.0.0.1"
                className="input input-bordered"
                value={proxy.host}
                onChange={(e) => handleChange("host", e.target.value)}
              />
            </div>
            <div className="form-control">
              <label className="label">
                <span className="label-text">端口</span>
              </label>
              <input
                type="number"
                placeholder="1080"
                className="input input-bordered"
                value={proxy.port}
                onChange={(e) => handleChange("port", Number(e.target.value))}
              />
            </div>
          </div>

          {/* 认证信息（可选） */}
          <div className="collapse collapse-arrow bg-base-200 mb-4">
            <input type="checkbox" />
            <div className="collapse-title text-sm font-medium">
              代理认证（可选）
            </div>
            <div className="collapse-content">
              <div className="form-control mb-2">
                <label className="label">
                  <span className="label-text">用户名</span>
                </label>
                <input
                  type="text"
                  placeholder="用户名"
                  className="input input-bordered input-sm"
                  value={proxy.username || ""}
                  onChange={(e) => handleChange("username", e.target.value || undefined)}
                />
              </div>
              <div className="form-control">
                <label className="label">
                  <span className="label-text">密码</span>
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder="密码"
                    className="input input-bordered input-sm w-full pr-10"
                    value={proxy.password || ""}
                    onChange={(e) => handleChange("password", e.target.value || undefined)}
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 btn btn-ghost btn-xs"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? "隐藏" : "显示"}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* 常用配置提示 */}
          <div className="alert alert-info mb-4">
            <div className="text-sm">
              <div className="font-bold mb-1">常用代理配置：</div>
              <div>• Clash/V2Ray: 127.0.0.1:7890 (SOCKS5)</div>
              <div>• Shadowsocks: 127.0.0.1:1080 (SOCKS5)</div>
            </div>
          </div>

          {/* 测试按钮 */}
          <div className="card-actions justify-end">
            <button
              className={`btn btn-sm ${testing ? "loading" : ""}`}
              onClick={handleTest}
              disabled={testing}
            >
              {testing ? "测试中..." : "测试连接"}
            </button>
          </div>

          {/* 测试结果 */}
          {testResult && (
            <div
              className={`alert mt-4 ${
                testResult.startsWith("✓") ? "alert-success" : "alert-error"
              }`}
            >
              <span>{testResult}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
