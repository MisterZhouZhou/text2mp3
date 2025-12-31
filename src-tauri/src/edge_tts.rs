use futures_util::{SinkExt, StreamExt};
use reqwest;
use serde::{Deserialize, Serialize};
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};
use uuid::Uuid;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;

// 常量定义（来自 Python 源码）
const BASE_URL: &str = "speech.platform.bing.com/consumer/speech/synthesize/readaloud";
const TRUSTED_CLIENT_TOKEN: &str = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const CHROMIUM_MAJOR_VERSION: &str = "130";

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
pub async fn get_voices() -> Result<Vec<Voice>, String> {
    let url = format!(
        "https://{}/voices/list?trustedclienttoken={}",
        BASE_URL, TRUSTED_CLIENT_TOKEN
    );

    let client = reqwest::Client::new();
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

// 文本转语音
pub async fn text_to_speech(text: &str, config: &TTSConfig) -> Result<Vec<u8>, String> {
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

    // 连接 WebSocket
    let (ws_stream, _) = connect_async(request)
        .await
        .map_err(|e| format!("WebSocket 连接失败: {}", e))?;

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
