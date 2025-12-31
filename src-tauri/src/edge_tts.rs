use futures_util::{SinkExt, StreamExt};
use reqwest;
use serde::{Deserialize, Serialize};
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message, client_async_tls, MaybeTlsStream};
use uuid::Uuid;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio::net::TcpStream;
use tokio_socks::tcp::Socks5Stream;

// 常量定义（来自 Python 源码）
const BASE_URL: &str = "speech.platform.bing.com/consumer/speech/synthesize/readaloud";
const TRUSTED_CLIENT_TOKEN: &str = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const CHROMIUM_MAJOR_VERSION: &str = "130";

// 代理类型枚举
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ProxyType {
    Http,
    Https,
    Socks5,
}

// 代理配置结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyConfig {
    pub enabled: bool,
    pub proxy_type: ProxyType,
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub password: Option<String>,
}

impl ProxyConfig {
    pub fn to_url(&self) -> String {
        let protocol = match self.proxy_type {
            ProxyType::Http => "http",
            ProxyType::Https => "https",
            ProxyType::Socks5 => "socks5",
        };

        if let (Some(username), Some(password)) = (&self.username, &self.password) {
            format!("{}://{}:{}@{}:{}", protocol, username, password, self.host, self.port)
        } else {
            format!("{}://{}:{}", protocol, self.host, self.port)
        }
    }
}

// 音色信息结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Voice {
    #[serde(rename = "Name")]
    pub name: String,
    #[serde(rename = "ShortName")]
    pub short_name: String,
    #[serde(rename = "Gender")]
    pub gender: String,
    #[serde(rename = "Locale")]
    pub locale: String,
    #[serde(rename = "SuggestedCodec")]
    pub suggested_codec: String,
    #[serde(rename = "FriendlyName")]
    pub friendly_name: String,
    #[serde(rename = "Status")]
    pub status: String,
}

// TTS 配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TTSConfig {
    pub voice: String,
    pub rate: String,  // 如 "+0%", "+50%", "-20%"
    pub volume: String, // 如 "+0%", "+50%", "-20%"
    pub pitch: String,  // 如 "+0Hz", "+10Hz", "-5Hz"
}

impl Default for TTSConfig {
    fn default() -> Self {
        Self {
            voice: "zh-CN-XiaoxiaoNeural".to_string(),
            rate: "+0%".to_string(),
            volume: "+0%".to_string(),
            pitch: "+0Hz".to_string(),
        }
    }
}

// 获取可用音色列表
pub async fn get_voices(proxy: Option<ProxyConfig>) -> Result<Vec<Voice>, String> {
    let url = format!(
        "https://{}/voices/list?trustedclienttoken={}",
        BASE_URL, TRUSTED_CLIENT_TOKEN
    );

    // 构建客户端，支持代理
    let mut client_builder = reqwest::Client::builder();

    if let Some(proxy_config) = proxy {
        if proxy_config.enabled {
            let proxy = reqwest::Proxy::all(&proxy_config.to_url())
                .map_err(|e| format!("代理配置错误: {}", e))?;
            client_builder = client_builder.proxy(proxy);
        }
    }

    let client = client_builder
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("创建HTTP客户端失败: {}", e))?;

    let response = client
        .get(&url)
        .header("User-Agent", format!(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{}.0.0.0 Safari/537.36 Edg/{}.0.0.0",
            CHROMIUM_MAJOR_VERSION, CHROMIUM_MAJOR_VERSION
        ))
        .header("Accept-Encoding", "gzip, deflate, br")
        .header("Accept-Language", "en-US,en;q=0.9")
        .send()
        .await
        .map_err(|e| format!("获取音色列表失败: {}", e))?;

    let voices: Vec<Voice> = response
        .json()
        .await
        .map_err(|e| format!("解析音色数据失败: {}", e))?;

    Ok(voices)
}

// 生成 SSML 消息
fn create_ssml(text: &str, config: &TTSConfig) -> String {
    format!(
        r#"<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'>
    <voice name='{}'>
        <prosody pitch='{}' rate='{}' volume='{}'>
            {}
        </prosody>
    </voice>
</speak>"#,
        config.voice, config.pitch, config.rate, config.volume, text
    )
}

// SOCKS5 代理连接辅助函数
async fn connect_via_socks5(
    request: http::Request<()>,
    proxy_config: &ProxyConfig,
) -> Result<tokio_tungstenite::WebSocketStream<MaybeTlsStream<TcpStream>>, String> {
    let proxy_addr = format!("{}:{}", proxy_config.host, proxy_config.port);
    let uri = request.uri();
    let host = uri.host().ok_or("无效的主机名")?;
    let port = uri.port_u16().unwrap_or(443);

    let stream = if let (Some(username), Some(password)) = (&proxy_config.username, &proxy_config.password) {
        Socks5Stream::connect_with_password(proxy_addr.as_str(), (host, port), username.as_str(), password.as_str())
            .await
            .map_err(|e| format!("SOCKS5代理连接失败: {}", e))?
    } else {
        Socks5Stream::connect(proxy_addr.as_str(), (host, port))
            .await
            .map_err(|e| format!("SOCKS5代理连接失败: {}", e))?
    };

    let ws_stream = client_async_tls(request, stream.into_inner())
        .await
        .map_err(|e| format!("WebSocket握手失败: {}", e))?
        .0;

    Ok(ws_stream)
}

// 文本转语音
pub async fn text_to_speech(text: &str, config: &TTSConfig, proxy: Option<ProxyConfig>) -> Result<Vec<u8>, String> {
    let wss_url = format!(
        "wss://{}/edge/v1?TrustedClientToken={}",
        BASE_URL, TRUSTED_CLIENT_TOKEN
    );

    let request_id = Uuid::new_v4().to_string().replace("-", "");

    // 构建带有请求头的 WebSocket 请求
    let mut request = wss_url.into_client_request()
        .map_err(|e| format!("构建请求失败: {}", e))?;

    let headers = request.headers_mut();
    headers.insert("User-Agent", format!(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{}.0.0.0 Safari/537.36 Edg/{}.0.0.0",
        CHROMIUM_MAJOR_VERSION, CHROMIUM_MAJOR_VERSION
    ).parse().unwrap());
    headers.insert("Accept-Encoding", "gzip, deflate, br".parse().unwrap());
    headers.insert("Accept-Language", "en-US,en;q=0.9".parse().unwrap());
    headers.insert("Pragma", "no-cache".parse().unwrap());
    headers.insert("Cache-Control", "no-cache".parse().unwrap());
    headers.insert("Origin", "chrome-extension://jdiccldimpdaibmckianbfold".parse().unwrap());

    // 根据代理配置建立连接
    let ws_stream = if let Some(proxy_config) = proxy {
        if proxy_config.enabled && proxy_config.proxy_type == ProxyType::Socks5 {
            connect_via_socks5(request, &proxy_config).await?
        } else if proxy_config.enabled {
            return Err("WebSocket暂不支持HTTP代理，请使用SOCKS5代理".to_string());
        } else {
            connect_async(request).await
                .map_err(|e| format!("WebSocket 连接失败: {}", e))?
                .0
        }
    } else {
        connect_async(request).await
            .map_err(|e| format!("WebSocket 连接失败: {}", e))?
            .0
    };

    let (mut write, mut read) = ws_stream.split();

    // 发送配置消息
    let config_msg = format!(
        "X-Timestamp:{}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n\
        {{\"context\":{{\"synthesis\":{{\"audio\":{{\"metadataoptions\":{{\"sentenceBoundaryEnabled\":\"false\",\"wordBoundaryEnabled\":\"true\"}},\
        \"outputFormat\":\"audio-24khz-48kbitrate-mono-mp3\"}}}}}}}}",
        chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ")
    );

    write
        .send(Message::Text(config_msg))
        .await
        .map_err(|e| format!("发送配置消息失败: {}", e))?;

    // 发送 SSML 消息
    let ssml = create_ssml(text, config);
    let ssml_msg = format!(
        "X-RequestId:{}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:{}\r\nPath:ssml\r\n\r\n{}",
        request_id,
        chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ"),
        ssml
    );

    write
        .send(Message::Text(ssml_msg))
        .await
        .map_err(|e| format!("发送 SSML 消息失败: {}", e))?;

    // 接收音频数据
    let mut audio_data = Vec::new();
    let mut received_audio = false;

    while let Some(msg) = read.next().await {
        match msg {
            Ok(Message::Binary(data)) => {
                // 跳过头部，提取音频数据
                if data.len() > 2 {
                    let header_len = u16::from_be_bytes([data[0], data[1]]) as usize;
                    if data.len() > header_len + 2 {
                        audio_data.extend_from_slice(&data[header_len + 2..]);
                        received_audio = true;
                    }
                }
            }
            Ok(Message::Text(text)) => {
                if text.contains("Path:turn.end") {
                    break;
                }
            }
            Ok(Message::Close(_)) => break,
            Err(e) => return Err(format!("接收消息失败: {}", e)),
            _ => {}
        }
    }

    if !received_audio {
        return Err("未接收到音频数据".to_string());
    }

    Ok(audio_data)
}
