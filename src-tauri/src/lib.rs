mod edge_tts;

use edge_tts::{get_voices, text_to_speech, TTSConfig, Voice, ProxyConfig};
use std::fs;
use std::path::PathBuf;
use tauri::{Manager, Emitter};

#[tauri::command]
async fn fetch_voices(proxy: Option<ProxyConfig>) -> Result<Vec<Voice>, String> {
    get_voices(proxy).await
}

#[tauri::command]
async fn generate_speech(
    text: String,
    voice: String,
    rate: String,
    volume: String,
    pitch: String,
    output_path: String,
    proxy: Option<ProxyConfig>,
) -> Result<String, String> {
    let config = TTSConfig {
        voice,
        rate,
        volume,
        pitch,
    };

    let audio_data = text_to_speech(&text, &config, proxy).await?;

    // 保存到文件
    fs::write(&output_path, audio_data)
        .map_err(|e| format!("保存文件失败: {}", e))?;

    Ok(output_path)
}

#[tauri::command]
async fn batch_generate_speech(
    window: tauri::Window,
    items: Vec<serde_json::Value>,
    voice: String,
    rate: String,
    volume: String,
    pitch: String,
    output_dir: String,
    proxy: Option<ProxyConfig>,
) -> Result<Vec<String>, String> {
    let config = TTSConfig {
        voice,
        rate,
        volume,
        pitch,
    };

    let mut results = Vec::new();

    // 确保输出目录存在
    if !std::path::Path::new(&output_dir).exists() {
        fs::create_dir_all(&output_dir).map_err(|e| format!("创建目录失败: {}", e))?;
    }

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

        let audio_data = text_to_speech(&text, &config, proxy.clone()).await?;

        fs::write(&output_path, audio_data)
            .map_err(|e| format!("保存文件失败: {}", e))?;

        results.push(output_path);

        // 发送进度事件
        window.emit("batch-progress", serde_json::json!({
            "current": index + 1,
            "total": items.len()
        })).map_err(|e| e.to_string())?;
    }

    Ok(results)
}

#[tauri::command]
async fn test_proxy(proxy: ProxyConfig) -> Result<String, String> {
    get_voices(Some(proxy)).await?;
    Ok("代理连接测试成功".to_string())
}

#[tauri::command]
async fn get_file_size(path: String) -> Result<u64, String> {
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    Ok(metadata.len())
}

#[tauri::command]
async fn delete_file(path: String) -> Result<(), String> {
    fs::remove_file(path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn copy_file(source: String, dest: String) -> Result<(), String> {
    fs::copy(source, dest).map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
async fn open_path(path: String) -> Result<(), String> {
    let path = std::path::Path::new(&path);
    if path.exists() {
        opener::reveal(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn get_audio_temp_dir(app_handle: tauri::AppHandle) -> Result<String, String> {
    let mut path = app_handle.path().app_local_data_dir().map_err(|e| e.to_string())?;
    path.push("temp_audio");
    if !path.exists() {
        fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    }
    Ok(path.to_str().ok_or("路径转换失败")?.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            fetch_voices,
            generate_speech,
            batch_generate_speech,
            test_proxy,
            get_file_size,
            delete_file,
            copy_file,
            open_path,
            get_audio_temp_dir
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
