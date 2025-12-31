export type ProxyType = "Http" | "Https" | "Socks5";

export interface ProxyConfig {
  enabled: boolean;
  proxy_type: ProxyType;
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export const defaultProxyConfig: ProxyConfig = {
  enabled: false,
  proxy_type: "Socks5",
  host: "127.0.0.1",
  port: 1080,
};
