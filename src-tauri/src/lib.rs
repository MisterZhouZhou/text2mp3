mod edge_tts;

use edge_tts::{get_voices, text_to_speech, TTSConfig, Voice};
use std::fs;
use std::path::PathBuf;

#[tauri::command]
async fn fetch_voices() -> Result<Vec<Voice>, String> {
    get_voices().await
}

#[tauri::command]
async fn generate_speech(
    text: String,
    voice: String,
    rate: String,
    volume: String,
    pitch: String,
    output_path: String,
) -> Result<String, String> {
    let config = TTSConfig {
        voice,
        rate,
        volume,
        pitch,
    };

    let audio_data = text_to_speech(&text, &config).await?;

    // 保存到文件
    fs::write(&output_path, audio_data)
        .map_err(|e| format!("保存文件失败: {}", e))?;

    Ok(output_path)
}

#[tauri::command]
async fn batch_generate_speech(
    items: Vec<serde_json::Value>,
    voice: String,
    rate: String,
    volume: String,
    pitch: String,
    output_dir: String,
) -> Result<Vec<String>, String> {
    let config = TTSConfig {
        voice,
        rate,
        volume,
        pitch,
    };

    let mut results = Vec::new();

    for (index, item) in items.iter().enumerate() {
        let text = item["text"]
            .as_str()
            .ok_or("无效的文本数据")?
            .to_string();

        let filename = item["filename"]
            .as_str()
            .map(|s| s.to_string())
            .unwrap_or_else(|| format!("audio_{}.mp3", index + 1));

        let output_path = PathBuf::from(&output_dir)
            .join(&filename)
            .to_str()
            .ok_or("路径转换失败")?
            .to_string();

        let audio_data = text_to_speech(&text, &config).await?;

        fs::write(&output_path, audio_data)
            .map_err(|e| format!("保存文件失败: {}", e))?;

        results.push(output_path);
    }

    Ok(results)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            fetch_voices,
            generate_speech,
            batch_generate_speech
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
